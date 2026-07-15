#!/usr/bin/env python
"""Verify owner-attested release controls before declaring production readiness.

This is intentionally a record validator, not a way to bypass approvals.  Each
required control must name a responsible owner, an evidence reference and a
recent ISO-8601 timestamp.  The script does not send data or inspect secrets.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


REQUIRED_CONTROLS = (
    "credential_rotation",
    "access_log_review",
    "staging_rls_matrix",
    "uat_four_roles",
    "backup_restore",
    "security_review",
    "privacy_legal_review",
)


def parse_timestamp(value: object) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        return None
    return timestamp.astimezone(UTC)


def validate_attestations(payload: Any, now: datetime, max_age_days: int = 90) -> list[str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("controls"), dict):
        return ["attestation must be an object with a controls object"]
    errors: list[str] = []
    controls = payload["controls"]
    latest_allowed_age = now - timedelta(days=max_age_days)
    for name in REQUIRED_CONTROLS:
        control = controls.get(name)
        if not isinstance(control, dict):
            errors.append(f"{name}: missing")
            continue
        if control.get("status") != "passed":
            errors.append(f"{name}: status must be passed")
        if not isinstance(control.get("owner"), str) or not control["owner"].strip():
            errors.append(f"{name}: owner is required")
        if not isinstance(control.get("evidence"), str) or not control["evidence"].strip():
            errors.append(f"{name}: evidence is required")
        completed_at = parse_timestamp(control.get("completed_at"))
        if completed_at is None:
            errors.append(f"{name}: completed_at must be timezone-aware ISO-8601")
        elif completed_at > now + timedelta(minutes=5) or completed_at < latest_allowed_age:
            errors.append(f"{name}: completed_at is outside the permitted age window")
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--attestation-file", required=True, type=Path)
    parser.add_argument("--max-age-days", type=int, default=90)
    args = parser.parse_args(argv)
    if args.max_age_days < 1:
        parser.error("max-age-days must be positive")
    try:
        payload = json.loads(args.attestation_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[FAIL] production gate: cannot read attestation ({type(exc).__name__})")
        return 1
    errors = validate_attestations(payload, datetime.now(UTC), args.max_age_days)
    if errors:
        for error in errors:
            print(f"[FAIL] {error}")
        return 1
    print("[PASS] production gate: all required owner attestations are current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
