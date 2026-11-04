import { invoke } from "@tauri-apps/api/core";

export interface BackendConfig {
  baseUrl: string;
  token: string;
}

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Tauri 里从数据目录读令牌；纯浏览器开发时用 VITE_FW_TOKEN。 */
export async function getBackendConfig(): Promise<BackendConfig> {
  if (inTauri()) return invoke<BackendConfig>("get_backend_config");
  const token = import.meta.env.VITE_FW_TOKEN as string | undefined;
  if (!token) throw new Error("浏览器开发模式需要在 .env.local 里设置 VITE_FW_TOKEN");
  return { baseUrl: (import.meta.env.VITE_FW_BASE_URL as string | undefined) ?? "http://127.0.0.1:8765", token };
}

export async function ping(baseUrl: string): Promise<boolean> {
  try {
    const r = await fetch(baseUrl + "/api/health");
    return r.ok;
  } catch {
    return false;
  }
}
