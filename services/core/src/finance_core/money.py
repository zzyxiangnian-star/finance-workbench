"""金额处理：内部一律用整数“分”，对外用字符串“元”，避免浮点误差。"""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


class MoneyError(ValueError):
    pass


def to_cents(value: str | int | Decimal) -> int:
    """'1234.5' -> 123450。只接受字符串/整数/Decimal，拒绝 float。"""
    if isinstance(value, float):
        raise MoneyError("金额不能用浮点数，请传字符串，如 '1234.50'")
    try:
        d = Decimal(str(value).replace(",", "").strip() or "0")
    except InvalidOperation as e:
        raise MoneyError(f"金额格式不对：{value!r}") from e
    if d != d.quantize(Decimal("0.01")):
        raise MoneyError(f"金额最多两位小数：{value!r}")
    return int((d * 100).to_integral_value(ROUND_HALF_UP))


def to_yuan(cents: int) -> str:
    """123450 -> '1234.50'"""
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}{cents // 100}.{cents % 100:02d}"
