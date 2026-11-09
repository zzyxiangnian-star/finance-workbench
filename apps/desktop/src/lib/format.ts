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

const CN_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"] as const;
const CN_SMALL = ["", "拾", "佰", "仟"] as const;
const CN_BIG = ["", "万", "亿", "兆"] as const;

/** 0..9999 的一段。末尾的零不写，中间的零只留一个。 */
function groupCn(g: bigint): string {
  if (g === 0n) return "";
  let s = "";
  let pending = false;
  for (let i = 3; i >= 0; i--) {
    const d = Number((g / 10n ** BigInt(i)) % 10n);
    if (d === 0) {
      if (s) pending = true;
    } else {
      if (pending) {
        s += "零";
        pending = false;
      }
      s += CN_DIGITS[d] + CN_SMALL[i];
    }
  }
  return s;
}

/** 整数元。万、亿按四位一组；组与组之间缺位时补一个零。 */
function intCn(n: bigint): string {
  if (n === 0n) return "零";
  const groups: bigint[] = [];
  let x = n;
  while (x > 0n) {
    groups.push(x % 10000n);
    x /= 10000n;
  }
  let result = "";
  let needZero = false;
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0n) {
      needZero = true;
      continue;
    }
    if (result && (needZero || g < 1000n)) result += "零";
    result += groupCn(g) + CN_BIG[i];
    needZero = false;
  }
  return result;
}

/**
 * 人民币大写。只走分（BigInt），不经过浮点。
 * 角为 0 且分不为 0 时写「零」；整万元以上又带角时，在「元」和角之间也写「零」。
 */
export function moneyUpper(s: string): string {
  const cents = toCents(s);
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const yuan = abs / 100n;
  const jiao = Number((abs / 10n) % 10n);
  const fen = Number(abs % 10n);
  let body: string;
  if (yuan === 0n && jiao === 0 && fen === 0) {
    body = "零元整";
  } else {
    body = (yuan === 0n ? "零" : intCn(yuan)) + "元";
    if (jiao === 0 && fen === 0) {
      body += "整";
    } else {
      if (yuan !== 0n && ((jiao === 0 && fen > 0) || (yuan % 10000n === 0n && jiao > 0))) body += "零";
      if (jiao) body += CN_DIGITS[jiao] + "角";
      if (fen) body += CN_DIGITS[fen] + "分";
    }
  }
  return (neg ? "负" : "") + body;
}
