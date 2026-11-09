import { describe, expect, it } from "vitest";
import { fromCents, moneyUpper, sumMoney, toCents } from "./format";

describe("moneyUpper", () => {
  it("覆盖零、分、整十、中间零、亿和任务卡例子", () => {
    expect(moneyUpper("0")).toBe("零元整");
    expect(moneyUpper("0.00")).toBe("零元整");
    expect(moneyUpper("0.05")).toBe("零元伍分");
    expect(moneyUpper("10.00")).toBe("壹拾元整");
    expect(moneyUpper("1001.50")).toBe("壹仟零壹元伍角");
    expect(moneyUpper("100000000.00")).toBe("壹亿元整");
    expect(moneyUpper("1280.00")).toBe("壹仟贰佰捌拾元整");
    expect(moneyUpper("3180.50")).toBe("叁仟壹佰捌拾元伍角");
  });

  it("补容易漏掉的零", () => {
    expect(moneyUpper("100010.00")).toBe("壹拾万零壹拾元整");
    expect(moneyUpper("1000000.05")).toBe("壹佰万元零伍分");
    expect(moneyUpper("20000.30")).toBe("贰万元零叁角");
    expect(moneyUpper("101000.00")).toBe("壹拾万壹仟元整");
    expect(moneyUpper("10.05")).toBe("壹拾元零伍分");
  });

  it("负数加「负」前缀", () => {
    expect(moneyUpper("-1280.00")).toBe("负壹仟贰佰捌拾元整");
    expect(moneyUpper("-0.05")).toBe("负零元伍分");
  });
});

describe("sumMoney", () => {
  it("用分相加，不经过浮点", () => {
    expect(sumMoney(["0.10", "0.20"])).toBe("0.30");
    expect(toCents("1,234.50")).toBe(123450n);
    expect(fromCents(123450n)).toBe("1234.50");
  });
});
