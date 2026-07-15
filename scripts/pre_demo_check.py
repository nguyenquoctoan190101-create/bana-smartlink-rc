#!/usr/bin/env python
"""Fail-closed checks to run immediately before a BaNa SmartLink demo.

The command never installs packages, never falls back to a historical hosted
environment and never prints connection strings. By default every selected
gate is mandatory and a failure returns a non-zero exit code.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OFFICIAL_MAP = ROOT / "DU_LIEU_CHINH_THUC" / "village_merge_map_CHINH_THUC.json"
DEFAULT_BASE_URL = "http://127.0.0.1:8000"


def _print_result(name: str, passed: bool, detail: str) -> None:
    marker = "PASS" if passed else "FAIL"
    print(f"[{marker}] {name}: {detail}")


def _safe_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("API base URL must be an absolute HTTP(S) URL")
    if parsed.username or parsed.password:
        raise ValueError("API base URL must not contain credentials")
    return base_url


def run_health_check(base_url: str, timeout_seconds: float = 10.0) -> bool:
    """Require both liveness and dependency-aware readiness to succeed."""
    passed = True
    for path in ("/health/live", "/health/ready"):
        url = f"{base_url}{path}"
        started = time.perf_counter()
        try:
            request = urllib.request.Request(
                url,
                headers={"User-Agent": "BaNaSmartLink-PreDemo/1.0"},
            )
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                elapsed_ms = (time.perf_counter() - started) * 1000
                status = response.getcode()
                content_type = response.headers.get_content_type()
                endpoint_passed = status == 200 and content_type == "application/json"
                _print_result(path, endpoint_passed, f"HTTP {status}, {elapsed_ms:.0f} ms")
                passed = passed and endpoint_passed
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            elapsed_ms = (time.perf_counter() - started) * 1000
            _print_result(path, False, f"unavailable after {elapsed_ms:.0f} ms ({type(exc).__name__})")
            passed = False
    return passed


def run_validation_tests() -> bool:
    """Run deterministic validator and official-fixture regression tests."""
    command = [
        sys.executable,
        "-m",
        "pytest",
        "tests/test_validator_golden.py",
        "tests/test_official_golden_files.py",
        "-q",
    ]
    completed = subprocess.run(
        command,
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    output = completed.stdout.strip()
    if output:
        print(output)
    passed = completed.returncode == 0
    _print_result("deterministic validation", passed, f"pytest exit {completed.returncode}")
    return passed


def _official_reference_data() -> tuple[set[str], set[str], set[str]]:
    payload: dict[str, Any] = json.loads(OFFICIAL_MAP.read_text(encoding="utf-8"))
    village_names = {str(item["ten"]) for item in payload.get("villages_moi", [])}
    legacy_names = {str(item["ten_thon_cu"]) for item in payload.get("anh_xa_thon_cu", [])}
    pending_names = {
        str(item["ten_thon_cu"])
        for item in payload.get("anh_xa_thon_cu", [])
        if "CHUA CHAC CHAN" in str(item.get("ghi_chu", "")).upper()
        or "CAN HOI LAI XA" in str(item.get("ghi_chu", "")).upper()
    }
    if len(village_names) != 10:
        raise ValueError("official reference file must define exactly 10 current villages")
    return village_names, legacy_names, pending_names


def check_reference_data(database_url: str, commune_id: str) -> bool:
    """Compare staging reference rows with the versioned official mapping."""
    import psycopg2

    expected_villages, expected_legacy, expected_pending = _official_reference_data()
    try:
        with psycopg2.connect(database_url, connect_timeout=10) as connection:
            with connection.cursor() as cursor:
                cursor.execute(
                    "select name from public.villages where commune_id = %s",
                    (commune_id,),
                )
                actual_villages = {str(row[0]) for row in cursor.fetchall()}
                cursor.execute(
                    """
                    select m.old_village_name, m.mapping_status::text
                    from public.village_merge_map m
                    join public.villages v on v.id = m.new_village_id
                    where v.commune_id = %s
                    """,
                    (commune_id,),
                )
                mapping_rows = cursor.fetchall()
    except Exception as exc:
        _print_result("reference data", False, f"database check failed ({type(exc).__name__})")
        return False

    actual_legacy = {str(row[0]) for row in mapping_rows}
    actual_pending = {
        str(row[0]) for row in mapping_rows if str(row[1]) == "pending_official_decision"
    }
    passed = (
        actual_villages == expected_villages
        and actual_legacy == expected_legacy
        and actual_pending == expected_pending
    )
    detail = (
        f"{len(actual_villages)}/10 current villages; "
        f"{len(actual_legacy)}/{len(expected_legacy)} historical mappings; "
        f"{len(actual_pending)} pending decision"
    )
    _print_result("reference data", passed, detail)
    return passed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        default=os.getenv("BANA_API_BASE_URL", DEFAULT_BASE_URL),
        help="deployed FastAPI origin (default: BANA_API_BASE_URL or localhost)",
    )
    parser.add_argument("--skip-health", action="store_true")
    parser.add_argument("--skip-tests", action="store_true")
    parser.add_argument("--skip-db", action="store_true")
    args = parser.parse_args(argv)

    results: list[bool] = []
    if not args.skip_health:
        try:
            results.append(run_health_check(_safe_base_url(args.base_url)))
        except ValueError as exc:
            _print_result("health configuration", False, str(exc))
            results.append(False)
    if not args.skip_tests:
        results.append(run_validation_tests())
    if not args.skip_db:
        database_url = os.getenv("DATABASE_URL", "").strip()
        commune_id = os.getenv("BANA_COMMUNE_ID", "ba_na").strip()
        if not database_url:
            _print_result("reference data", False, "DATABASE_URL is required")
            results.append(False)
        elif not commune_id:
            _print_result("reference data", False, "BANA_COMMUNE_ID is required")
            results.append(False)
        else:
            results.append(check_reference_data(database_url, commune_id))

    if not results:
        _print_result("pre-demo", False, "no checks were selected")
        return 2
    passed = all(results)
    _print_result("pre-demo", passed, f"{sum(results)}/{len(results)} gates passed")
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
