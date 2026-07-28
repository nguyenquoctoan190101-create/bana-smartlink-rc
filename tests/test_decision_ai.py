from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.decision_ai import (
    DecisionAiError,
    DecisionAnalysis,
    _openai_enrichment,
    _parse_analysis,
    build_evidence_bundle,
    enrich_decision_brief,
    validate_grounding,
)
from services.settings import Settings


def _analysis_payload(evidence_id: str = "report-1") -> dict:
    return {
        "executive_assessment": (
            "Cần ưu tiên rà soát nguồn và trách nhiệm xử lý trước khi mở rộng sử dụng."
        ),
        "recommended_option_id": "A",
        "options": [
            {
                "id": "A",
                "title": "Rà soát theo nhóm cảnh báo",
                "rationale": "Tập trung vào căn cứ có dấu hiệu cần xem lại và giữ được dấu vết kiểm tra.",
                "tradeoff": "Cần thêm thời gian đối chiếu thủ công.",
                "urgency": "ngay",
                "evidence_ids": [evidence_id],
            },
            {
                "id": "B",
                "title": "Theo dõi rồi đánh giá lại",
                "rationale": "Giữ nhịp vận hành hiện tại và chờ thêm căn cứ trước khi thay đổi.",
                "tradeoff": "Rủi ro chậm xử lý cảnh báo còn tồn tại.",
                "urgency": "theo_doi",
                "evidence_ids": ["period:Tháng bảy"],
            },
        ],
        "risks": [
            {
                "title": "Bỏ sót căn cứ nguồn",
                "severity": "cao",
                "mitigation": "Yêu cầu người duyệt mở bản nguồn và lưu nhận xét đối chiếu.",
                "evidence_ids": [evidence_id],
            }
        ],
        "reviewer_questions": [
            "Nguồn báo cáo đã được đối chiếu độc lập hay chưa?"
        ],
        "assumptions": [
            "Trạng thái báo cáo trong gói bằng chứng là trạng thái mới nhất."
        ],
    }


def _citations() -> list[dict]:
    return [
        {
            "kind": "quality_snapshot",
            "id": "report-1",
            "village_name": "Thôn An Sơn",
            "quality_status": "needs_review",
            "quality_score": 88,
            "unresolved_flag_count": 1,
            "outlier_count": 0,
            "timeliness_status": "on_time",
            "report_source": "excel",
            "report_version": 3,
            "rule_version": "2026-07-14",
            "owner_phone": "0901234567",
            "value": 999,
        },
        {
            "kind": "decision_metrics",
            "id": "period:Tháng bảy",
            "report_count": 1,
            "ready_report_count": 0,
            "average_quality_score": 88,
            "blocked_report_count": 0,
            "review_report_count": 1,
            "late_report_count": 0,
            "open_action_count": 1,
            "overdue_action_count": 0,
            "generator_version": "deterministic-evidence-v2",
            "evidence_fingerprint": "fingerprint",
        },
    ]


class _FakeAsyncClient:
    def __init__(self, response: httpx.Response, **_: object) -> None:
        self.response = response
        self.post = AsyncMock(return_value=response)

    async def __aenter__(self) -> "_FakeAsyncClient":
        return self

    async def __aexit__(self, *_: object) -> bool:
        return False


def _openai_response(payload: dict | None = None) -> httpx.Response:
    output = json.dumps(payload or _analysis_payload(), ensure_ascii=False)
    return httpx.Response(
        200,
        json={
            "id": "resp-safe",
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": output}],
                }
            ],
            "usage": {"input_tokens": 300, "output_tokens": 180},
        },
    )


def test_evidence_bundle_strips_unallowlisted_values_and_pii() -> None:
    bundle = build_evidence_bundle(
        period_name="Tháng bảy",
        deterministic_content="Kết luận: Cần rà soát.",
        citations=_citations(),
    )
    serialized = json.dumps(bundle, ensure_ascii=False)
    assert "0901234567" not in serialized
    assert "999" not in serialized
    assert "owner_phone" not in serialized
    assert '"value"' not in serialized
    assert bundle["rules"]["personal_data_included"] is False
    assert bundle["rules"]["indicator_values_included"] is False


