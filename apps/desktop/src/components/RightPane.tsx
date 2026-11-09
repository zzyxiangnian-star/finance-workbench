import { createContext, useContext, useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 页面通过 <RightPane> 把内容渲染进外壳的右侧栏，通过 <TopActions> 渲染进顶栏。 */
export interface PaneCtx {
  rightEl: HTMLElement | null;
  topEl: HTMLElement | null;
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
  /** 进入某页时强制打开，并记住进来之前的开关。 */
  holdRightOpen: () => void;
  /** 离开该页时恢复进来之前的开关。 */
  releaseRightOpen: () => void;
  setHasRight: (v: boolean) => void;
}

export const PaneContext = createContext<PaneCtx | null>(null);

function usePane() {
  const c = useContext(PaneContext);
  if (!c) throw new Error("PaneContext 缺失");
  return c;
}

export function useRightPane() {
  const { rightOpen, setRightOpen, holdRightOpen, releaseRightOpen } = usePane();
  return { open: rightOpen, setOpen: setRightOpen, hold: holdRightOpen, release: releaseRightOpen };
}

export function RightPane({ children }: { children: ReactNode }) {
  const { rightEl, setHasRight } = usePane();
  useEffect(() => {
    setHasRight(true);
    return () => setHasRight(false);
  }, [setHasRight]);
  return rightEl ? createPortal(children, rightEl) : null;
}

export function TopActions({ children }: { children: ReactNode }) {
  const { topEl } = usePane();
  return topEl ? createPortal(children, topEl) : null;
}
