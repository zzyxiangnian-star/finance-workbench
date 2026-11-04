import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon";

export interface Option<T extends string> {
  value: T;
  label: string;
}

/** 原型里的 .ddbtn + .menu 下拉。点外面或按 Esc 关闭。 */
export function Dropdown<T extends string>(props: {
  label: ReactNode;
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  head?: string;
  align?: "l" | "r";
  ariaLabel?: string;
  icon?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button className={"ddbtn" + (open ? " open" : "")} type="button" aria-haspopup="menu" aria-expanded={open}
        aria-label={props.ariaLabel} onClick={() => setOpen(!open)}>
        {props.icon}
        {props.label}
        <Icon name="chev" size={14} className="chev" />
      </button>
      {open && (
        <div className={"menu" + (props.align === "l" ? " l" : "")} role="menu">
          {props.head && <div className="mhead">{props.head}</div>}
          {props.options.map((o) => (
            <button key={o.value} className={"mi" + (o.value === props.value ? " on" : "")} type="button"
              role="menuitemradio" aria-checked={o.value === props.value}
              onClick={() => { props.onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>
              {o.value === props.value && <span className="check"><Icon name="check" size={16} /></span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