@pytest.mark.asyncio
async def test_openai_enrichment_uses_responses_structured_output_without_storage() -> None:
    fake = _FakeAsyncClient(_openai_response())
    settings = Settings(
        _env_file=None,
        feature_decision_ai=True,
        decision_ai_provider="openai",
        openai_api_key="secret-test-key",
        openai_api_url="https://api.openai.test/v1",
        openai_decision_model="gpt-5.6-sol",
    )
    with patch("services.decision_ai.httpx.AsyncClient", return_value=fake):
        attempt = await enrich_decision_brief(
            settings=settings,
            period_name="Tháng bảy",
            deterministic_content="Kết luận: Cần rà soát.",
            citations=_citations(),
            safety_subject="internal-user-id",
        )

    assert attempt.status == "enhanced"
    assert attempt.model_provider == "openai-responses:gpt-5.6-sol"
    assert attempt.citation is not None
    assert attempt.citation["analysis"]["recommended_option_id"] == "A"
    request = fake.post.await_args.kwargs["json"]
    assert request["store"] is False
    assert request["model"] == "gpt-5.6-sol"
    assert request["reasoning"] == {"effort": "medium", "context": "current_turn"}
    assert request["text"]["format"]["type"] == "json_schema"
    assert request["text"]["format"]["strict"] is True
    schema = request["text"]["format"]["schema"]
    assert "title" in schema["properties"]["options"]["items"]["properties"]
    assert "title" in schema["properties"]["risks"]["items"]["properties"]
    assert schema["properties"]["options"]["items"]["properties"][
        "evidence_ids"
    ]["items"]["enum"] == [
        "period:Tháng bảy",
        "report-1",
    ]
    assert request["safety_identifier"] != "internal-user-id"
    assert "0901234567" not in request["input"]
    assert "secret-test-key" not in json.dumps(request)


@pytest.mark.asyncio
async def test_unknown_citation_or_unverified_number_fails_closed_to_deterministic() -> None:
    bad_payload = _analysis_payload("unknown-report")
    bad_payload["executive_assessment"] = "Cần xử lý trong 24 giờ trước khi sử dụng."
    fake = _FakeAsyncClient(_openai_response(bad_payload))
    settings = Settings(
        _env_file=None,
        feature_decision_ai=True,
        decision_ai_provider="openai",
        openai_api_key="test-key",
    )
    with patch("services.decision_ai.httpx.AsyncClient", return_value=fake):
        attempt = await enrich_decision_brief(
            settings=settings,
            period_name="Tháng bảy",
            deterministic_content="Kết luận: Cần rà soát.",
            citations=_citations(),
            safety_subject="user",
        )

    assert attempt.status == "fallback"
    assert attempt.model_provider == "deterministic-evidence-v2"
    assert attempt.citation is not None
    assert attempt.citation["kind"] == "ai_generation"


@pytest.mark.asyncio
async def test_malformed_provider_response_fails_closed_without_leaking_body() -> None:
    fake = _FakeAsyncClient(
        httpx.Response(200, content=b"provider-secret-malformed-body")
    )
    settings = Settings(
        _env_file=None,
        feature_decision_ai=True,
        decision_ai_provider="openai",
        openai_api_key="test-key",
    )
    with patch("services.decision_ai.httpx.AsyncClient", return_value=fake):
        attempt = await enrich_decision_brief(
            settings=settings,
            period_name="Tháng bảy",
            deterministic_content="Kết luận: Cần rà soát.",
            citations=_citations(),
            safety_subject="user",
        )

    assert attempt.status == "fallback"
    assert "provider-secret" not in str(attempt)


@pytest.mark.asyncio
async def test_openai_transport_error_does_not_retain_authorization() -> None:
    secret = "Bearer provider-secret-authorization"
    request = httpx.Request(
        "POST",
        "https://api.openai.test/v1/responses",
        headers={"Authorization": secret},
    )
    fake = _FakeAsyncClient(_openai_response())
    fake.post = AsyncMock(side_effect=httpx.ConnectError(
        "provider-secret-network-detail",
        request=request,
    ))
    settings = Settings(
        _env_file=None,
        openai_api_key="provider-secret-authorization",
        openai_api_url="https://api.openai.test/v1",
    )
    bundle = build_evidence_bundle(
        period_name="ThÃ¡ng báº£y",
        deterministic_content="Káº¿t luáº­n: Cáº§n rÃ  soÃ¡t.",
        citations=_citations(),
    )

    with patch("services.decision_ai.httpx.AsyncClient", return_value=fake):
        with pytest.raises(DecisionAiError, match="request failed") as caught:
            await _openai_enrichment(
                settings,
                bundle,
                safety_subject="user",
            )

    assert caught.value.__cause__ is None
    assert "provider-secret" not in str(caught.value)
    assert "provider-secret" not in repr(caught.value.__dict__)


