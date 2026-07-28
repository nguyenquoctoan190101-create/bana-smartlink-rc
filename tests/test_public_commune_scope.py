from __future__ import annotations

import asyncio
import csv
import io
from types import SimpleNamespace
from typing import Any

from routers import pilots, reports


class FakeSupabase:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, str]] = []

    async def _rest_request(self, method: str, path: str) -> list[dict[str, Any]]:
        self.calls.append((method, path))
        return self.rows


def _settings() -> SimpleNamespace:
    return SimpleNamespace(bana_commune_id="ba_na")


def test_public_villages_are_queried_and_filtered_to_ba_na() -> None:
    client = FakeSupabase(
        [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "name": "Thôn Bà Nà",
                "commune_id": "ba_na",
            },
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "name": "Thôn xã khác",
                "commune_id": "other_commune",
            },
        ]
    )

    result = asyncio.run(reports.get_villages(client, _settings()))

    assert result == [
        {
            "id": "11111111-1111-4111-8111-111111111111",
            "name": "Thôn Bà Nà",
        }
    ]
    assert client.calls == [
        (
            "GET",
            "/rest/v1/villages?commune_id=eq.ba_na&is_active=eq.true"
            "&select=id,name,commune_id&order=name.asc",
        )
    ]


def test_public_reports_require_matching_period_and_village_commune() -> None:
    client = FakeSupabase(
        [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "village_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "published_at": "2026-07-26T00:00:00Z",
                "report_periods": {
                    "name": "Tháng 7/2026",
                    "commune_id": "ba_na",
                },
                "villages": {"commune_id": "ba_na"},
                "workflow_status": "locked",
                "submitted_by_name": "Không được công khai",
                "report_values": [
                    {"ct_code": "CT01", "value": 10},
                    {"ct_code": "CT14", "value": 1},
                ],
            },
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "village_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "published_at": "2026-07-26T00:00:00Z",
                "report_periods": {
                    "name": "Tháng 7/2026",
                    "commune_id": "other_commune",
                },
                "villages": {"commune_id": "other_commune"},
                "report_values": [{"ct_code": "CT01", "value": 999}],
            },
            {
                "id": "33333333-3333-4333-8333-333333333333",
                "village_id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                "published_at": "2026-07-26T00:00:00Z",
                "report_periods": {
                    "name": "Tháng 7/2026",
                    "commune_id": "ba_na",
                },
                "villages": {"commune_id": "other_commune"},
                "report_values": [{"ct_code": "CT01", "value": 888}],
            },
        ]
    )

    result = asyncio.run(reports.get_public_reports(client, _settings()))

    assert result == [
        {
            "village_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "report_period": "Tháng 7/2026",
            "published_at": "2026-07-26T00:00:00Z",
            "values": {"CT01": 10},
        }
    ]
    assert set(result[0]) == {
        "village_id",
        "report_period",
        "published_at",
        "values",
    }
    assert "id" not in result[0]
    assert "CT14" not in result[0]["values"]
    path = client.calls[0][1]
    assert "select=id" not in path
    assert "report_periods!inner(name,commune_id)" in path
    assert "villages!inner(commune_id)" in path
    assert "report_periods.commune_id=eq.ba_na" in path
    assert "villages.commune_id=eq.ba_na" in path


def test_public_metadata_uses_only_approved_registry_definitions() -> None:
    result = asyncio.run(reports.get_public_report_metadata())
    payload = result.model_dump()

    assert set(payload) == {
        "schema_version",
        "registry_version",
        "source_label",
        "indicators",
    }
    assert payload["schema_version"] == "public-report-v1"
    assert payload["registry_version"]
    assert [item["code"] for item in payload["indicators"]] == [
        "CT01",
        "CT02",
        "CT09",
        "CT12",
        "CT13",
    ]
    assert all(
        set(item)
        == {"code", "label", "definition", "unit", "interpretation_limit"}
        for item in payload["indicators"]
    )
    assert "report_values" not in str(payload)
    assert "CT14" not in str(payload)


def test_public_csv_is_formula_safe_and_never_exposes_internal_fields() -> None:
    village_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    client = FakeSupabase(
        [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "village_id": village_id,
                "published_at": "2026-07-26T00:00:00Z",
                "report_periods": {
                    "name": "=2+2",
                    "commune_id": "ba_na",
                },
                "villages": {"commune_id": "ba_na"},
                "workflow_status": "locked",
                "submitted_by_name": "Không được công khai",
                "ai_narrative": "Không được công khai",
                "report_values": [
                    {"ct_code": "CT01", "value": 10},
                    {"ct_code": "CT02", "value": 20},
                    {"ct_code": "CT09", "value": 8},
                    {"ct_code": "CT12", "value": 2},
                    {"ct_code": "CT13", "value": 5},
                    {"ct_code": "CT14", "value": 99},
                ],
            }
        ]
    )

    response = asyncio.run(
        reports.export_public_reports_csv(
            client,
            _settings(),
            village_id=None,
            report_period=None,
        )
    )
    text = response.body.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = list(reader)

    assert response.media_type == "text/csv"
    assert response.headers["content-disposition"] == (
        'attachment; filename="ba-na-public-reports.csv"'
    )
    assert reader.fieldnames == [
        "village_id",
        "report_period",
        "published_at",
        "source",
        "registry_version",
        "CT01",
        "CT02",
        "CT09",
        "CT12",
        "CT13",
    ]
    assert rows == [
        {
            "village_id": village_id,
            "report_period": "'=2+2",
            "published_at": "2026-07-26T00:00:00Z",
            "source": reports.PUBLIC_DATASET_SOURCE_LABEL,
            "registry_version": reports.load_metric_registry().registry_version,
            "CT01": "10",
            "CT02": "20",
            "CT09": "8",
            "CT12": "2",
            "CT13": "5",
        }
    ]
    assert "CT14" not in text
    assert "submitted_by" not in text
    assert "workflow" not in text
    assert "ai_narrative" not in text
    assert "11111111-1111-4111-8111-111111111111" not in text


def test_public_evacuation_points_are_queried_and_filtered_to_ba_na() -> None:
    client = FakeSupabase(
        [
            {
                "id": "11111111-1111-4111-8111-111111111111",
                "village_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                "name": "Nhà văn hóa",
                "latitude": 15.99,
                "longitude": 107.99,
                "capacity_households": 120,
                "is_verified": True,
                "contact_name": "Không được công khai",
                "villages": {"commune_id": "ba_na"},
            },
            {
                "id": "22222222-2222-4222-8222-222222222222",
                "village_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                "name": "Điểm xã khác",
                "latitude": 16.0,
                "longitude": 108.0,
                "capacity_households": 500,
                "is_verified": True,
                "villages": {"commune_id": "other_commune"},
            },
        ]
    )

    result = asyncio.run(
        pilots.list_public_evacuation_points(client, _settings())
    )

    assert result == [
        {
            "id": "11111111-1111-4111-8111-111111111111",
            "village_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "name": "Nhà văn hóa",
            "latitude": 15.99,
            "longitude": 107.99,
            "capacity_households": 120,
            "is_verified": True,
        }
    ]
    assert "contact_name" not in result[0]
    path = client.calls[0][1]
    assert "villages!inner(commune_id)" in path
    assert "villages.commune_id=eq.ba_na" in path
    assert "is_verified=eq.true" in path
