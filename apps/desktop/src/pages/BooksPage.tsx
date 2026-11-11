import { useEffect, useMemo, useRef, useState } from "react";
import { useBlocker, useSearchParams } from "react-router-dom";
import { AccountPicker } from "../components/AccountPicker";
import { ConfirmBar } from "../components/ConfirmBar";
import { Dropdown } from "../components/Dropdown";
import { Icon } from "../components/Icon";
import { MoneyInput } from "../components/MoneyInput";
import { Alert } from "../components/Status";
import { Tip } from "../components/Tip";
import { useApp } from "../lib/context";
import { formatMoney, formatPeriod, fromCents, isZero, toCents } from "../lib/format";
import {
  ApiError, type Account, type BookSide, type BookView, type OpeningItem, type OpeningView, type Period,
} from "../shared/api";

const SIDE: Record<BookSide, string> = { debit: "借", credit: "贷", flat: "平" };

function moneyCell(value: string) {
  return isZero(value) ? "" : formatMoney(value);
}

function shiftPeriod(period: string, delta: number): string {
  const [ys, ms] = period.split("-");
  const index = Number(ys) * 12 + (Number(ms) - 1) + delta;
  const year = Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function signOf(direction: "debit" | "credit"): bigint {
  return direction === "debit" ? 1n : -1n;
}

type Col = "amount" | "ytd_debit" | "ytd_credit";
type Edit = Record<string, { amount: string; ytd_debit: string; ytd_credit: string }>;

export function BooksPage({ onOpenVoucher }: { onOpenVoucher: (id: number) => void }) {
  const [params, setParams] = useSearchParams();
  const book = params.get("book") === "general" || params.get("book") === "opening" ? params.get("book")! : "detail";
  const account = params.get("account") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const unposted = params.get("unposted") === "1";

  const set = (patch: Record<string, string | null>) => {
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      n.set("tab", "books");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") n.delete(k);
        else n.set(k, v);
      }
      return n;
    }, { replace: true });
  };

  return (
    <div className="books">
      <div className="tabs sm" role="group" aria-label="账簿">
        {([
          ["detail", "明细账"],
          ["general", "总账"],
          ["opening", "期初余额"],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" className={book === id ? "on" : ""} aria-pressed={book === id}
            onClick={() => set({ book: id })}>{label}</button>
        ))}
      </div>
      {book === "opening"
        ? <OpeningSheet />
        : (
          <LedgerSheet
            kind={book === "general" ? "general" : "detail"}
            account={account}
            from={from}
            to={to}
            unposted={unposted}
            set={set}
            onOpenVoucher={onOpenVoucher}
          />
        )}
    </div>
  );
}

