import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AccountPicker } from "../components/AccountPicker";
import { ConfirmBar } from "../components/ConfirmBar";
import { Icon } from "../components/Icon";
import { MoneyInput } from "../components/MoneyInput";
import { RightPane, TopActions, useRightPane } from "../components/RightPane";
import { Alert } from "../components/Status";
import { SummaryField } from "../components/SummaryField";
import { Tip } from "../components/Tip";
import { useApp } from "../lib/context";
import { formatMoney, formatPeriod, fromCents, isZero, moneyUpper, sumMoney, toCents } from "../lib/format";
import { ApiError, type Account, type AccountBalance, type Voucher, type VoucherInput } from "../shared/api";

interface Line {
  key: string;
  summary: string;
  account_code: string;
  debit: string;
  credit: string;
}

interface FormState {
  date: string;
  attachments: string;
  note: string;
  word: string;
  lines: Line[];
}

let lineSeq = 1;
function blankLine(summary = ""): Line {
  return { key: `ln${lineSeq++}`, summary, account_code: "", debit: "", credit: "" };
}

function todayISO(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function periodOf(date: string): string {
  return date.slice(0, 7);
}

function monthBounds(period: string): { min: string; max: string } {
  const [ys, ms] = period.split("-");
  const last = new Date(Number(ys), Number(ms), 0).getDate();
  return { min: `${period}-01`, max: `${period}-${String(last).padStart(2, "0")}` };
}

function attachmentCount(s: string): number {
  let n = 0;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") n = n * 10 + (ch.charCodeAt(0) - 48);
  }
  return n;
}

function snapshot(f: FormState): string {
  return JSON.stringify({
    date: f.date,
    attachments: f.attachments,
    note: f.note,
    word: f.word,
    lines: f.lines.map((l) => [l.summary, l.account_code, l.debit, l.credit]),
  });
}

function blankForm(date: string): FormState {
  return { date, attachments: "0", note: "", word: "记", lines: [blankLine(), blankLine(), blankLine(), blankLine()] };
}

function formFrom(v: Voucher, date: string, attachments: string, note: string, word: string): FormState {
  const lines = v.lines.map((l) => ({
    key: `ln${lineSeq++}`,
    summary: l.summary,
    account_code: l.account_code,
    debit: isZero(l.debit) ? "" : l.debit,
    credit: isZero(l.credit) ? "" : l.credit,
  }));
  while (lines.length < 4) lines.push(blankLine());
  return { date, attachments, note, word, lines };
}

function toInput(f: FormState): VoucherInput {
  return {
    date: f.date,
    word: f.word,
    attachments: attachmentCount(f.attachments),
    note: f.note.trim(),
    lines: f.lines
      .filter((l) => l.summary.trim() || l.account_code || toCents(l.debit) > 0n || toCents(l.credit) > 0n)
      .map((l) => ({
        summary: l.summary.trim(),
        account_code: l.account_code,
        debit: toCents(l.debit) > 0n ? fromCents(toCents(l.debit)) : "0",
        credit: toCents(l.credit) > 0n ? fromCents(toCents(l.credit)) : "0",
      })),
  };
}

type Status = "loading" | "ready" | "locked" | "missing";

