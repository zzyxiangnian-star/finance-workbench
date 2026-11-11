import { useEffect, useMemo, useRef, useState } from "react";
import type { Account } from "../shared/api";
import type { CellMove } from "./MoneyInput";

/** 末级科目选择：编码、名称、拼音首字母都能筛。 */
export function AccountPicker({
  accounts, code, open, onOpenChange, onChange, onMove, ariaLabel, inputRef, onFocus, allowParent,
}: {
  accounts: Account[];
  code: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (code: string) => void;
  onMove: CellMove;
  ariaLabel: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onFocus?: () => void;
  allowParent?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const [armed, setArmed] = useState(false);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = accounts.find((a) => a.code === code);
  const label = selected ? `${selected.code} ${selected.name}` : code;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHi(0);
    setArmed(false);
  }, [open]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts.filter((a) => a.enabled && (allowParent || a.is_leaf) && (
      !q
      || a.code.toLowerCase().includes(q)
      || a.name.toLowerCase().includes(q)
      || a.py.toLowerCase().includes(q)
    ));
  }, [accounts, query, allowParent]);

  useEffect(() => {
    if (hi >= matches.length) setHi(0);
  }, [hi, matches.length]);

  useEffect(() => {
    if (open) itemRefs.current[hi]?.scrollIntoView({ block: "nearest" });
  }, [open, hi, matches.length]);

  const pick = (a: Account) => {
    onChange(a.code);
    onOpenChange(false);
  };

  const confirmHighlighted = () => {
    const a = matches[hi];
    if (!a) return false;
    if (!armed && query.trim() === "") return false;
    pick(a);
    return true;
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
        placeholder={label || "编码、名称或拼音"}
        value={open ? query : label}
        onFocus={() => {
          onOpenChange(true);
          onFocus?.();
        }}
        onBlur={() => {
          window.setTimeout(() => onOpenChange(false), 120);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setHi(0);
          setArmed(false);
          if (!open) onOpenChange(true);
        }}
        onKeyDown={(e) => {
          if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setArmed(true);
            setHi((h) => {
              if (!matches.length) return 0;
              const n = e.key === "ArrowDown" ? h + 1 : h - 1;
              return (n + matches.length) % matches.length;
            });
            return;
          }
          if (e.key === "Enter" || e.key === "Tab") {
            const dir: 1 | -1 = e.shiftKey ? -1 : 1;
            const key = e.key === "Enter" ? "Enter" : "Tab";
            if (open && !(e.key === "Tab" && e.shiftKey)) confirmHighlighted();
            if (onMove(dir, key)) e.preventDefault();
          }
        }}
      />
      {open && (
        <div className="menu l picker-menu" role="listbox" aria-label="科目">
          {matches.length === 0 && <div className="mhead">{allowParent ? "没有匹配的科目" : "没有匹配的末级科目"}</div>}
          {matches.map((a, idx) => (
            <button
              key={a.code}
              ref={(el) => { itemRefs.current[idx] = el; }}
              type="button"
              role="option"
              aria-selected={idx === hi}
              className={"mi" + (idx === hi ? " hi" : "")}
              onMouseDown={(ev) => ev.preventDefault()}
              onMouseEnter={() => { setHi(idx); setArmed(true); }}
              onClick={() => pick(a)}
            >
              <span className="ellipsis">{a.code} {a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
