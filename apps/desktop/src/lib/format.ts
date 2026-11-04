/** 金额工具：全部基于字符串和 BigInt（以分为单位），不经过浮点数。 */

/** "1234567.5" -> "1,234,567.50" */
export function formatMoney(s: string | null | undefined): string {
  if (s == null || s === "") return "";
  const neg = s.trim().startsWith("-");
  const [int, frac = ""] = s.trim().replace(/^-/, "").split(".");
  const grouped = int.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + grouped + "." + (frac + "00").slice(0, 2);
}

/** 字符串元 -> BigInt 分 */
export function toCents(s: string): bigint {
  const t = s.trim().replace(/,/g, "");
  if (!/^-?\d*(\.\d{0,2})?$/.test(t) || t === "" || t === "-") return 0n;
  const neg = t.startsWith("-");
  const [int, frac = ""] = t.replace(/^-/, "").split(".");
  const v = BigInt(int || "0") * 100n + BigInt((frac + "00").slice(0, 2));
  return neg ? -v : v;
}

/** BigInt 分 -> 字符串元 */
export function fromCents(c: bigint): string {
  const neg = c < 0n;
  const a = neg ? -c : c;
  return (neg ? "-" : "") + (a / 100n).toString() + "." + (a % 100n).toString().padStart(2, "0");
}

export function sumMoney(list: string[]): string {
  return fromCents(list.reduce((acc, s) => acc + toCents(s), 0n));
}

export function isZero(s: string): boolean {
  return toCents(s) === 0n;
}

/** "2026-11" -> "2026 年 11 月" */
export function formatPeriod(p: string): string {
  const [y, m] = p.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

/** "2026-11-05" -> "11-05" */
export function shortDate(d: string): string {
  return d.slice(5);
}
