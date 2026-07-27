from __future__ import annotations

from scripts import pre_demo_check


def test_official_reference_data_keeps_ten_villages_and_pending_decision() -> None:
    villages, legacy, pending = pre_demo_check._official_reference_data()

    assert len(villages) == 10
    assert len(legacy) >= 10
    assert pending == {"Thôn Đông Sơn"}


def test_pre_demo_returns_failure_when_any_selected_gate_fails(monkeypatch) -> None:
    monkeypatch.setattr(pre_demo_check, "run_health_check", lambda _url: True)
    monkeypatch.setattr(
        pre_demo_check,
        "run_public_coverage_check",
        lambda _url: True,
    )
    monkeypatch.setattr(pre_demo_check, "run_validation_tests", lambda: False)

    assert pre_demo_check.main(["--skip-db"]) == 1


def test_pre_demo_rejects_no_selected_checks() -> None:
    assert (
        pre_demo_check.main(
            ["--skip-health", "--skip-public", "--skip-tests", "--skip-db"]
        )
        == 2
    )


def test_base_url_rejects_embedded_credentials() -> None:
    try:
        pre_demo_check._safe_base_url("https://user:password@example.test")
    except ValueError as exc:
        assert "credentials" in str(exc)
    else:
        raise AssertionError("credentialed URL must be rejected")


def test_public_coverage_requires_all_ten_villages_and_five_codes(
    monkeypatch,
) -> None:
    villages = [
        {"id": f"village-{index}", "name": f"Village {index}"}
        for index in range(10)
    ]
    reports = [
        {
            "village_id": village["id"],
            "values": {code: 1 for code in pre_demo_check.PUBLIC_CODES},
        }
        for village in villages
    ]

    monkeypatch.setattr(
        pre_demo_check,
        "_fetch_json",
        lambda _base, path, _timeout: villages
        if path == "/reports/villages"
        else reports,
    )

    assert pre_demo_check.run_public_coverage_check("https://example.test")


def test_public_coverage_fails_when_hoa_ninh_has_no_public_report(
    monkeypatch,
) -> None:
    villages = [
        {"id": f"village-{index}", "name": f"Village {index}"}
        for index in range(9)
    ] + [{"id": "hoa-ninh", "name": "Thôn Hòa Ninh"}]
    reports = [
        {
            "village_id": village["id"],
            "values": {code: 1 for code in pre_demo_check.PUBLIC_CODES},
        }
        for village in villages
        if village["id"] != "hoa-ninh"
    ]

    monkeypatch.setattr(
        pre_demo_check,
        "_fetch_json",
        lambda _base, path, _timeout: villages
        if path == "/reports/villages"
        else reports,
    )

    assert not pre_demo_check.run_public_coverage_check("https://example.test")
