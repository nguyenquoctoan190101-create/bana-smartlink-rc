#!/usr/bin/env python
"""Read-only latency smoke test for a deployed public FastAPI origin."""

from __future__ import annotations

import argparse
import concurrent.futures
import math
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_PATHS = ("/health/live", "/health/ready")


def safe_base_url(value: str) -> str:
    base_url = value.strip().rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.netloc
        or parsed.username
        or parsed.password
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("base URL must be an absolute HTTP(S) origin without credentials")
    return base_url


def percentile(values: list[float], percent: float) -> float:
    if not values:
        raise ValueError("cannot calculate percentile of no samples")
    ordered = sorted(values)
    index = math.ceil((percent / 100) * len(ordered)) - 1
    return ordered[max(0, min(index, len(ordered) - 1))]


def request_once(base_url: str, path: str, timeout_seconds: float) -> tuple[bool, float, str]:
    started = time.perf_counter()
    try:
        request = urllib.request.Request(
            f"{base_url}{path}",
            headers={"User-Agent": "BaNaSmartLink-PerformanceSmoke/1.0"},
        )
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            elapsed_ms = (time.perf_counter() - started) * 1000
            return response.getcode() == 200, elapsed_ms, str(response.getcode())
    except (urllib.error.URLError, TimeoutError, ValueError) as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return False, elapsed_ms, type(exc).__name__


def run_path(base_url: str, path: str, requests: int, concurrency: int, timeout_seconds: float) -> tuple[bool, str]:
    with concurrent.futures.ThreadPoolExecutor(max_workers=concurrency) as executor:
        samples = list(executor.map(lambda _: request_once(base_url, path, timeout_seconds), range(requests)))
    successes = [elapsed for ok, elapsed, _ in samples if ok]
    failures = [detail for ok, _, detail in samples if not ok]
    p95 = percentile(successes, 95) if successes else float("inf")
    median = statistics.median(successes) if successes else float("inf")
    detail = f"{len(successes)}/{requests} HTTP 200; p50={median:.0f} ms; p95={p95:.0f} ms"
    if failures:
        detail += f"; failures={','.join(sorted(set(failures)))}"
    return len(successes) == requests, detail


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--requests", type=int, default=20)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--timeout-seconds", type=float, default=10.0)
    parser.add_argument("--max-p95-ms", type=float, default=500.0)
    parser.add_argument("--path", action="append", dest="paths", help="read-only path; repeatable")
    args = parser.parse_args(argv)
    if args.requests < 1 or args.concurrency < 1 or args.timeout_seconds <= 0 or args.max_p95_ms <= 0:
        parser.error("requests/concurrency/max-p95 must be positive and timeout must be > 0")
    try:
        base_url = safe_base_url(args.base_url)
    except ValueError as exc:
        parser.error(str(exc))

    all_passed = True
    for path in args.paths or DEFAULT_PATHS:
        if not path.startswith("/") or path.startswith("//") or "?" in path or "#" in path:
            parser.error("paths must be relative read-only paths without query or fragment")
        passed, detail = run_path(base_url, path, args.requests, args.concurrency, args.timeout_seconds)
        # Parse p95 from the stable report instead of making a second network pass.
        p95_ms = float(detail.split("p95=")[1].split(" ms")[0])
        passed = passed and p95_ms <= args.max_p95_ms
        print(f"[{'PASS' if passed else 'FAIL'}] {path}: {detail}; budget={args.max_p95_ms:.0f} ms")
        all_passed = all_passed and passed
    return 0 if all_passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
