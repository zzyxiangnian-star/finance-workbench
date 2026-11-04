import type { ReactNode } from "react";

/** 悬浮提示：父元素需带 .tt 类（原型样式），这里只负责渲染提示气泡。 */
export function Tip({ children, pos }: { children: ReactNode; pos?: "r" | "end" | "up" }) {
  return <span className={"tip" + (pos ? " " + pos : "")} role="tooltip">{children}</span>;
}
