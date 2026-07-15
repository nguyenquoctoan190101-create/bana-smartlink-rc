from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Literal, TypedDict


ErrorType = Literal["BLANK", "TEXT", "SEP", "OUTLIER", "LOGIC", "BADPHONE"]
Rule = dict[str, Any]
BLOCKING_ERROR_TYPES: frozenset[ErrorType] = frozenset(
    {"BLANK", "LOGIC", "TEXT", "SEP", "BADPHONE"}
)


class ValidationError(TypedDict):
    ct_code: str
    error_type: ErrorType
    message: str


RULES_PATH = Path(__file__).resolve().parents[1] / "config" / "validation_rules.json"
_MISSING = object()


def validate_report(values: dict[str, Any]) -> list[ValidationError]:
    """Validate report values using config/validation_rules.json only."""
    rules = _load_rules()
    parsed_values: dict[str, int] = {}
    errors: list[ValidationError] = []

    for rule in rules:
        code = str(rule["code"])
        raw_value = values.get(code, _MISSING)

        if raw_value is _MISSING or raw_value is None:
            _add_error(errors, code, "BLANK", f"{code} đang thiếu dữ liệu.")
            continue

        parsed_value, parse_error = _parse_integer(raw_value)
        if parse_error is not None:
            message = _parse_error_message(code, parse_error)
            _add_error(errors, code, parse_error, message)
            continue

        parsed_values[code] = parsed_value
        _validate_min(rule, parsed_value, errors)

    for rule in rules:
        code = str(rule["code"])
        if code not in parsed_values:
            continue

        _validate_max_ref(rule, parsed_values, errors)
        _validate_sum_max_ref(rule, parsed_values, errors)
        _validate_ratio_check(rule, parsed_values, errors)

    return errors


def validate_phone(phone: Any) -> ValidationError | None:
    """Validate submitter phone format without logging or rewriting it."""
    if not isinstance(phone, str):
        return _build_error("PHONE", "BADPHONE", "Số điện thoại không hợp lệ.")

    stripped_phone = phone.strip()
    if re.fullmatch(r"0\d{9}", stripped_phone) is None:
        return _build_error("PHONE", "BADPHONE", "Số điện thoại không hợp lệ.")

    return None


def _load_rules() -> list[Rule]:
    with RULES_PATH.open("r", encoding="utf-8") as rules_file:
        payload = json.load(rules_file)

    indicators = payload.get("indicators", [])
    if not isinstance(indicators, list):
        raise ValueError("validation_rules.json must contain an indicators list")

    return [rule for rule in indicators if isinstance(rule, dict)]


def _parse_integer(value: Any) -> tuple[int, ErrorType | None]:
    if isinstance(value, bool):
        return 0, "TEXT"

    if isinstance(value, int):
        return value, None

    if not isinstance(value, str):
        return 0, "TEXT"

    stripped_value = value.strip()
    if not stripped_value:
        return 0, "BLANK"
    if re.search(r"\d[.,]\d", stripped_value) is not None:
        return 0, "SEP"
    # int() accepts surprising forms such as ``1_000`` and non-ASCII digits.
    # Report rules intentionally accept a plain, locale-independent integer.
    if re.fullmatch(r"[+-]?[0-9]+", stripped_value) is None:
        return 0, "TEXT"
    return int(stripped_value), None


def _parse_error_message(code: str, error_type: ErrorType) -> str:
    if error_type == "BLANK":
        return f"{code} đang thiếu dữ liệu."
    if error_type == "SEP":
        return f"{code} không dùng dấu . hoặc , để phân tách chữ số."

    return f"{code} phải là số nguyên."


def _validate_min(rule: Rule, value: int, errors: list[ValidationError]) -> None:
    min_value = rule.get("min")
    if isinstance(min_value, (int, float)) and value < min_value:
        code = str(rule["code"])
        _add_error(errors, code, "LOGIC", f"{code} phải lớn hơn hoặc bằng {min_value}.")


def _validate_max_ref(
    rule: Rule,
    parsed_values: dict[str, int],
    errors: list[ValidationError],
) -> None:
    code = str(rule["code"])
    max_ref = rule.get("max_ref")
    if not isinstance(max_ref, str) or max_ref not in parsed_values:
        return

    value = parsed_values[code]
    ref_value = parsed_values[max_ref]
    if value > ref_value:
        _add_error(
            errors,
            code,
            "LOGIC",
            f"{code} không được lớn hơn {max_ref} ({value} > {ref_value}).",
        )


def _validate_sum_max_ref(
    rule: Rule,
    parsed_values: dict[str, int],
    errors: list[ValidationError],
) -> None:
    code = str(rule["code"])
    sum_rule = rule.get("sum_max_ref")
    if not isinstance(sum_rule, dict):
        return

    refs = sum_rule.get("refs")
    max_ref = sum_rule.get("max_ref")
    if not isinstance(refs, list) or not isinstance(max_ref, str):
        return

    ref_codes = [str(ref) for ref in refs]
    if max_ref not in parsed_values or any(ref not in parsed_values for ref in ref_codes):
        return

    total = sum(parsed_values[ref] for ref in ref_codes)
    ref_value = parsed_values[max_ref]
    if total > ref_value:
        ref_label = " + ".join(ref_codes)
        _add_error(
            errors,
            code,
            "LOGIC",
            f"Tổng {ref_label} không được lớn hơn {max_ref} ({total} > {ref_value}).",
        )


def _validate_ratio_check(
    rule: Rule,
    parsed_values: dict[str, int],
    errors: list[ValidationError],
) -> None:
    code = str(rule["code"])
    ratio_rule = rule.get("ratio_check")
    if not isinstance(ratio_rule, dict):
        return

    ref = ratio_rule.get("ref")
    min_ratio = ratio_rule.get("min_ratio")
    max_ratio = ratio_rule.get("max_ratio")
    if not isinstance(ref, str) or ref not in parsed_values:
        return

    ref_value = parsed_values[ref]
    value = parsed_values[code]
    if ref_value == 0:
        if value != 0:
            _add_error(
                errors,
                code,
                "LOGIC",
                f"{code} phải bằng 0 khi {ref} bằng 0.",
            )
        return
    if not isinstance(min_ratio, (int, float)) or not isinstance(max_ratio, (int, float)):
        return

    ratio = value / ref_value
    if ratio < min_ratio or ratio > max_ratio:
        _add_error(
            errors,
            code,
            "OUTLIER",
            f"{code}/{ref} = {ratio:.2f}, ngoài khoảng {min_ratio}-{max_ratio}.",
        )


def _add_error(
    errors: list[ValidationError],
    ct_code: str,
    error_type: ErrorType,
    message: str,
) -> None:
    errors.append(_build_error(ct_code, error_type, message))


def _build_error(ct_code: str, error_type: ErrorType, message: str) -> ValidationError:
    return {"ct_code": ct_code, "error_type": error_type, "message": message}


__all__ = ["validate_phone", "validate_report"]