@pytest.mark.asyncio
async def test_openai_malformed_json_does_not_retain_provider_body() -> None:
    fake = _FakeAsyncClient(
        httpx.Response(200, content=b"provider-secret-malformed-body")
    )
    settings = Settings(
        _env_file=None,
        openai_api_key="test-key",
    )
    bundle = build_evidence_bundle(
        period_name="ThÃ¡ng báº£y",
        deterministic_content="Káº¿t luáº­n: Cáº§n rÃ  soÃ¡t.",
        citations=_citations(),
    )

    with patch("services.decision_ai.httpx.AsyncClient", return_value=fake):
        with pytest.raises(DecisionAiError, match="unexpected") as caught:
            await _openai_enrichment(
                settings,
                bundle,
                safety_subject="user",
            )

    assert caught.value.__cause__ is None
    assert "provider-secret" not in str(caught.value)
    assert "provider-secret" not in repr(caught.value.__dict__)


@pytest.mark.asyncio
async def test_gemini_schema_preserves_titles_and_binds_request_evidence() -> None:
    settings = Settings(
        _env_file=None,
        feature_decision_ai=True,
        decision_ai_provider="gemini",
        gemini_api_key="gemini-test-key",
    )
    generate_json = AsyncMock(return_value=_analysis_payload())
    with patch(
        "services.decision_ai.GeminiClient.generate_json",
        new=generate_json,
    ):
        attempt = await enrich_decision_brief(
            settings=settings,
            period_name="Tháng bảy",
            deterministic_content="Kết luận: Cần rà soát.",
            citations=_citations(),
            safety_subject="user",
        )

    assert attempt.status == "enhanced"
    schema = generate_json.await_args.args[2]
    option_properties = schema["properties"]["options"]["items"]["properties"]
    risk_properties = schema["properties"]["risks"]["items"]["properties"]
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert option_properties["title"]["type"] == "string"
    assert risk_properties["title"]["type"] == "string"
    assert "minLength" not in option_properties["title"]
    assert option_properties["evidence_ids"]["items"]["enum"] == [
        "period:Tháng bảy",
        "report-1",
    ]


def test_grounding_rejects_unknown_references_even_with_valid_schema() -> None:
    analysis = DecisionAnalysis.model_validate(_analysis_payload("unknown"))
    with pytest.raises(DecisionAiError, match="grounding"):
        validate_grounding(
            analysis,
            allowed_evidence_ids={"report-1", "period:Tháng bảy"},
        )


def test_invalid_decision_schema_does_not_retain_provider_output() -> None:
    secret_output = '{"private_model_output":"do-not-retain"}'
    bundle = {
        "report_quality_evidence": [{"evidence_id": "report-1"}],
        "aggregate_metrics": {},
    }

    with pytest.raises(DecisionAiError, match="invalid decision schema") as caught:
        _parse_analysis(secret_output, bundle)

    assert "do-not-retain" not in str(caught.value)
    assert caught.value.__cause__ is None


@pytest.mark.asyncio
async def test_auto_provider_falls_back_from_openai_to_configured_gemini() -> None:
    settings = Settings(
        _env_file=None,
        feature_decision_ai=True,
        decision_ai_provider="auto",
        openai_api_key="openai-key",
        gemini_api_key="gemini-key",
    )
    analysis = DecisionAnalysis.model_validate(_analysis_payload())
    with patch(
        "services.decision_ai._openai_enrichment",
        new=AsyncMock(side_effect=DecisionAiError("redacted")),
    ), patch(
        "services.decision_ai._gemini_enrichment",
        new=AsyncMock(return_value=(analysis, {})),
    ):
        attempt = await enrich_decision_brief(
            settings=settings,
            period_name="Tháng bảy",
            deterministic_content="Kết luận: Cần rà soát.",
            citations=_citations(),
            safety_subject="user",
        )

    assert attempt.status == "enhanced"
    assert attempt.model_provider.startswith("google-gemini:")
