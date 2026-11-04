import { createContext, useContext } from "react";
import type { Api } from "../shared/api";

export interface AppCtx {
  api: Api;
  user: string;
  setUser: (u: string) => void;
}

export const Ctx = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useApp 必须在 <Ctx.Provider> 内使用");
  return c;
}
