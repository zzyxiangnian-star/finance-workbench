import type { Voucher, VoucherStatus } from "../shared/api";

const STATUS: Record<VoucherStatus, { label: string; cls: string }> = {
  draft: { label: "待审核", cls: "warn" },
  reviewed: { label: "已审核", cls: "ok" },
  posted: { label: "已记账", cls: "" },
};

const SOURCE: Record<Voucher["source"], { label: string; cls: string }> = {
  manual: { label: "手工", cls: "" },
  ai: { label: "AI 草稿", cls: "ai" },
  import: { label: "导入", cls: "" },
};

export const statusLabel = (s: VoucherStatus) => STATUS[s].label;

export function StatusTag({ status }: { status: VoucherStatus }) {
  const s = STATUS[status];
  return <span className={"tag " + s.cls}>{s.label}</span>;
}

export function SourceTag({ source }: { source: Voucher["source"] }) {
  const s = SOURCE[source];
  return <span className={"tag " + s.cls}>{s.label}</span>;
}

export function Alert({ kind, children, onClose }: { kind: "bad" | "ok"; children: React.ReactNode; onClose?: () => void }) {
  return (
    <div className={"alert " + kind} role={kind === "bad" ? "alert" : "status"}>
      <span>{children}</span>
      {onClose && <button className="x" type="button" aria-label="关闭提示" onClick={onClose}>×</button>}
    </div>
  );
}
