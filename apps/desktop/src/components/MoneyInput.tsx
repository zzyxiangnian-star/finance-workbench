import { useEffect, useState } from "react";
import { formatMoney, fromCents, toCents } from "../lib/format";

export type CellMove = (dir: 1 | -1, key: "Enter" | "Tab") => boolean;

const TYPING = /^\d*\.?\d{0,2}$/;
const PASTE_OK = /^\d+(\.\d{0,2})?$/;

/** 金额格：内部始终是字符串。失焦显示千分位；粘贴带逗号的数字会去掉逗号。 */
export function MoneyInput({
  value, onChange, onMove, onBalance, onSwap, ariaLabel, inputRef, onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onMove: CellMove;
  onBalance: () => void;
  onSwap: () => void;
  ariaLabel: string;
  inputRef: (el: HTMLInputElement | null) => void;
  onFocus?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => { setDraft(value); }, [value]);

  const shown = focused ? draft : (value ? formatMoney(value) : "");

  const commit = (raw: string) => {
    if (raw === "" || raw === ".") {
      setDraft("");
      onChange("");
      return;
    }
    const canon = fromCents(toCents(raw));
    setDraft(canon);
    onChange(canon);
  };

  return (
    <input
      ref={inputRef}
      className="cellinput"
      aria-label={ariaLabel}
      inputMode="decimal"
      value={shown}
      onFocus={() => {
        setFocused(true);
        setDraft(value);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        commit(draft);
      }}
      onChange={(e) => {
        const v = e.target.value.replace(/,/g, "").trim();
        if (v !== "" && !TYPING.test(v)) return;
        setDraft(v);
        onChange(v === "." ? "" : v);
      }}
      onPaste={(e) => {
        e.preventDefault();
        const raw = e.clipboardData.getData("text").replace(/,/g, "").replace(/\s/g, "");
        if (!PASTE_OK.test(raw)) return;
        commit(raw);
      }}
      onKeyDown={(e) => {
        if (e.key === "=") {
          e.preventDefault();
          onBalance();
          return;
        }
        if (e.key === " ") {
          e.preventDefault();
          onSwap();
          return;
        }
        if (e.key === "Enter" || e.key === "Tab") {
          const dir: 1 | -1 = e.shiftKey ? -1 : 1;
          const key = e.key === "Enter" ? "Enter" : "Tab";
          if (onMove(dir, key)) e.preventDefault();
        }
      }}
    />
  );
}