export function VoucherEntryPage() {
  const { api } = useApp();
  const nav = useNavigate();
  const params = useParams();
  const [sp] = useSearchParams();
  const loc = useLocation();
  const keepDate = (loc.state as { date?: string } | null)?.date;
  const editRaw = params.id;
  const editId = editRaw && /^\d+$/.test(editRaw) ? Number(editRaw) : (editRaw ? NaN : null);
  const copyRaw = sp.get("copy");
  const copyId = copyRaw && /^\d+$/.test(copyRaw) ? Number(copyRaw) : (copyRaw ? NaN : null);
  const mode = editRaw ? "edit" : "new";

  const pane = useRightPane();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [form, setForm] = useState<FormState>(() => blankForm(todayISO()));
  const [baseline, setBaseline] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const [editPeriod, setEditPeriod] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [numberEpoch, setNumberEpoch] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "new" | null>(null);
  const [openPop, setOpenPop] = useState<string | null>(null);
  const [focusRow, setFocusRow] = useState(0);
  const [bal, setBal] = useState<AccountBalance | null>(null);
  const [balState, setBalState] = useState<"idle" | "loading" | "error">("idle");
  const [balErr, setBalErr] = useState<string | null>(null);

  const cellRefs = useRef<(HTMLInputElement | null)[][]>([]);
  const pending = useRef<{ row: number; col: number } | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const skip = useRef(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const saveRef = useRef<(andNew: boolean) => void>(() => {});
  const escRef = useRef<() => void>(() => {});

  const snap = snapshot(form);
  const dirty = status === "ready" && baseline !== "" && snap !== baseline;
  dirtyRef.current = dirty;

  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (skip.current) return false;
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false;
    return dirtyRef.current;
  });

  useEffect(() => {
    pane.hold();
    return () => pane.release();
    // 只在进出录入页时切换，不跟随页内手动开关。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".scrim")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        e.stopPropagation();
        saveRef.current(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        saveRef.current(true);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        escRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    let live = true;
    api.accounts().then((rows) => { if (live) setAccounts(rows); }).catch(() => { if (live) setAccounts([]); });
    return () => { live = false; };
  }, [api]);

  useEffect(() => {
    let live = true;
    setStatus("loading");
    setErr(null);
    setOk(null);
    (async () => {
      try {
        if (mode === "edit") {
          if (editId == null || Number.isNaN(editId)) { if (live) setStatus("missing"); return; }
          const v = await api.voucher(editId);
          if (!live) return;
          if (v.status !== "draft") { setStatus("locked"); return; }
          const next = formFrom(v, v.date, String(v.attachments), v.note, v.word);
          setForm(next);
          setBaseline(snapshot(next));
          setEditPeriod(v.period);
          setPreview(v.display_no);
          setStatus("ready");
          return;
        }
        if (copyId != null) {
          if (Number.isNaN(copyId)) { if (live) setStatus("missing"); return; }
          const v = await api.voucher(copyId);
          if (!live) return;
          const next = formFrom(v, keepDate ?? todayISO(), "0", "", "记");
          setForm(next);
          setBaseline(snapshot(next));
          setEditPeriod(null);
          setStatus("ready");
          return;
        }
        const next = blankForm(keepDate ?? todayISO());
        if (!live) return;
        setForm(next);
        setBaseline(snapshot(next));
        setEditPeriod(null);
        setStatus("ready");
      } catch (e) {
        if (!live) return;
        setErr(e instanceof ApiError ? e.message : "凭证加载失败");
        setStatus("missing");
      }
    })();
    return () => { live = false; };
  }, [api, mode, editId, copyId, keepDate]);

  useEffect(() => {
    if (status !== "ready" || mode === "edit") return;
    const p = periodOf(form.date);
    if (!/^\d{4}-\d{2}$/.test(p)) return;
    let live = true;
    api.nextVoucherNumber(p, form.word).then((r) => { if (live) setPreview(r.display_no); }).catch(() => { if (live) setPreview(""); });
    return () => { live = false; };
  }, [api, status, mode, form.date, form.word, numberEpoch]);

  const focusCode = form.lines[focusRow]?.account_code ?? "";
  useEffect(() => {
    if (status !== "ready" || !focusCode) { setBal(null); setBalState("idle"); return; }
    const p = periodOf(form.date);
    if (!/^\d{4}-\d{2}$/.test(p)) return;
    let live = true;
    setBalState("loading");
    api.accountBalance(focusCode, p, true).then((b) => {
      if (!live) return;
      setBal(b);
      setBalState("idle");
    }).catch((e) => {
      if (!live) return;
      setBal(null);
      setBalState("error");
      setBalErr(e instanceof ApiError ? e.message : "余额加载失败");
    });
    return () => { live = false; };
  }, [api, status, focusCode, form.date]);

  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    const el = cellRefs.current[p.row]?.[p.col];
    el?.focus();
    if (p.col === 0) el?.select();
    setFocusRow(p.row);
  }, [focusNonce]);

  const queueFocus = (row: number, col: number) => {
    pending.current = { row, col };
    setFocusNonce((n) => n + 1);
  };

  const bind = (row: number, col: number) => (el: HTMLInputElement | null) => {
    if (!cellRefs.current[row]) cellRefs.current[row] = [];
    cellRefs.current[row][col] = el;
  };

  const goList = useCallback(() => { nav("/ledger"); }, [nav]);

  const setDate = (next: string) => {
    if (!next) return;
    if (editPeriod && periodOf(next) !== editPeriod) {
      setErr("不能改到其他期间，请复制后新建");
      return;
    }
    setErr((cur) => (cur === "不能改到其他期间，请复制后新建" ? null : cur));
    setForm((f) => ({ ...f, date: next }));
  };

  const patchLine = (i: number, patch: Partial<Line>) => {
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));
  };

  const setAmount = (i: number, side: "debit" | "credit", value: string) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => {
        if (idx !== i) return l;
        const next = { ...l, [side]: value };
        if (toCents(value) > 0n) {
          if (side === "debit") next.credit = "";
          else next.debit = "";
        }
        return next;
      }),
    }));
  };

  const applyBalance = (i: number, side: "debit" | "credit") => {
    setForm((f) => {
      let dr = 0n;
      let cr = 0n;
      f.lines.forEach((l, idx) => {
        dr += idx === i && side === "debit" ? 0n : toCents(l.debit);
        cr += idx === i && side === "credit" ? 0n : toCents(l.credit);
      });
      const gap = side === "debit" ? cr - dr : dr - cr;
      if (gap <= 0n) return f;
      const amount = fromCents(gap);
      return {
        ...f,
        lines: f.lines.map((l, idx) => {
          if (idx !== i) return l;
          return side === "debit" ? { ...l, debit: amount, credit: "" } : { ...l, credit: amount, debit: "" };
        }),
      };
    });
  };

  const swapAmount = (i: number) => {
    setForm((f) => ({
      ...f,
      lines: f.lines.map((l, idx) => {
        if (idx !== i) return l;
        const d = toCents(l.debit);
        const c = toCents(l.credit);
        if (d === 0n && c === 0n) return l;
        if (d > 0n) return { ...l, debit: "", credit: l.debit };
        return { ...l, credit: "", debit: l.credit };
      }),
    }));
  };

  const addRow = (after: number) => {
    const summary = form.lines[after]?.summary ?? "";
    setForm((f) => {
      const lines = f.lines.slice();
      lines.splice(after + 1, 0, blankLine(summary));
      return { ...f, lines };
    });
    queueFocus(after + 1, 0);
  };

  const removeRow = (i: number) => {
    setForm((f) => {
      if (f.lines.length <= 2) {
        return { ...f, lines: f.lines.map((l, idx) => (idx === i ? blankLine() : l)) };
      }
      return { ...f, lines: f.lines.filter((_, idx) => idx !== i) };
    });
  };

  const moveFrom = (row: number, col: number, dir: 1 | -1, key: "Enter" | "Tab") => {
    if (row === 0 && col === 0 && dir === -1) return false;
    const last = form.lines.length - 1;
    if (row === last && col === 3 && dir === 1) {
      if (key === "Enter") addRow(row);
      else saveBtn.current?.focus();
      return true;
    }
    let r = row;
    let c = col + dir;
    if (c > 3) { r += 1; c = 0; }
    if (c < 0) { r -= 1; c = 3; }
    if (r < 0 || r >= form.lines.length) return false;
    // 往下一行的摘要格走时，空行自动带上一行的摘要（选中状态，直接打字即可覆盖）
    if (c === 0 && dir === 1 && r > 0) {
      const cur = form.lines[r];
      const prev = form.lines[r - 1];
      if (!cur.summary && !cur.account_code && !cur.debit && !cur.credit && prev.summary) {
        patchLine(r, { summary: prev.summary });
      }
    }
    queueFocus(r, c);
    return true;
  };

  const save = async (andNew: boolean) => {
    if (busyRef.current || status !== "ready") return;
    const input = toInput(form);
    if (input.lines.length < 2) {
      setOk(null);
      setErr("凭证至少要两行分录");
      return;
    }
    busyRef.current = true;
    setBusy(andNew ? "new" : "save");
    setErr(null);
    setOk(null);
    try {
      const saved = mode === "edit" && editId != null && !Number.isNaN(editId)
        ? await api.updateVoucher(editId, input)
        : await api.createVoucher(input);
      if (blocker.state === "blocked") blocker.reset();
      if (andNew) {
        if (mode === "new" && copyId == null) {
          const next = blankForm(form.date);
          setForm(next);
          setBaseline(snapshot(next));
          setOpenPop(null);
          setOk(`已保存 ${saved.display_no}，可继续录入`);
          setNumberEpoch((n) => n + 1);
        } else {
          skip.current = true;
          nav("/ledger/new", { replace: true, state: { date: form.date } });
        }
      } else {
        skip.current = true;
        nav(`/ledger?period=${encodeURIComponent(saved.period)}&v=${saved.id}`);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败，请检查本机服务是否在运行");
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  saveRef.current = (andNew) => { void save(andNew); };
  escRef.current = () => {
    if (openPop) { setOpenPop(null); return; }
    if (blocker.state === "blocked") { blocker.reset(); return; }
    goList();
  };

  const dr = sumMoney(form.lines.map((l) => l.debit || "0"));
  const cr = sumMoney(form.lines.map((l) => l.credit || "0"));
  const balanced = dr === cr;
  const empty = isZero(dr) && isZero(cr);
  const gap = fromCents(toCents(dr) >= toCents(cr) ? toCents(dr) - toCents(cr) : toCents(cr) - toCents(dr));
  const bounds = editPeriod ? monthBounds(editPeriod) : null;

  const back = (
    <TopActions>
      <button className="btn" type="button" onClick={goList}>返回列表</button>
    </TopActions>
  );

  const side = (
    <RightPane>
      <div className="rhead">
        <span className="h2">科目余额</span>
      </div>
      <div className="rbody">
        {!focusCode && (
          <div className="empty">
            <span className="t">科目余额</span>
            <span>光标所在行选了科目后，这里显示期初、本期借贷和期末，含未记账。</span>
          </div>
        )}
        {focusCode && balState === "loading" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ width: i === 0 ? 160 : 96 }} />)}
          </div>
        )}
        {focusCode && bal && balState !== "loading" && (
          <>
            <dl className="kv">
              <dt>科目</dt><dd>{bal.account_code} {bal.account_name}</dd>
              <dt>期间</dt><dd>{formatPeriod(bal.period)}</dd>
              <dt>期初</dt><dd className="num">{formatMoney(bal.opening)}</dd>
              <dt>本期借方</dt><dd className="num">{formatMoney(bal.debit)}</dd>
              <dt>本期贷方</dt><dd className="num">{formatMoney(bal.credit)}</dd>
              <dt>期末</dt><dd className="num">{formatMoney(bal.closing)}</dd>
            </dl>
            <span className="cap">含未记账凭证。</span>
          </>
        )}
        {balState === "error" && balErr && <Alert kind="bad">{balErr}</Alert>}
      </div>
    </RightPane>
  );

  if (status === "loading") {
    return (
      <>
        {back}
        <main className="content">
          <div className="skel" style={{ height: 28, width: 240 }} />
          <div className="box" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ height: 22 }} />)}
          </div>
        </main>
        {side}
      </>
    );
  }

  if (status === "locked") {
    return (
      <>
        {back}
        <main className="content">
          <div className="empty">
            <span className="t">只有草稿可以修改</span>
            <span>已审核或已记账的凭证不能直接改，可以回列表复制一张。</span>
            <button className="btn" type="button" onClick={goList}>返回列表</button>
          </div>
        </main>
        {side}
      </>
    );
  }

  if (status === "missing") {
    return (
      <>
        {back}
        <main className="content">
          {err && <Alert kind="bad">{err}</Alert>}
          <div className="empty">
            <span className="t">没有这张凭证</span>
            <span>它可能已被删除。</span>
            <button className="btn" type="button" onClick={goList}>返回列表</button>
          </div>
        </main>
        {side}
      </>
    );
  }

  return (
    <>
      {back}
      <main className="content">
        <div className="entry-head">
          <label className="field">
            <span className="lbl">凭证字</span>
            <input className="input" aria-label="凭证字" value={form.word || "记"} readOnly />
          </label>
          <label className="field">
            <span className="lbl">凭证号</span>
            <input className="input" aria-label="凭证号预览" value={preview || "…"} readOnly />
          </label>
          <label className="field">
            <span className="lbl">日期</span>
            <input
              className="input" type="date" aria-label="凭证日期" value={form.date}
              min={bounds?.min} max={bounds?.max}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="field">
            <span className="lbl">附件张数</span>
            <input
              className="input" inputMode="numeric" aria-label="附件张数" value={form.attachments}
              onChange={(e) => setForm((f) => ({ ...f, attachments: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
            />
          </label>
          <label className="field grow">
            <span className="lbl">备注</span>
            <input className="input" aria-label="备注" value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </label>
        </div>
        {editPeriod && <span className="cap">只能改 {formatPeriod(editPeriod)} 里的日期。换月请复制后新建。</span>}

        {err && <Alert kind="bad" onClose={() => setErr(null)}>{err}</Alert>}
        {ok && <Alert kind="ok" onClose={() => setOk(null)}>{ok}</Alert>}
        {blocker.state === "blocked" && (
          <ConfirmBar
            text="有未保存的内容，确定离开？"
            confirmLabel="离开"
            onConfirm={() => blocker.proceed()}
            onCancel={() => blocker.reset()}
          />
        )}

        <div className="box entry-box">
          <table className="tbl entry">
            <thead>
              <tr>
                <th>摘要</th>
                <th>科目</th>
                <th className="num">借方</th>
                <th className="num">贷方</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {form.lines.map((l, i) => (
                <tr key={l.key}>
                  <td>
                    <SummaryField
                      api={api} value={l.summary} open={openPop === `sum-${l.key}`}
                      onOpenChange={(o) => setOpenPop((cur) => (o ? `sum-${l.key}` : cur === `sum-${l.key}` ? null : cur))}
                      onChange={(v) => patchLine(i, { summary: v })}
                      onMove={(dir, key) => moveFrom(i, 0, dir, key)}
                      ariaLabel={`第 ${i + 1} 行摘要`}
                      inputRef={bind(i, 0)}
                      onFocus={() => setFocusRow(i)}
                    />
                  </td>
                  <td>
                    <AccountPicker
                      accounts={accounts} code={l.account_code} open={openPop === `acc-${l.key}`}
                      onOpenChange={(o) => setOpenPop((cur) => (o ? `acc-${l.key}` : cur === `acc-${l.key}` ? null : cur))}
                      onChange={(code) => patchLine(i, { account_code: code })}
                      onMove={(dir, key) => moveFrom(i, 1, dir, key)}
                      ariaLabel={`第 ${i + 1} 行科目`}
                      inputRef={bind(i, 1)}
                      onFocus={() => setFocusRow(i)}
                    />
                  </td>
                  <td className="num">
                    <MoneyInput
                      value={l.debit} onChange={(v) => setAmount(i, "debit", v)}
                      onMove={(dir, key) => moveFrom(i, 2, dir, key)}
                      onBalance={() => applyBalance(i, "debit")}
                      onSwap={() => swapAmount(i)}
                      ariaLabel={`第 ${i + 1} 行借方`}
                      inputRef={bind(i, 2)}
                      onFocus={() => setFocusRow(i)}
                    />
                  </td>
                  <td className="num">
                    <MoneyInput
                      value={l.credit} onChange={(v) => setAmount(i, "credit", v)}
                      onMove={(dir, key) => moveFrom(i, 3, dir, key)}
                      onBalance={() => applyBalance(i, "credit")}
                      onSwap={() => swapAmount(i)}
                      ariaLabel={`第 ${i + 1} 行贷方`}
                      inputRef={bind(i, 3)}
                      onFocus={() => setFocusRow(i)}
                    />
                  </td>
                  <td>
                    <button className="iconbtn tt rowdel" type="button" tabIndex={-1} aria-label={`删除第 ${i + 1} 行`} onClick={() => removeRow(i)}>
                      <Icon name="trash" size={16} />
                      <Tip>删除这一行</Tip>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <div className="entry-total">
                    <span>合计</span>
                    {!empty && <span className={"tag " + (balanced ? "ok" : "bad")}>{balanced ? "平衡" : `差额 ${formatMoney(gap)}`}</span>}
                    {!empty && balanced && <span className="entry-upper">{moneyUpper(dr)}</span>}
                  </div>
                </td>
                <td className="num">{empty ? "" : formatMoney(dr)}</td>
                <td className="num">{empty ? "" : formatMoney(cr)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        <div className="entry-actions">
          <button ref={saveBtn} className="btn pri" type="button" disabled={!!busy} onClick={() => { void save(false); }}>
            {busy === "save" ? "保存中…" : "保存"}
          </button>
          <button className="btn" type="button" disabled={!!busy} onClick={() => { void save(true); }}>
            {busy === "new" ? "保存中…" : "保存并新增"}
          </button>
          <button className="btn ghost" type="button" onClick={goList}>取消</button>
          <span className="cap">Ctrl+S 保存，Ctrl+Enter 保存并新增，Esc 取消。金额格按 = 补差额，空格切换借贷。</span>
        </div>
      </main>
      {side}
    </>
  );
}
