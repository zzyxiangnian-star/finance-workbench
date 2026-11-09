/** 页面内确认条。不要用 window.confirm。 */
export function ConfirmBar({
  text, confirmLabel, onConfirm, onCancel, danger, busy,
}: {
  text: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <div className="confirmbar" role="group" aria-label={text}>
      <span>{text}</span>
      <span className="spacer" />
      <button className={"btn sm" + (danger ? " danger" : " pri")} type="button" disabled={busy} onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button className="btn sm" type="button" disabled={busy} onClick={onCancel}>取消</button>
    </div>
  );
}
