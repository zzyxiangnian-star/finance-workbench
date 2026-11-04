import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Dropdown } from "../components/Dropdown";
import { Icon } from "../components/Icon";
import { RightPane, TopActions, useRightPane } from "../components/RightPane";
import { Alert, SourceTag, StatusTag } from "../components/Status";
import { Tip } from "../components/Tip";
import { useApp } from "../lib/context";
import { formatMoney, formatPeriod, shortDate, sumMoney } from "../lib/format";
import { useDebounced } from "../lib/useDebounced";
import { ApiError, type PeriodInfo, type Voucher, type VoucherStatus } from "../shared/api";
import { VoucherDetail } from "./VoucherDetail";

type StatusFilter = "all" | VoucherStatus;
type SourceFilter = "all" | Voucher["source"];
const TABS = ["凭证", "账簿", "科目与辅助核算", "期末结账"] as const;

export function LedgerPage() {
  const { api } = useApp();
  const [params, setParams] = useSearchParams();
  const rp = useRightPane();
  const [tab, setTab] = useState<(typeof TABS)[number]>("凭证");
  const [periods, setPeriods] = useState<PeriodInfo[]>([]);
  const period = params.get("period") ?? "all";
  const [status, setStatus] = useState<StatusFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [kw, setKw] = useState("");
  const dkw = useDebounced(kw.trim(), 300);
  const [items, setItems] = useState<Voucher[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const selectedId = Number(params.get("v")) || null;

  const setParam = useCallback((k: string, v: string | null) => {
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (v === null) n.delete(k); else n.set(k, v);
      return n;
    }, { replace: true });
  }, [setParams]);

  // 期间列表；首次进入默认选最近一期
  useEffect(() => {
    api.periods().then((ps) => {
      setPeriods(ps);
      if (!params.get("period") && ps.length) setParam("period", ps[ps.length - 1].period);
    }).catch(() => setPeriods([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api.vouchers({
        period: period === "all" ? undefined : period,
        status: status === "all" ? undefined : status,
        keyword: dkw || undefined,
        limit: 500,
      });
      setItems(r.items);
      setTotal(r.total);
    } catch (e) {
      setItems([]);
      setErr(e instanceof ApiError ? e.message : "加载凭证失败，请检查本机服务是否在运行");
    }
  }, [api, period, status, dkw]);

  useEffect(() => { setItems(null); load(); }, [load]);

  // 来源筛选后端暂不支持，在已加载的结果里筛
  const shown = useMemo(() => (items ?? []).filter((v) => source === "all" || v.source === source), [items, source]);
  const selected = shown.find((v) => v.id === selectedId) ?? items?.find((v) => v.id === selectedId) ?? null;

  const open = (v: Voucher) => { setParam("v", String(v.id)); rp.setOpen(true); };
  const close = () => { setParam("v", null); rp.setOpen(false); };

  useEffect(() => { if (selectedId) rp.setOpen(true); }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const onChanged = (nv: Voucher) => setItems((list) => list?.map((v) => (v.id === nv.id ? nv : v)) ?? null);

  const periodOptions = [{ value: "all", label: "全部期间" }, ...[...periods].reverse().map((p) => ({
    value: p.period, label: formatPeriod(p.period) + (p.status === "closed" ? "（已结账）" : ""),
  }))];

  return (
    <>
      <TopActions>
        <Dropdown ariaLabel="会计期间" head="会计期间" icon={<Icon name="clock" size={16} />} value={period}
          label={period === "all" ? "全部期间" : formatPeriod(period)} options={periodOptions}
          onChange={(v) => setParam("period", v)} />
        <button className="iconbtn tt" type="button" aria-label="刷新" onClick={() => load()}>
          <Icon name="refresh" />
          <Tip>刷新</Tip>
        </button>
      </TopActions>

      <main className="content">
        <div className="tabs" role="group" aria-label="记账">
          {TABS.map((t) => (
            <button key={t} type="button" className={t === tab ? "on" : ""} aria-pressed={t === tab} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab !== "凭证" ? (
          <div className="empty"><span className="t">{tab}即将上线</span><span>在第一期第 6 步里做。</span></div>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              <Dropdown align="l" head="状态" value={status} onChange={setStatus}
                label={"状态：" + { all: "全部", draft: "待审核", reviewed: "已审核", posted: "已记账" }[status]}
                options={[{ value: "all", label: "全部" }, { value: "draft", label: "待审核" }, { value: "reviewed", label: "已审核" }, { value: "posted", label: "已记账" }]} />
              <Dropdown align="l" head="来源" value={source} onChange={setSource}
                label={"来源：" + { all: "全部", manual: "手工", ai: "AI 草稿", import: "导入" }[source]}
                options={[{ value: "all", label: "全部" }, { value: "manual", label: "手工" }, { value: "ai", label: "AI 草稿" }, { value: "import", label: "导入" }]} />
              <label className="sbox" style={{ margin: 0, width: 240, cursor: "text" }}>
                <Icon name="search" size={16} />
                <input aria-label="搜索凭证" placeholder="搜索摘要或科目" value={kw} onChange={(e) => setKw(e.target.value)}
                  style={{ border: 0, outline: "none", background: "transparent", font: "inherit", color: "var(--text)", minWidth: 0, flex: 1 }} />
              </label>
              <span style={{ flexGrow: 1 }} />
              <span className="tt" style={{ display: "inline-flex" }}>
                <button className="btn pri" type="button" disabled><Icon name="plus" size={16} />新增凭证</button>
                <Tip pos="end">凭证录入在下一步上线</Tip>
              </span>
            </div>

            {err && <Alert kind="bad" onClose={() => setErr(null)}>{err}</Alert>}

            <div className="box" style={{ overflow: "hidden" }}>
              <div className="scroll">
                <table className="tbl">
                  <thead>
                    <tr><th>凭证号</th><th>日期</th><th>摘要</th><th className="num">金额</th><th>制单人</th><th>状态</th><th>来源</th></tr>
                  </thead>
                  <tbody>
                    {items === null && [0, 1, 2, 3].map((i) => (
                      <tr key={i}>{Array.from({ length: 7 }, (_, j) => <td key={j}><div className="skel" style={{ width: j === 2 ? 160 : 56 }} /></td>)}</tr>
                    ))}
                    {items !== null && shown.map((v) => {
                      const firstDebit = v.lines.find((l) => l.debit !== "0.00");
                      return (
                        <tr key={v.id} className={"click" + (v.id === selectedId ? " on" : "")} onClick={() => open(v)}
                          tabIndex={0} onKeyDown={(e) => e.key === "Enter" && open(v)} aria-selected={v.id === selectedId}>
                          <td>{v.display_no}</td>
                          <td>{shortDate(v.date)}</td>
                          <td style={{ maxWidth: 260 }}>
                            <div className="ellipsis">{v.lines[0]?.summary}</div>
                            <div className="cap ellipsis">{firstDebit?.account_name}</div>
                          </td>
                          <td className="num">{formatMoney(v.total)}</td>
                          <td>{v.maker === "ai:hermes" ? "Hermes" : v.maker}</td>
                          <td><StatusTag status={v.status} /></td>
                          <td><SourceTag source={v.source} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {items !== null && shown.length === 0 && !err && (
                  <div className="empty">
                    <span className="t">没有符合条件的凭证</span>
                    <span>换个期间或清空搜索条件试试。</span>
                  </div>
                )}
              </div>
              <div className="cap" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderTop: "1px solid var(--line2)" }}>
                <span>共 {source === "all" ? total : shown.length} 张</span>
                <span style={{ flexGrow: 1 }} />
                <span>借贷合计 {formatMoney(sumMoney(shown.map((v) => v.total)))}</span>
              </div>
            </div>
            <span className="cap">审核人不能是制单人；AI 只能生成草稿，审核、记账必须由人完成。已记账的凭证不能直接修改。</span>
          </>
        )}
      </main>

      <RightPane>
        {selected ? (
          <VoucherDetail key={selected.id} v={selected} onChanged={onChanged} onClose={close} />
        ) : (
          <div className="empty" style={{ flex: 1 }}>
            <span className="t">凭证详情</span>
            <span>在左边列表里点一张凭证查看。</span>
          </div>
        )}
      </RightPane>
    </>
  );
}
