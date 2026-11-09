import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useNavigate, useParams } from "react-router-dom";
import { RightPane, TopActions, useRightPane } from "../components/RightPane";
import { Icon } from "../components/Icon";
import { ConfirmBar } from "../components/ConfirmBar";
import { Alert, SourceTag } from "../components/Status";
import { Tip } from "../components/Tip";
import { useApp } from "../lib/context";
import { ApiError, type ChatDetail, type HermesStatus, type Voucher } from "../shared/api";
import { VoucherDetail } from "./VoucherDetail";

interface ToolChip { id: string; name: string; status: "running" | "completed" | string }
interface Bubble {
  key: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolChip[];
}

const TOOL_LABEL: Record<string, string> = {
  search_vouchers: "查询凭证",
  get_voucher: "查看凭证",
  list_accounts: "查看科目",
  account_balance: "查询余额",
  trial_balance: "生成余额表",
  create_draft_voucher: "生成草稿凭证",
};

const SUGGESTIONS = [
  "11 月银行存款还剩多少？",
  "查一下本月差旅费凭证",
  "帮我做一张支付办公用品 500 元的凭证",
];

const VOUCHER_NO = /记-\d{4}/g;

function toolKey(name: string): string {
  return Object.keys(TOOL_LABEL).find((k) => name.endsWith(k)) ?? name;
}

function toolText(tool: ToolChip): string {
  const label = TOOL_LABEL[toolKey(tool.name)];
  if (!label) return tool.name;
  return tool.status === "running" ? `${label}…` : `已${label}`;
}

function toBubbles(detail: ChatDetail): Bubble[] {
  return detail.messages.map((m) => ({
    key: String(m.id),
    role: m.role,
    content: m.content,
    tools: m.tools ?? [],
  }));
}

