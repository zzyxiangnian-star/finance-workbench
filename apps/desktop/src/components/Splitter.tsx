import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Tip } from "./Tip";

/**
 * 栏间分割线（原型 .split）。side="l" 时向右拖变宽；side="r" 时向左拖变宽。
 * 双击还原默认宽度，方向键每次 16px。
 */
export function Splitter(props: {
  side: "l" | "r";
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onChange: (w: number) => void;
  onDragging: (d: boolean) => void;
  label: string;
}) {
  const [active, setActive] = useState(false);
  const start = useRef({ x: 0, w: 0 });
  const clamp = (v: number) => Math.round(Math.min(props.max, Math.max(props.min, v)));

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: props.width };
    setActive(true);
    props.onDragging(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!active) return;
    const d = e.clientX - start.current.x;
    props.onChange(clamp(props.side === "l" ? start.current.w + d : start.current.w - d));
  };
  const up = () => {
    if (!active) return;
    setActive(false);
    props.onDragging(false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const d = e.key === "ArrowLeft" ? -16 : 16;
    props.onChange(clamp(props.side === "l" ? props.width + d : props.width - d));
  };

  return (
    <div className={"split tt" + (active ? " active" : "")} role="separator" aria-orientation="vertical"
      aria-label={props.label} aria-valuenow={props.width} aria-valuemin={props.min} aria-valuemax={props.max}
      tabIndex={0} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      onDoubleClick={() => props.onChange(props.defaultWidth)} onKeyDown={key}>
      <span className="grip" />
      {props.side === "l" ? (
        <Tip pos="r">拖动调整宽度，双击还原</Tip>
      ) : (
        <span className="tip up" style={{ top: "50%", bottom: "auto", left: "auto", right: 10, transform: "translate(0,-50%)" }}>
          拖动调整宽度，双击还原
        </span>
      )}
    </div>
  );
}
