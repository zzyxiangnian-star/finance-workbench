"""科目名称的拼音首字母。整段一次交给 pypinyin，词组按常用读音（银行 → yh）。"""

from pypinyin import Style, lazy_pinyin


def initials(name: str) -> str:
    return "".join(lazy_pinyin(name, style=Style.FIRST_LETTER)).lower()