export function ChatPage() {
  const { api } = useApp();
  const nav = useNavigate();
  const { id } = useParams();
  const { setOpen } = useRightPane();
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [title, setTitle] = useState("新对话");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pane, setPane] = useState<{ kind: "one"; v: Voucher } | { kind: "list"; no: string; items: Voucher[] } | null>(null);
  const [sources, setSources] = useState<Record<string, Voucher["source"]>>({});
  const [hermes, setHermes] = useState<HermesStatus | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const abort = useRef<AbortController | null>(null);
  const skipLoad = useRef(false);
  const ignoreAbort = useRef(false);
  const sessionId = useRef<string | undefined>(id);

  useEffect(() => { sessionId.current = id; }, [id]);

  const refreshLists = () => window.dispatchEvent(new Event("fw-chats-changed"));

  useEffect(() => {
    let stop = false;
    const pull = () => {
      api.hermesStatus().then((s) => { if (!stop) setHermes(s); }).catch(() => { if (!stop) setHermes(null); });
    };
    pull();
    const t = window.setInterval(pull, 8000);
    return () => { stop = true; window.clearInterval(t); };
  }, [api]);

  useEffect(() => {
    if (!id) {
      setBubbles([]);
      setTitle("新对话");
      setError("");
      return;
    }
    if (skipLoad.current) {
      skipLoad.current = false;
      return;
    }
    api.chatSession(id).then((detail) => {
      setTitle(detail.title);
      setBubbles(toBubbles(detail));
      setError("");
    }).catch((e) => setError(e instanceof ApiError ? e.message : String(e)));
  }, [api, id]);

  useEffect(() => () => {
    if (ignoreAbort.current) {
      ignoreAbort.current = false;
      return;
    }
    abort.current?.abort();
  }, [id]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [bubbles, busy]);

  useEffect(() => {
    if (busy) return;
    const nos = new Set<string>();
    for (const b of bubbles) for (const m of b.content.matchAll(VOUCHER_NO)) nos.add(m[0]);
    if (nos.size === 0) return;
    let stop = false;
    (async () => {
      const next: Record<string, Voucher["source"]> = {};
      for (const no of nos) {
        try {
          const list = await api.lookupVoucher(no);
          if (list.length === 1) next[no] = list[0].source;
        } catch { /* 标签仍可点，失败时不标来源 */ }
      }
      if (!stop) setSources(next);
    })();
    return () => { stop = true; };
  }, [api, bubbles, busy]);

  function resize() {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 22 * 8) + "px";
  }

  function showVoucher(v: Voucher) {
    setPane({ kind: "one", v });
    setOpen(true);
  }

  async function openNo(no: string) {
    setError("");
    try {
      const list = await api.lookupVoucher(no);
      if (list.length === 0) {
        setError(`没有找到凭证 ${no}`);
        return;
      }
      if (list.length === 1) {
        showVoucher(list[0]);
        return;
      }
      setPane({ kind: "list", no, items: list });
      setOpen(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function reloadSession(sid: string) {
    const detail = await api.chatSession(sid);
    setTitle(detail.title);
    setBubbles(toBubbles(detail));
  }

  async function run(message: string, regenerate = false) {
    const text = message.trim();
    if (!regenerate && !text) return;
    if (busy) return;
    setError("");
    setDraft("");
    if (box.current) box.current.style.height = "auto";
    const ctrl = new AbortController();
    abort.current = ctrl;
    setBusy(true);
    if (regenerate) {
      setBubbles((prev) => {
        const next = [...prev];
        if (next.at(-1)?.role === "assistant") next.pop();
        return next;
      });
    } else {
      setBubbles((prev) => [...prev, { key: "u-" + Date.now(), role: "user", content: text, tools: [] }]);
    }
    const assistantKey = "a-" + Date.now();
    setBubbles((prev) => [...prev, { key: assistantKey, role: "assistant", content: "", tools: [] }]);
    const patch = (fn: (b: Bubble) => Bubble) => {
      setBubbles((prev) => prev.map((b) => (b.key === assistantKey ? fn(b) : b)));
    };
    let aborted = false;
    try {
      for await (const ev of api.chat(regenerate ? "" : text, sessionId.current, { signal: ctrl.signal, regenerate })) {
        if (ev.type === "session") {
          if (!sessionId.current) {
            skipLoad.current = true;
            ignoreAbort.current = true;
            sessionId.current = ev.sessionId;
            nav(`/chat/${ev.sessionId}`, { replace: true });
            refreshLists();
          }
        } else if (ev.type === "delta") {
          patch((b) => ({ ...b, content: b.content + ev.text }));
        } else if (ev.type === "tool") {
          patch((b) => {
            const tools = b.tools.filter((t) => (t.id || t.name) !== (ev.id || ev.name));
            tools.push({ id: ev.id || ev.name, name: ev.name, status: ev.status });
            return { ...b, tools };
          });
        } else if (ev.type === "error") {
          setError(ev.message);
        }
      }
    } catch (e) {
      aborted = (e as Error).name === "AbortError";
      if (!aborted) setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
      abort.current = null;
      refreshLists();
      const sid = sessionId.current;
      if (sid) {
        if (aborted) await new Promise((r) => window.setTimeout(r, 250));
        reloadSession(sid).catch(() => undefined);
      }
    }
  }

  async function saveName() {
    if (!sessionId.current) return;
    const titleNext = nameDraft.trim().slice(0, 40);
    if (!titleNext) return;
    const row = await api.renameChat(sessionId.current, titleNext);
    setTitle(row.title);
    setRenaming(false);
    refreshLists();
  }

  async function remove() {
    if (!sessionId.current) return;
    await api.deleteChat(sessionId.current);
    setConfirmDelete(false);
    refreshLists();
    nav("/chat");
  }

  async function copyText(key: string, content: string) {
    await navigator.clipboard.writeText(content);
    setCopied(key);
    window.setTimeout(() => setCopied((cur) => (cur === key ? null : cur)), 1200);
  }

  const lastAssistant = [...bubbles].reverse().find((b) => b.role === "assistant");
  const dot = !hermes?.configured ? "off" : hermes.reachable ? "on" : "bad";
  const dotTip = !hermes?.configured
    ? "按 docs/tasks/T02.md 配置 Hermes"
    : hermes.reachable ? `Hermes 在线${hermes.model ? " · " + hermes.model : ""}` : "连不上 Hermes，请确认它已启动";

  return (
    <div className="chatpage">
      <TopActions>
        <button className="btn" type="button" onClick={() => nav("/chat")}>新对话</button>
        <span className="tt hermesdot" tabIndex={0}>
          <i className={"hdot " + dot} />
          <Tip>{dotTip}</Tip>
        </span>
      </TopActions>
      <div className="chathead">
        {renaming ? (
          <input
            className="input chattitle"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => { void saveName(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveName();
              if (e.key === "Escape") setRenaming(false);
            }}
          />
        ) : <h2 className="chattitle">{id ? title : "新对话"}</h2>}
        {id && (
          <div className="dd">
            <button className="iconbtn tt" type="button" aria-label="更多" onClick={() => setMenu((v) => !v)}>
              …
              <Tip>更多</Tip>
            </button>
            {menu && (
              <>
                <button className="clickaway" type="button" aria-label="关闭菜单" onClick={() => setMenu(false)} />
                <div className="menu">
                  <button className="mi" type="button" onClick={() => { setMenu(false); setNameDraft(title); setRenaming(true); }}>重命名</button>
                  <button className="mi" type="button" onClick={() => { setMenu(false); setConfirmDelete(true); }}>删除</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {confirmDelete && <ConfirmBar text="删除这个对话？消息会一起去掉。" onCancel={() => setConfirmDelete(false)} onOk={() => { void remove(); }} />}
      {error && <div className="chatpad"><Alert kind="bad" onClose={() => setError("")}>{error}</Alert></div>}
      <div className="chatscroll" ref={scroller}>
        <div className="chatcol">
          {bubbles.length === 0 ? (
            <div className="empty">
              <div className="t">问问你的账本</div>
              <div className="sugs">
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" type="button" onClick={() => { void run(s); }}>{s}</button>
                ))}
              </div>
            </div>
          ) : bubbles.map((b) => (
            <div key={b.key} className={b.role === "user" ? "bubble user" : "bubble assistant"}>
              {b.tools.length > 0 && (
                <div className="tools">
                  {b.tools.map((t) => (
                    <span key={t.id || t.name} className="toolchip">
                      {toolText(t)}
                      {t.status === "completed" && TOOL_LABEL[toolKey(t.name)] ? <Icon name="check" size={13} /> : null}
                    </span>
                  ))}
                </div>
              )}
              {b.role === "assistant" ? (
                <div className="md">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                      table: ({ children }) => <table className="tbl">{children}</table>,
                      td: ({ children }) => <td className={numericCell(children) ? "num" : undefined}>{linkNos(children, openNo, sources)}</td>,
                      p: ({ children }) => <p>{linkNos(children, openNo, sources)}</p>,
                      li: ({ children }) => <li>{linkNos(children, openNo, sources)}</li>,
                    }}
                  >{b.content}</ReactMarkdown>
                </div>
              ) : <div>{linkNos(b.content, openNo, sources)}</div>}
              {b.role === "assistant" && b.content && (
                <div className="bubbleacts">
                  <button className="btn sm" type="button" onClick={() => { void copyText(b.key, b.content); }}>{copied === b.key ? "已复制" : "复制"}</button>
                  {b.key === lastAssistant?.key && !busy && (
                    <button className="btn sm" type="button" onClick={() => { void run("", true); }}>重新生成</button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="composer">
        <div className="chatcol composerow">
          <textarea
            ref={box}
            rows={1}
            placeholder="问一句，或让它起草一张凭证"
            value={draft}
            onChange={(e) => { setDraft(e.target.value); resize(); }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void run(draft);
              }
            }}
          />
          {busy
            ? <button className="btn" type="button" onClick={() => abort.current?.abort()}>停止</button>
            : <button className="btn pri" type="button" disabled={!draft.trim()} onClick={() => { void run(draft); }}>发送</button>}
        </div>
      </div>
      {pane && (
        <RightPane>
          {pane.kind === "one" ? (
            <VoucherDetail
              v={pane.v}
              onChanged={(v) => setPane({ kind: "one", v })}
              onClose={() => { setPane(null); setOpen(false); }}
            />
          ) : (
            <div className="pad">
              <div className="sec">找到 {pane.items.length} 张 {pane.no}</div>
              {pane.items.map((v) => (
                <button key={v.id} className="mi" type="button" onClick={() => showVoucher(v)}>
                  <span>{v.period} · {v.word}-{String(v.number).padStart(4, "0")}</span>
                  {v.source === "ai" ? <SourceTag source="ai" /> : null}
                </button>
              ))}
            </div>
          )}
        </RightPane>
      )}
    </div>
  );
}

function numericCell(children: React.ReactNode): boolean {
  return /^-?\d[\d,]*\.\d{2}$/.test(nodeText(children).trim());
}

function nodeText(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  return "";
}

function linkNos(
  children: React.ReactNode,
  openNo: (no: string) => void,
  sources: Record<string, Voucher["source"]>,
): React.ReactNode {
  if (typeof children === "string") return splitNos(children, openNo, sources);
  if (Array.isArray(children)) {
    return children.map((c, i) => <span key={i}>{linkNos(c, openNo, sources)}</span>);
  }
  return children;
}

function splitNos(
  text: string,
  openNo: (no: string) => void,
  sources: Record<string, Voucher["source"]>,
): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(VOUCHER_NO)) {
    const i = m.index ?? 0;
    if (i > last) out.push(text.slice(last, i));
    const no = m[0];
    out.push(
      <button key={no + i} className="chip vno" type="button" onClick={() => { void openNo(no); }}>
        <Icon name="ledger" size={13} />{no}
        {sources[no] === "ai" ? <span className="tag ai">AI 草稿</span> : null}
      </button>,
    );
    last = i + no.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
