export function ConfirmBar({
  text, onCancel, onOk,
}: {
  text: string;
  onCancel: () => void;
  onOk: () => void;
}) {
  return (
    <div className="confirmbar">
      <span>{text}</span>
      <button className="btn" onClick={onCancel}>取消</button>
      <button className="btn" type="button" onClick={onOk}>删除</button>
    </div>
  );
}
