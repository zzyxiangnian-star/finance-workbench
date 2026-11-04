import type { IconName } from "../components/Icon";

export interface RouteDef {
  path: string;
  title: string;
  icon: IconName;
  group?: "账务" | "资料";
  keywords?: string;
}

/** 导航顺序与原型一致 */
export const ROUTES: RouteDef[] = [
  { path: "/", title: "首页", icon: "home", keywords: "shouye home" },
  { path: "/chat", title: "AI 对话", icon: "chat", keywords: "hermes ai duihua" },
  { path: "/ledger", title: "记账", icon: "ledger", group: "账务", keywords: "pingzheng jizhang voucher" },
  { path: "/reports", title: "报表", icon: "reports", group: "账务", keywords: "baobiao" },
  { path: "/invoices", title: "发票中心", icon: "invoice", group: "账务", keywords: "fapiao" },
  { path: "/bank", title: "银行对账", icon: "bank", group: "账务", keywords: "yinhang duizhang" },
  { path: "/expense", title: "报销", icon: "wallet", group: "账务", keywords: "baoxiao" },
  { path: "/knowledge", title: "知识库", icon: "graph", group: "资料", keywords: "zhishiku" },
  { path: "/workspace", title: "文件工作区", icon: "file", group: "资料", keywords: "wenjian" },
  { path: "/toolbox", title: "工具箱", icon: "tool", group: "资料", keywords: "gongju zhuanhuan" },
  { path: "/settings", title: "设置", icon: "settings", keywords: "shezhi" },
];

export const routeOf = (path: string) => ROUTES.find((r) => r.path === path);
