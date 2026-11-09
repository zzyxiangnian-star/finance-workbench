import { useEffect, useRef, useState } from "react";
import { useDebounced } from "../lib/useDebounced";
import type { Api } from "../shared/api";
import type { CellMove } from "./MoneyInput";

/** 摘要格：按最近使用过的摘要联想。方向键选中后，Enter 才采纳。 */
export function SummaryField({
  api, value, open, onOpenChange, onChange, onMove, ariaLabel, inputRef, onFocus,
}: {
  api: Api;
  value: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (v: string) => void;
  onMove: CellMove;
  ariaLabel: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onFocus?: () => void;
}) {
  const [query, setQuery] = useState(value);
  const [items, setItems] = useState<string[]>([]);
  const [hi, setHi] = useState(0);
  const [armed, setArmed] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const draft = useRef(value);
  const dq = useDebounced(open ? query.trim() : "", 200);

  useEffect(() => {
    if (!open) return;
    let live = true;
    api.summaries(dq, 10).then((list) => { if (live) setItems(list); }).catch(() => { if (live) setItems([]); });
    return () => { live = false; };
  }, [api, open, dq]);

  useEffect(() => {
    if (open) itemRefs.current[hi]?.scrollIntoView({ block: "nearest" });
  }, [open, hi, items.length]);

  const pick = (text: string) => {
    draft.current = text;
    onChange(text);
    setQuery(text);
    onOpenChange(false);
  };

  return (
    <div className="picker">
      <input
        ref={inputRef}
        className="cellinput"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-autocomplete="list"
        role="combobox"
        placeholder="摘要"
        value={open ? query : value}
        onFocus={() => {
          draft.current = value;
          setQuery(value);
          setHi(0);
          setArmed(false);
          onOpenChange(true);
          onFocus?.();
        }}
        onBlur={() => {
          onChange(draft.current);
          window.setTimeout(() => onOpenChange(false), 120);
        }}
        onChange={(e) => {
          draft.current = e.target.value;
          setQuery(e.target.value);
          onChange(e.target.value);
          setHi(0);
          setArmed(false);
          if (!open) onOpenChange(true);
        }}
        onKeyDown={(e) => {
          if (open && items.length > 0 && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setArmed(true);
            setHi((h) => {
              const n = e.key === "ArrowDown" ? h + 1 : h - 1;
              return (n + items.length) % items.length;
            });
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            const dir: 1 | -1 = e.shiftKey ? -1 : 1;
            const key = e.key === "Enter" ? "Enter" : "Tab";
            if (open && armed && items[hi] && !(e.key === "Tab" && e.shiftKey)) pick(items[hi]);
            if (onMove(dir, key)) e.preventDefault();
          }
        }}
      />
      {open && items.length > 0 && (
        <div className="menu l picker-menu" role="listbox" aria-label="摘要联想">
          {items.map((text, idx) => (
            <button
              key={text}
              ref={(el) => { itemRefs.current[idx] = el; }}
              type="button"
              role="option"
              aria-selected={idx === hi}
              className={"mi" + (idx === hi ? " hi" : "")}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => { setHi(idx); setArmed(true); }}
              onClick={() => pick(text)}
            >
              <span className="ellipsis">{text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
