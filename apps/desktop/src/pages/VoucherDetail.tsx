import { useState } from "react";
import { Icon } from "../components/Icon";
import { Alert, SourceTag, StatusTag } from "../components/Status";
import { Tip } from "../components/Tip";
import { useApp } from "../lib/context";
import { formatMoney, isZero, sumMoney } from "../lib/format";
import { ApiError, type Voucher } from "../shared/api";

type Action = "review" | "unreview" | "post";

const ACTION_LABEL: Record<Action, string> = { review: "审核", unreview: "反审核", post: "记账" };

/** 右侧栏：凭证详情 + 按状态显示的操作。规则以后端为准，这里只做提示。 */
export function VoucherDetail({ v, onChanged, onClose }: { v: Voucher; onChanged: (v: Voucher) => void; onClose: () => void }) {
  const { api, user } = useApp();
  const [busy, setBusy] = useState<Action | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const dr = sumMoney(v.lines.map((l) => l.debit));
  const cr = sumMoney(v.lines.map((l) => l.credit));
  const balanced = dr === cr;

  const run = async (a: Action) => {
    setBusy(a);
    setErr(null);
    setOk(null);
    try {
      const nv = await api[a](v.id);
      onChanged(nv);
      setOk(`${ACTION_LABEL[a]}成功`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "操作失败，请检查本机服务是否在运行");
    } finally {
      setBusy(null);
    }
  };

  const selfReview = v.status === "draft" && v.maker === user;
  const notReviewer = v.status === "reviewed" && v.reviewer !== user;

  return (
    <>
      <div className="rhead">
        <span className="h2">{v.display_no}</span>
        <StatusTag status={v.status} />
        {v.source !== "manual" && <SourceTag source={v.source} />}
        <button className="iconbtn tt" type="button" aria-label="关闭面板" onClick={onClose}>
          <Icon name="close" />
          <Tip pos="end">关闭面板</Tip>
        </button>
      </div>
      <div className="rbody">
        <dl className="kv">
          <dt>日期</dt><dd>{v.date}</dd>
          <dt>附件</dt><dd>{v.attachments} 张</dd>
          {v.note && (<><dt>备注</dt><dd>{v.note}</dd></>)}
        </dl>

        <div className="box" style={{ overflow: "hidden" }}>
          <table className="tbl">
            <thead><tr><th>科目</th><th className="num">借方</th><th className="num">贷方</th></tr></thead>
            <tbody>
              {v.lines.map((l) => (
                <tr key={l.line_no}>
                  <td className="wrap">
                    <div>{l.account_name}</div>
                    <div className="cap">{l.account_code}，{l.summary}</div>
                  </td>
                  <td className="num">{isZero(l.debit) ? "" : formatMoney(l.debit)}</td>
                  <td className="num">{isZero(l.credit) ? "" : formatMoney(l.credit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--line)", fontWeight: 600, fontSize: 13 }}>
            <span>合计</span>
            <span className={"tag " + (balanced ? "ok" : "bad")}>{balanced ? "借贷平衡" : "借贷不平"}</span>
            <span style={{ flexGrow: 1 }} />
            <span className="num">{formatMoney(dr)}</span>
          </div>
        </div>

        {v.source === "ai" && (
          <div className="note ai">
            <span style={{ fontWeight: 500, display: "flex", gap: 6, alignItems: "center" }}><Icon name="sparkle" size={16} />Hermes 生成的草稿</span>
            <span>AI 只能生成草稿。请核对科目和金额后再审核，审核和记账必须由人完成。</span>
          </div>
        )}

        <dl className="kv">
          <dt>制单</dt><dd>{v.maker === "ai:hermes" ? "Hermes（AI）" : v.maker}</dd>
          <dt>审核</dt><dd>{v.reviewer ?? <span className="muted">未审核</span>}</dd>
          <dt>记账</dt><dd>{v.poster ?? <span className="muted">未记账</span>}</dd>
        </dl>

        {err && <Alert kind="bad" onClose={() => setErr(null)}>{err}</Alert>}
        {ok && <Alert kind="ok" onClose={() => setOk(null)}>{ok}</Alert>}

        <div style={{ marginTop: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          {v.status === "draft" && (
            <span className="tt" style={{ display: "inline-flex" }}>
              <button className="btn pri" type="button" disabled={!!busy || selfReview} onClick={() => run("review")}>
                {busy === "review" ? "审核中…" : "审核"}
              </button>
              {selfReview && <Tip pos="up">审核人不能是制单人，请切换操作人</Tip>}
            </span>
          )}
          {v.status === "reviewed" && (
            <>
              <button className="btn pri" type="button" disabled={!!busy} onClick={() => run("post")}>
                {busy === "post" ? "记账中…" : "记账"}
              </button>
              <span className="tt" style={{ display: "inline-flex" }}>
                <button className="btn" type="button" disabled={!!busy || notReviewer} onClick={() => run("unreview")}>
                  {busy === "unreview" ? "处理中…" : "反审核"}
                </button>
                {notReviewer && <Tip pos="up">只有原审核人 {v.reviewer} 可以反审核</Tip>}
              </span>
            </>
          )}
          {selfReview && <span className="cap" style={{ alignSelf: "center" }}>你是制单人，不能审核自己的凭证</span>}
          {v.status === "posted" && <span className="cap">已记账的凭证不能修改，改错请做冲销凭证。</span>}
        </div>
      </div>
    </>
  );
}
