/**
 * 前端与本机服务（services/core）的接口契约。由总指挥（Claude）维护。
 * 任务卡里的界面代码只能通过这里的函数访问后端，不能自己拼 fetch。
 * 要改这里，在报告里写“契约变更请求”，审查通过后由总指挥改。
 * 对应后端：services/core/src/finance_core/api.py；说明：docs/CONTRACT.md
 * 契约版本：0.1
 */

export type Money = string; // 元，两位小数字符串，如 "1280.00"。前端不要转成 number 做加减。
export type Period = string; // "2026-11"
export type VoucherStatus = "draft" | "reviewed" | "posted";

export interface Account {
  code: string;
  name: string;
  category: "asset" | "liability" | "common" | "equity" | "cost" | "pl";
  direction: "debit" | "credit";
  parent_code: string | null;
  enabled: boolean;
  is_leaf: boolean;
  py: string; // 名称拼音首字母，如 glfy-bgf
}

export interface VoucherLine {
  line_no: number;
  summary: string;
  account_code: string;
  account_name: string;
  debit: Money;
  credit: Money;
}

export interface Voucher {
  id: number;
  period: Period;
  word: string;
  number: number;
  display_no: string; // "记-0003"
  date: string; // YYYY-MM-DD
  attachments: number;
  status: VoucherStatus;
  source: "manual" | "ai" | "import";
  maker: string;
  reviewer: string | null;
  poster: string | null;
  note: string;
  total: Money;
  lines: VoucherLine[];
  created_at: string;
  updated_at: string;
}

export interface VoucherLineInput {
  summary: string;
  account_code: string;
  debit?: Money;
  credit?: Money;
}

export interface VoucherInput {
  date: string;
  lines: VoucherLineInput[];
  word?: string;
  attachments?: number;
  note?: string;
}

export interface VoucherQuery {
  period?: Period;
  date_from?: string;
  date_to?: string;
  status?: VoucherStatus;
  keyword?: string;
  account_code?: string;
  min_amount?: Money;
  max_amount?: Money;
  limit?: number;
  offset?: number;
}

export interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  direction: "debit" | "credit";
  opening: Money;
  debit: Money;
  credit: Money;
  closing: Money;
}

export interface TrialBalance {
  period: Period;
  include_unposted: boolean;
  items: TrialBalanceRow[];
  totals: Record<"dr" | "cr" | "ob_dr" | "ob_cr" | "cb_dr" | "cb_cr", Money>;
  balanced: boolean;
}

export interface AccountBalance {
  account_code: string;
  account_name: string;
  direction: "debit" | "credit";
  period: Period;
  include_unposted: boolean;
  opening: Money;
  debit: Money;
  credit: Money;
  closing: Money;
}

export interface PeriodInfo {
  period: Period;
  status: "open" | "closed";
  closed_by: string | null;
  closed_at: string | null;
}

/** 后端业务错误。code 稳定，可用于判断；message 直接给用户看。 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export interface ClientConfig {
  baseUrl: string; // 默认 http://127.0.0.1:8765
  token: string; // Tauri 启动时从数据目录的 api-token 读取
  user: string; // 当前操作人
}

/** 对话流事件（由 /api/chat 的 SSE 解析而来） */
export type ChatEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; id: string; name: string; label?: string; status: "running" | "completed" } // hermes.tool.progress
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export function createClient(cfg: ClientConfig) {
  const headers = () => ({
    Authorization: `Bearer ${cfg.token}`,
    "X-FW-User": encodeURIComponent(cfg.user),
  });

  async function req<T>(method: string, path: string, body?: unknown, query?: object): Promise<T> {
    const url = new URL(cfg.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: { ...headers(), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data.error ?? data.detail ?? {};
      throw new ApiError(res.status, e.code ?? "http_error", e.message ?? `请求失败（${res.status}）`);
    }
    return data as T;
  }

  return {
    health: () => req<{ ok: boolean; version: string }>("GET", "/api/health"),
    accounts: (includeDisabled = false) =>
      req<Account[]>("GET", "/api/accounts", undefined, { include_disabled: includeDisabled }),
    accountBalance: (code: string, period: Period, includeUnposted = false) =>
      req<AccountBalance>("GET", `/api/accounts/${encodeURIComponent(code)}/balance`, undefined, {
        period, include_unposted: includeUnposted,
      }),
    summaries: (q = "", limit = 10) => req<string[]>("GET", "/api/summaries", undefined, { q, limit }),
    periods: () => req<PeriodInfo[]>("GET", "/api/periods"),
    closePeriod: (p: Period) => req<{ ok: true }>("POST", `/api/periods/${p}/close`),
    vouchers: (q: VoucherQuery = {}) => req<{ total: number; items: Voucher[] }>("GET", "/api/vouchers", undefined, q),
    voucher: (id: number) => req<Voucher>("GET", `/api/vouchers/${id}`),
    createVoucher: (v: VoucherInput) => req<Voucher>("POST", "/api/vouchers", v),
    nextVoucherNumber: (period: Period, word = "记") =>
      req<{ display_no: string }>("GET", "/api/vouchers/next-number", undefined, { period, word }),
    updateVoucher: (id: number, v: VoucherInput) => req<Voucher>("PUT", `/api/vouchers/${id}`, v),
    deleteVoucher: (id: number) => req<{ ok: true }>("DELETE", `/api/vouchers/${id}`),
    review: (id: number) => req<Voucher>("POST", `/api/vouchers/${id}/review`),
    unreview: (id: number) => req<Voucher>("POST", `/api/vouchers/${id}/unreview`),
    post: (id: number) => req<Voucher>("POST", `/api/vouchers/${id}/post`),
    trialBalance: (period: Period, includeUnposted = false) =>
      req<TrialBalance>("GET", "/api/reports/trial-balance", undefined, { period, include_unposted: includeUnposted }),

    /** 流式对话。用法：for await (const ev of api.chat(msgs, sid)) {...} */
    async *chat(messages: ChatMessage[], sessionId?: string, signal?: AbortSignal): AsyncGenerator<ChatEvent> {
      const res = await fetch(cfg.baseUrl + "/api/chat", {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ messages, session_id: sessionId }),
        signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        const e = data.detail ?? {};
        yield { type: "error", code: e.code ?? "http_error", message: e.message ?? `对话失败（${res.status}）` };
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = parseSse(block);
          if (ev) {
            yield ev;
            if (ev.type === "done") return;
          }
        }
      }
      yield { type: "done" };
    },
  };
}

function parseSse(block: string): ChatEvent | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue; // keepalive
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  const raw = data.join("\n");
  if (!raw) return null;
  if (raw === "[DONE]") return { type: "done" };
  try {
    const j = JSON.parse(raw);
    if (event === "hermes.tool.progress")
      return { type: "tool", id: j.toolCallId ?? "", name: j.tool ?? "工具", label: j.label, status: j.status === "completed" ? "completed" : "running" };
    if (event === "error") return { type: "error", code: j.code ?? String(j.status ?? "error"), message: j.message ?? j.detail ?? "出错了" };
    const text = j.choices?.[0]?.delta?.content;
    return text ? { type: "delta", text } : null;
  } catch {
    return null;
  }
}

export type Api = ReturnType<typeof createClient>;