function LedgerSheet({
  kind, account, from, to, unposted, set, onOpenVoucher,
}: {
  kind: "detail" | "general";
  account: string;
  from: string;
  to: string;
  unposted: boolean;
  set: (patch: Record<string, string | null>) => void;
  onOpenVoucher: (id: number) => void;
}) {
  const { api } = useApp();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [periods, setPeriods] = useState<Period[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [view, setView] = useState<BookView | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [err, setErr] = useState("");
  const [jump, setJump] = useState<string[]>([]);

  useEffect(() => {
    api.accounts().then(setAccounts).catch(() => setAccounts([]));
    api.bookPeriods().then((ps) => {
      setPeriods(ps);
      if (!from && !to && ps.length) {
        const last = ps[ps.length - 1];
        set({ from: last, to: last });
      }
    }).catch(() => setPeriods([]));
    // 只在进入时补默认期间。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  useEffect(() => {
    if (!to) return;
    api.trialBalance(to, unposted).then((tb) => {
      const codes = new Set(tb.items.map((i) => i.account_code));
      const by = new Map(accounts.map((a) => [a.code, a]));
      for (const code of [...codes]) {
        let parent = by.get(code)?.parent_code ?? null;
        while (parent) {
          codes.add(parent);
          parent = by.get(parent)?.parent_code ?? null;
        }
      }
      setJump([...codes].sort());
    }).catch(() => setJump([]));
  }, [api, to, unposted, accounts]);

  useEffect(() => {
    if (!account || !from || !to) {
      setView(null);
      setState("idle");
      return;
    }
    let stop = false;
    setState("loading");
    setErr("");
    const load = kind === "detail" ? api.detailLedger : api.generalLedger;
    load.call(api, account, from, to, unposted).then((v) => {
      if (!stop) { setView(v); setState("ready" as "idle"); }
    }).catch((e) => {
      if (!stop) {
        setView(null);
        setState("error");
        setErr(e instanceof ApiError ? e.message : "账簿加载失败");
      }
    });
    return () => { stop = true; };
  }, [api, kind, account, from, to, unposted]);

  const selected = accounts.find((a) => a.code === account);
  const showAccountCol = kind === "detail" && !!selected && !selected.is_leaf;
  const at = jump.indexOf(account);
  const periodOptions = periods.map((p) => ({ value: p, label: formatPeriod(p) }));

  return (
    <>
      <div className="bookbar">
        <AccountPicker
          accounts={accounts}
          code={account}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onChange={(code) => set({ account: code })}
          onMove={() => false}
          ariaLabel="账簿科目"
          allowParent
          inputRef={() => undefined}
        />
        <button className="iconbtn tt" type="button" aria-label="上一个科目" disabled={at <= 0}
          onClick={() => at > 0 && set({ account: jump[at - 1] })}>
          <Icon name="chev" className="rotl" />
          <Tip>上一个科目</Tip>
        </button>
        <button className="iconbtn tt" type="button" aria-label="下一个科目" disabled={at < 0 || at >= jump.length - 1}
          onClick={() => at >= 0 && at < jump.length - 1 && set({ account: jump[at + 1] })}>
          <Icon name="chev" className="rotr" />
          <Tip>下一个科目</Tip>
        </button>
        <Dropdown ariaLabel="开始期间" head="期间" value={from} label={from ? formatPeriod(from) : "从"}
          options={periodOptions} onChange={(v) => set({ from: v })} />
        <Dropdown ariaLabel="结束期间" head="期间" value={to} label={to ? formatPeriod(to) : "到"}
          options={periodOptions} onChange={(v) => set({ to: v })} />
        <button className={"btn" + (unposted ? " pri" : "")} type="button" aria-pressed={unposted}
          onClick={() => set({ unposted: unposted ? null : "1" })}>含未记账</button>
        {unposted && <span className="tag warn">含未记账</span>}
      </div>
      {state === "error" && <Alert kind="bad">{err}</Alert>}
      {!account && (
        <div className="empty"><span className="t">选一个科目查看{kind === "detail" ? "明细账" : "总账"}</span></div>
      )}
      {account && state === "loading" && (
        <div className="box" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          {[0, 1, 2, 3].map((i) => <div key={i} className="skel" />)}
        </div>
      )}
      {view && state !== "error" && state !== "loading" && (
        <div className="box bookscroll">
          <table className="tbl">
            <thead>
              <tr>
                {kind === "detail" ? <th>日期</th> : <th>期间</th>}
                {kind === "detail" && <th>凭证号</th>}
                <th>摘要</th>
                {showAccountCol && <th>科目</th>}
                <th className="num">借方</th>
                <th className="num">贷方</th>
                <th>方向</th>
                <th className="num">余额</th>
              </tr>
            </thead>
            <tbody>
              <tr className="mutedrow">
                {kind === "detail" ? (
                  <>
                    <td />
                    <td />
                    <td>期初余额</td>
                    {showAccountCol && <td />}
                  </>
                ) : (
                  <>
                    <td />
                    <td>期初余额</td>
                  </>
                )}
                <td />
                <td />
                <td>{SIDE[view.opening.side]}</td>
                <td className="num">{moneyCell(view.opening.amount)}</td>
              </tr>
              {view.periods.map((p) => (
                <PeriodRows
                  key={p.period}
                  kind={kind}
                  period={p}
                  showAccountCol={showAccountCol}
                  onOpenVoucher={onOpenVoucher}
                  onMonth={() => set({ book: "detail", from: p.period, to: p.period })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PeriodRows({
  kind, period, showAccountCol, onOpenVoucher, onMonth,
}: {
  kind: "detail" | "general";
  period: BookView["periods"][number];
  showAccountCol: boolean;
  onOpenVoucher: (id: number) => void;
  onMonth: () => void;
}) {
  return (
    <>
      {kind === "detail" && period.lines?.map((line, index) => (
        <tr key={`${line.voucher_id}-${index}`}>
          <td>{line.date.slice(5)}</td>
          <td>
            <button className="textlink" type="button" onClick={() => onOpenVoucher(line.voucher_id)}>{line.display_no}</button>
            {line.status !== "posted" && <span className="tag warn">未记账</span>}
          </td>
          <td>{line.summary}</td>
          {showAccountCol && <td>{line.account_code} {line.account_name}</td>}
          <td className="num">{moneyCell(line.debit)}</td>
          <td className="num">{moneyCell(line.credit)}</td>
          <td>{SIDE[line.side]}</td>
          <td className="num">{moneyCell(line.balance)}</td>
        </tr>
      ))}
      <tr className="sumrow click" onClick={kind === "general" ? onMonth : undefined}>
        {kind === "general" ? <td>{formatPeriod(period.period)}</td> : (<><td /><td /></>)}
        <td>本月合计</td>
        {showAccountCol && <td />}
        <td className="num">{moneyCell(period.month.debit)}</td>
        <td className="num">{moneyCell(period.month.credit)}</td>
        <td>{SIDE[period.month.side]}</td>
        <td className="num">{moneyCell(period.month.balance)}</td>
      </tr>
      <tr className="sumrow">
        {kind === "general" ? <td /> : (<><td /><td /></>)}
        <td>本年累计</td>
        {showAccountCol && <td />}
        <td className="num">{moneyCell(period.year.debit)}</td>
        <td className="num">{moneyCell(period.year.credit)}</td>
        <td>{SIDE[period.year.side]}</td>
        <td className="num">{moneyCell(period.year.balance)}</td>
      </tr>
    </>
  );
}

function OpeningSheet() {
  const { api } = useApp();
  const [view, setView] = useState<OpeningView | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [edits, setEdits] = useState<Edit>({});
  const [start, setStart] = useState("");
  const [q, setQ] = useState("");
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);
  const baseline = useRef("");
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const dirtyRef = useRef(false);

  const load = (next: OpeningView) => {
    const edit: Edit = {};
    for (const item of next.items) {
      if (!item.is_leaf) continue;
      edit[item.account_code] = { amount: zeroBlank(item.amount), ytd_debit: zeroBlank(item.ytd_debit), ytd_credit: zeroBlank(item.ytd_credit) };
    }
    setView(next);
    setEdits(edit);
    setStart(next.start_period);
    baseline.current = JSON.stringify({ start: next.start_period, edit });
    dirtyRef.current = false;
  };

  useEffect(() => {
    let stop = false;
    setLoading(true);
    Promise.all([api.openingBalances(), api.accounts()]).then(([opening, list]) => {
      if (stop) return;
      load(opening);
      setAccounts(list);
      setLoading(false);
    }).catch((e) => {
      if (!stop) {
        setLoading(false);
        setErr(e instanceof ApiError ? e.message : "期初余额加载失败");
      }
    });
    return () => { stop = true; };
  }, [api]);

  const snap = JSON.stringify({ start, edit: edits });
  const dirty = baseline.current !== "" && snap !== baseline.current;
  dirtyRef.current = dirty;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (currentLocation.pathname === nextLocation.pathname && currentLocation.search === nextLocation.search) return false;
    return dirtyRef.current;
  });

  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, []);

  const byPy = useMemo(() => new Map(accounts.map((a) => [a.code, a.py])), [accounts]);
  const mid = !!start && !start.endsWith("-01");

  const rolled = useMemo(() => {
    if (!view) return new Map<string, { amount: bigint; ytd_debit: bigint; ytd_credit: bigint }>();
    const map = new Map(view.items.map((i) => [i.account_code, i]));
    const children = new Map<string, string[]>();
    for (const item of view.items) {
      if (!item.parent_code) continue;
      const list = children.get(item.parent_code) ?? [];
      list.push(item.account_code);
      children.set(item.parent_code, list);
    }
    const amountMemo = new Map<string, bigint>();
    const ytdMemo = new Map<string, { d: bigint; c: bigint }>();
    const amountOf = (code: string): bigint => {
      const hit = amountMemo.get(code);
      if (hit !== undefined) return hit;
      const item = map.get(code)!;
      const kids = children.get(code) ?? [];
      if (!kids.length) {
        const v = toCents(edits[code]?.amount ?? "0");
        amountMemo.set(code, v);
        return v;
      }
      let dp = 0n;
      for (const kid of kids) dp += amountOf(kid) * signOf(map.get(kid)!.direction);
      const v = dp * signOf(item.direction);
      amountMemo.set(code, v);
      return v;
    };
    const ytdOf = (code: string): { d: bigint; c: bigint } => {
      const hit = ytdMemo.get(code);
      if (hit) return hit;
      const kids = children.get(code) ?? [];
      if (!kids.length) {
        const v = { d: toCents(edits[code]?.ytd_debit ?? "0"), c: toCents(edits[code]?.ytd_credit ?? "0") };
        ytdMemo.set(code, v);
        return v;
      }
      const v = kids.reduce((acc, kid) => {
        const one = ytdOf(kid);
        return { d: acc.d + one.d, c: acc.c + one.c };
      }, { d: 0n, c: 0n });
      ytdMemo.set(code, v);
      return v;
    };
    const out = new Map<string, { amount: bigint; ytd_debit: bigint; ytd_credit: bigint }>();
    for (const item of view.items) {
      const y = ytdOf(item.account_code);
      out.set(item.account_code, { amount: amountOf(item.account_code), ytd_debit: y.d, ytd_credit: y.c });
    }
    return out;
  }, [view, edits]);

  const totals = useMemo(() => {
    let dr = 0n;
    let cr = 0n;
    if (!view) return { dr: "0.00", cr: "0.00", diff: "0.00", balanced: true };
    for (const item of view.items) {
      if (!item.is_leaf) continue;
      const cents = rolled.get(item.account_code)?.amount ?? 0n;
      const natural = cents * signOf(item.direction);
      if (natural >= 0n) dr += cents < 0n ? -cents : cents;
      else cr += cents < 0n ? -cents : cents;
    }
    return { dr: fromCents(dr), cr: fromCents(cr), diff: fromCents(dr - cr), balanced: dr === cr };
  }, [view, rolled]);

  const visible = useMemo(() => {
    if (!view) return [];
    const query = q.trim().toLowerCase();
    if (!query) return view.items;
    const hit = new Set(view.items.filter((item) => {
      const py = byPy.get(item.account_code) ?? "";
      return item.account_code.toLowerCase().includes(query)
        || item.account_name.toLowerCase().includes(query)
        || py.toLowerCase().includes(query);
    }).map((item) => item.account_code));
    const keep = new Set(hit);
    const by = new Map(view.items.map((i) => [i.account_code, i]));
    for (const code of hit) {
      let parent = by.get(code)?.parent_code ?? null;
      while (parent) {
        keep.add(parent);
        parent = by.get(parent)?.parent_code ?? null;
      }
    }
    return view.items.filter((item) => keep.has(item.account_code));
  }, [view, q, byPy]);

  function editable(item: OpeningItem, col: Col) {
    if (!item.is_leaf || view?.locked) return false;
    if (col === "amount" && item.category === "pl") return false;
    return true;
  }

  function focusNext(code: string, col: Col, dir: 1 | -1) {
    const rows = visible.filter((item) => editable(item, col));
    const idx = rows.findIndex((item) => item.account_code === code);
    const next = rows[idx + dir];
    if (!next) return;
    inputs.current[`${next.account_code}:${col}`]?.focus();
  }

  async function save() {
    if (!view) return;
    setErr("");
    try {
      const items = view.items.filter((item) => item.is_leaf).map((item) => ({
        account_code: item.account_code,
        amount: edits[item.account_code]?.amount || "0",
        ytd_debit: mid ? (edits[item.account_code]?.ytd_debit || "0") : "0",
        ytd_credit: mid ? (edits[item.account_code]?.ytd_credit || "0") : "0",
      }));
      const next = await api.saveOpeningBalances({ start_period: start, items });
      load(next);
      setToast("已保存");
      window.setTimeout(() => setToast(""), 1600);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "保存失败");
    }
  }

  const startOptions = useMemo(() => {
    if (!start) return [];
    const values: string[] = [];
    for (let i = -18; i <= 18; i++) values.push(shiftPeriod(start, i));
    if (!values.includes(start)) values.push(start);
    return [...new Set(values)].sort().map((p) => ({ value: p, label: formatPeriod(p) }));
  }, [start]);

  if (loading) {
    return <div className="box" style={{ padding: 16 }}>{[0, 1, 2, 3].map((i) => <div key={i} className="skel" style={{ marginBottom: 10 }} />)}</div>;
  }
  if (!view) return err ? <Alert kind="bad">{err}</Alert> : null;

  return (
    <>
      {view.locked && view.lock_reason && <Alert kind="bad">{view.lock_reason}</Alert>}
      {err && <Alert kind="bad" onClose={() => setErr("")}>{err}</Alert>}
      {blocker.state === "blocked" && (
        <ConfirmBar text="有未保存的内容，确定离开？" confirmLabel="离开" onConfirm={() => blocker.proceed()} onCancel={() => blocker.reset()} />
      )}
      <div className="bookbar">
        <span className="tt">
          <Dropdown ariaLabel="建账期间" head="建账期间" value={start} label={start ? formatPeriod(start) : "建账期间"}
            options={startOptions} onChange={(v) => { if (!view.start_locked && !view.locked) setStart(v); }} />
          {view.start_locked && <Tip>已有凭证，不能改建账期间</Tip>}
        </span>
        <label className="sbox" style={{ margin: 0, width: 240, cursor: "text" }}>
          <Icon name="search" size={16} />
          <input aria-label="搜索科目" placeholder="编码、名称或拼音" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ border: 0, outline: "none", background: "transparent", font: "inherit", color: "var(--text)", minWidth: 0, flex: 1 }} />
        </label>
        <span style={{ flexGrow: 1 }} />
        <button className="btn pri" type="button" disabled={view.locked || !dirty} onClick={() => { void save(); }}>保存</button>
      </div>
      <div className="box bookscroll">
        <table className="tbl">
          <thead>
            <tr>
              <th>编码</th>
              <th>科目名称</th>
              <th>方向</th>
              {mid && <th className="num">年初余额</th>}
              {mid && <th className="num">本年累计借方</th>}
              {mid && <th className="num">本年累计贷方</th>}
              <th className="num">期初余额</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((item) => {
              const stat = rolled.get(item.account_code);
              const amount = fromCents(stat?.amount ?? 0n);
              const ytdDr = fromCents(stat?.ytd_debit ?? 0n);
              const ytdCr = fromCents(stat?.ytd_credit ?? 0n);
              const year = fromCents(toCents(amount) - signOf(item.direction) * (toCents(ytdDr) - toCents(ytdCr)));
              return (
                <tr key={item.account_code} className={item.is_leaf ? "" : "parentrow"}>
                  <td>{item.account_code}</td>
                  <td style={{ paddingLeft: 12 + (item.level - 1) * 16 }}>{item.account_name}</td>
                  <td>{item.direction === "debit" ? "借" : "贷"}</td>
                  {mid && <td className="num">{moneyCell(year)}</td>}
                  {mid && <td className="num">{item.is_leaf ? cellInput(item, "ytd_debit", edits, setEdits, inputs, view.locked, focusNext) : moneyCell(ytdDr)}</td>}
                  {mid && <td className="num">{item.is_leaf ? cellInput(item, "ytd_credit", edits, setEdits, inputs, view.locked, focusNext) : moneyCell(ytdCr)}</td>}
                  <td className="num">
                    {item.is_leaf
                      ? (item.category === "pl"
                        ? <span className="tt"><input className="cellinput" disabled value="" aria-label={`${item.account_name}期初`} /><Tip>损益类科目没有期初余额</Tip></span>
                        : cellInput(item, "amount", edits, setEdits, inputs, view.locked, focusNext))
                      : moneyCell(amount)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="trialbar">
        <span>借方合计 {formatMoney(totals.dr)}</span>
        <span>贷方合计 {formatMoney(totals.cr)}</span>
        <span className={"tag " + (totals.balanced ? "ok" : "bad")}>
          {totals.balanced ? "试算平衡" : `不平衡，差额 ${formatMoney(fromCents(toCents(totals.diff) < 0n ? -toCents(totals.diff) : toCents(totals.diff)))}`}
        </span>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}

function zeroBlank(value: string) {
  return isZero(value) ? "" : value;
}

function cellInput(
  item: OpeningItem,
  col: Col,
  edits: Edit,
  setEdits: (fn: (prev: Edit) => Edit) => void,
  inputs: React.MutableRefObject<Record<string, HTMLInputElement | null>>,
  locked: boolean,
  focusNext: (code: string, col: Col, dir: 1 | -1) => void,
) {
  if (locked) return moneyCell(edits[item.account_code]?.[col] ?? "");
  return (
    <MoneyInput
      allowNegative={col === "amount"}
      arrowMove
      value={edits[item.account_code]?.[col] ?? ""}
      ariaLabel={`${item.account_name}${col === "amount" ? "期初余额" : col === "ytd_debit" ? "本年累计借方" : "本年累计贷方"}`}
      inputRef={(el) => { inputs.current[`${item.account_code}:${col}`] = el; }}
      onChange={(v) => setEdits((prev) => ({
        ...prev,
        [item.account_code]: { ...prev[item.account_code], [col]: v },
      }))}
      onMove={(dir) => { focusNext(item.account_code, col, dir); return true; }}
      onBalance={() => undefined}
      onSwap={() => undefined}
    />
  );
}
