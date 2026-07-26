#!/usr/bin/env python
"""Fail unless a deployed origin reports the exact expected Git commit SHA."""

from __future__ import annotations

import argparse
import json
import re
import urllib.error
import urllib.request
from typing import Any

try:
    from scripts.performance_smoke import safe_base_url
except ModuleNotFoundError:  # Direct execution: python scripts/production_sha_smoke.py
    from performance_smoke import safe_base_url


COMMIT_SHA = re.compile(r"[0-9a-f]{40}")


def validate_expected_commit(value: str) -> str:
    commit = value.strip().lower()
    if not COMMIT_SHA.fullmatch(commit):
        raise ValueError("expected commit must be a full 40-character Git SHA")
    return commit


def validate_health_payload(payload: Any, expected_commit: str) -> list[str]:
    if not isinstance(payload, dict):
        return ["health response must be a JSON object"]
    errors: list[str] = []
    if payload.get("status") != "ok":
        errors.append("health status is not ok")
    observed = payload.get("version")
    if not isinstance(observed, str) or observed.lower() != expected_commit:
        errors.append("deployed version does not match the expected commit")
    return errors


def fetch_health(base_url: str, timeout_seconds: float) -> Any:
    request = urllib.request.Request(
        f"{base_url}/health/live",
        headers={"User-Agent": "BaNaSmartLink-ReleaseSmoke/1.0"},
    )
    with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
        if response.getcode() != 200:
            raise RuntimeError(f"health endpoint returned HTTP {response.getcode()}")
        return json.loads(response.read())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--timeout-seconds", type=float, default=15.0)
    args = parser.parse_args(argv)
    if args.timeout_seconds <= 0:
        parser.error("timeout-seconds must be positive")
    try:
        base_url = safe_base_url(args.base_url)
        expected_commit = validate_expected_commit(args.expected_commit)
    except ValueError as exc:
        parser.error(str(exc))
    try:
        payload = fetch_health(base_url, args.timeout_seconds)
    except (
        json.JSONDecodeError,
        RuntimeError,
        TimeoutError,
        urllib.error.URLError,
    ) as exc:
        print(f"[FAIL] production SHA smoke: cannot read health response ({type(exc).__name__})")
        return 1
    errors = validate_health_payload(payload, expected_commit)
    if errors:
        for error in errors:
            print(f"[FAIL] {error}")
        return 1
    print(f"[PASS] production reports exact commit {expected_commit}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
