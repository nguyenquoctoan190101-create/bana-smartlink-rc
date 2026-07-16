from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated, Any, Literal
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from routers.auth import _extract_bearer_token, get_supabase_admin, require_admin_xa
from services.report_import import (
    INDICATOR_CODES,
    assess_target_readiness,
    build_batch_preview,
    load_official_mapping,
    preview_legacy_workbook,
)
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile
from services.upload_validator import UploadValidationError, validate_report_upload
from services.validator import BLOCKING_ERROR_TYPES, validate_phone, validate_report


router = APIRouter(prefix="/report-imports", tags=["report-imports"])


class CreateImportBatchRequest(BaseModel):
    period_id: UUID
    expected_village_count: Literal[22] = 22


class ReviewImportFileRequest(BaseModel):
    decision: Literal["accepted", "rejected"]
    values: dict[str, int | None] = Field(default_factory=dict)
    reasons: dict[str, str] = Field(default_factory=dict)
    reporter_phone: str | None = Field(default=None, max_length=20)
    metadata_reason: str | None = Field(default=None, max_length=500)
    decision_reason: str | None = Field(default=None, max_length=500)


def _caller_client(supabase: SupabaseAdminClient, authorization: str | None) -> SupabaseAdminClient:
    return supabase.as_user(_extract_bearer_token(authorization))


async def _commune_id(client: SupabaseAdminClient, profile: UserProfile) -> str:
    rows = await client._rest_request(
        "GET", f"/rest/v1/user_profiles?id=eq.{quote(profile.id, safe='')}&select=commune_id"
    )
    if not rows or not rows[0].get("commune_id"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Commune scope is unavailable")
    return str(rows[0]["commune_id"])


async def _validated_previews(files: list[UploadFile]) -> list[dict[str, Any]]:
    if not files or len(files) > 25:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Upload between 1 and 25 workbooks")
    mapping = load_official_mapping()
    previews: list[dict[str, Any]] = []
    for upload in files:
        if not (upload.filename or "").lower().endswith(".xlsx"):
            raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Legacy batch import accepts XLSX only")
        try:
            content = await validate_report_upload(upload)
            previews.append(preview_legacy_workbook(upload.filename or "report.xlsx", content, mapping))
        except UploadValidationError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workbook failed security validation") from exc
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Workbook does not match the official template") from exc
    return previews


@router.post("/preview")
async def preview_batch(
    files: Annotated[list[UploadFile], File(...)],
    _: Annotated[UserProfile, Depends(require_admin_xa)],
) -> dict[str, Any]:
    return build_batch_preview(await _validated_previews(files))


@router.post("/batches", status_code=status.HTTP_201_CREATED)
async def create_batch(
    payload: CreateImportBatchRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    mapping = load_official_mapping()
    mapping_version = str(mapping.get("_meta", {}).get("mapping_version") or "unversioned")
    try:
        commune_id = await _commune_id(client, profile)
        periods = await client._rest_request(
            "GET", f"/rest/v1/report_periods?id=eq.{quote(str(payload.period_id), safe='')}&select=id,commune_id"
        )
        if not periods or str(periods[0].get("commune_id")) != commune_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report period not found")
        rows = await client._rest_request(
            "POST", "/rest/v1/report_import_batches",
            {
                "commune_id": commune_id,
                "period_id": str(payload.period_id),
                "mapping_version": mapping_version,
                "expected_village_count": payload.expected_village_count,
                "created_by": profile.id,
            },
            prefer="return=representation",
        )
        return rows[0]
    except HTTPException:
        raise
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to create import batch") from exc


async def _target_ids(client: SupabaseAdminClient, mapping: dict[str, Any]) -> dict[str, str]:
    current = await client._rest_request("GET", "/rest/v1/villages?select=id,name")
    ids_by_name = {str(row["name"]): str(row["id"]) for row in current}
    result: dict[str, str] = {}
    for row in mapping.get("villages_moi", []):
        if isinstance(row, dict) and row.get("id") and ids_by_name.get(str(row.get("ten"))):
            result[str(row["id"])] = ids_by_name[str(row["ten"])]
    return result


@router.post("/batches/{batch_id}/files", status_code=status.HTTP_201_CREATED)
async def add_batch_files(
    batch_id: UUID,
    files: Annotated[list[UploadFile], File(...)],
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> list[dict[str, Any]]:
    client = _caller_client(supabase, authorization)
    encoded_batch = quote(str(batch_id), safe="")
    try:
        batches = await client._rest_request("GET", f"/rest/v1/report_import_batches?id=eq.{encoded_batch}&select=id,status")
        if not batches:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
        if batches[0]["status"] in {"committed", "cancelled"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import batch is closed")

        mapping = load_official_mapping()
        previews = await _validated_previews(files)
        target_ids = await _target_ids(client, mapping)
        legacy_rows = await client._rest_request("GET", "/rest/v1/villages_legacy?select=id,old_name")
        legacy_ids = {str(row["old_name"]): str(row["id"]) for row in legacy_rows}
        payload: list[dict[str, Any]] = []
        for item in previews:
            if item["mapping"]["legacy_unit_type"] != "village":
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Resettlement areas are not part of the 22-village reporting baseline",
                )
            target_slug = item["mapping"]["target_village_id"]
            target_id = target_ids.get(str(target_slug)) if target_slug else None
            legacy_id = legacy_ids.get(item["source_village_name"])
            if not legacy_id:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Legacy village reference data is incomplete",
                )
            if item["mapping"]["mapping_status"] == "confirmed" and not target_id:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Current village reference data is incomplete")
            payload.append({
                "batch_id": str(batch_id),
                "source_filename": item["source_filename"],
                "content_sha256": item["content_sha256"],
                "size_bytes": item["size_bytes"],
                "source_village_name": item["source_village_name"],
                "legacy_village_id": legacy_id,
                "target_village_id": target_id,
                "mapping_status": item["mapping"]["mapping_status"],
                "metadata": item["metadata"],
                "raw_values": item["raw_values"],
                "normalized_values": item["normalized_values"],
                "validation_flags": item["validation_flags"],
            })
        return await client._rest_request(
            "POST", "/rest/v1/report_import_files", payload, prefer="return=representation"
        )
    except HTTPException:
        raise
    except SupabaseAdminError as exc:
        response_status = status.HTTP_409_CONFLICT if exc.status_code == 409 else status.HTTP_400_BAD_REQUEST
        raise HTTPException(status_code=response_status, detail="Unable to add workbooks to import batch") from exc


@router.get("/batches/{batch_id}")
async def get_batch(
    batch_id: UUID,
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    encoded = quote(str(batch_id), safe="")
    try:
        batches = await client._rest_request("GET", f"/rest/v1/report_import_batches?id=eq.{encoded}&select=*")
        if not batches:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import batch not found")
        files = await client._rest_request(
            "GET", f"/rest/v1/report_import_files?batch_id=eq.{encoded}&select=*&order=source_village_name.asc"
        )
        expected = int(batches[0]["expected_village_count"])
        mapping = load_official_mapping()
        expected_names = [
            str(row["ten_thon_cu"])
            for row in mapping.get("anh_xa_thon_cu", [])
            if isinstance(row, dict) and row.get("legacy_unit_type", "village") == "village"
        ]
        uploaded_names = {str(row["source_village_name"]) for row in files}
        missing_names = [name for name in expected_names if name not in uploaded_names]
        unresolved = [row["source_village_name"] for row in files if row["mapping_status"] != "confirmed"]
        pending = [row["source_village_name"] for row in files if row["review_status"] == "pending"]
        accepted = [row["source_village_name"] for row in files if row["review_status"] == "accepted"]
        rejected = [row["source_village_name"] for row in files if row["review_status"] == "rejected"]
        target_readiness = assess_target_readiness(files, mapping)
        eligible_targets = [row for row in target_readiness if row["eligible"]]
        excluded_targets = [row for row in target_readiness if not row["eligible"]]
        return {
            "batch": batches[0],
            "files": files,
            "summary": {
                "expected_village_count": expected,
                "uploaded_village_count": len(files),
                "missing_village_count": len(missing_names),
                "missing_villages": missing_names,
                "unresolved_villages": unresolved,
                "pending_review_villages": pending,
                "accepted_villages": accepted,
                "rejected_villages": rejected,
                "eligible_target_villages": eligible_targets,
                "excluded_target_villages": excluded_targets,
                "ready_to_commit": bool(eligible_targets) and not pending and bool(accepted),
            },
        }
    except HTTPException:
        raise
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Unable to retrieve import batch") from exc


@router.patch("/files/{file_id}/review")
async def review_file(
    file_id: UUID,
    payload: ReviewImportFileRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    client = _caller_client(supabase, authorization)
    encoded = quote(str(file_id), safe="")
    try:
        rows = await client._rest_request("GET", f"/rest/v1/report_import_files?id=eq.{encoded}&select=*")
        if not rows:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Import file not found")
        source = rows[0]
        now = datetime.now(timezone.utc).isoformat()
        if payload.decision == "rejected":
            decision_reason = (payload.decision_reason or "").strip()
            if not decision_reason:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="A rejection reason is required",
                )
            updated = await client._rest_request(
                "PATCH", f"/rest/v1/report_import_files?id=eq.{encoded}",
                {
                    "review_status": "rejected",
                    "review_reason": decision_reason,
                    "reviewed_by": profile.id,
                    "reviewed_at": now,
                },
                prefer="return=representation",
            )
            return updated[0]

        if source["mapping_status"] != "confirmed":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Unresolved village mapping cannot be accepted")
        if set(payload.values) != set(INDICATOR_CODES) or any(payload.values[code] is None for code in INDICATOR_CODES):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="All CT01-CT14 values are required")
        errors = validate_report(payload.values)
        blocking = [error for error in errors if error["error_type"] in BLOCKING_ERROR_TYPES]
        if blocking:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="Corrected values still violate deterministic rules")

        original_flags = source.get("validation_flags") if isinstance(source.get("validation_flags"), list) else []
        flagged_codes = {str(flag.get("ct_code")) for flag in original_flags if isinstance(flag, dict)}
        updated_metadata = dict(source.get("metadata") or {})
        if "VILLAGE" in flagged_codes:
            if not (payload.decision_reason or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="A village metadata review reason is required",
                )
            updated_metadata["village_review_reason"] = payload.decision_reason.strip()
        if "PHONE" in flagged_codes:
            if validate_phone(payload.reporter_phone) is not None or not (payload.metadata_reason or "").strip():
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="A valid reporter phone and correction reason are required",
                )
            updated_metadata["reporter_phone"] = payload.reporter_phone
            updated_metadata["phone_correction_reason"] = payload.metadata_reason.strip()
        changed_codes = {
            code for code in INDICATOR_CODES
            if source.get("normalized_values", {}).get(code) != payload.values.get(code)
        }
        reason_codes = (flagged_codes | changed_codes) - {"VILLAGE", "PHONE"}
        if any(not payload.reasons.get(code, "").strip() for code in reason_codes):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail="A review reason is required for every flagged or corrected value")

        resolutions = [{
            "import_file_id": str(file_id),
            "ct_code": code,
            "raw_value": {"value": source.get("raw_values", {}).get(code)},
            "accepted_value": payload.values[code],
            "decision": "corrected" if code in changed_codes else "accepted",
            "reason": payload.reasons[code].strip(),
            "resolved_by": profile.id,
        } for code in sorted(reason_codes)]
        if resolutions:
            await client._rest_request(
                "POST", "/rest/v1/report_import_resolutions", resolutions,
                prefer="resolution=merge-duplicates,return=representation",
            )
        updated = await client._rest_request(
            "PATCH", f"/rest/v1/report_import_files?id=eq.{encoded}",
            {
                "normalized_values": payload.values,
                "metadata": updated_metadata,
                "validation_flags": errors,
                "review_status": "accepted",
                "review_reason": None,
                "reviewed_by": profile.id,
                "reviewed_at": now,
            },
            prefer="return=representation",
        )
        return updated[0]
    except HTTPException:
        raise
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to review import file") from exc


@router.post("/batches/{batch_id}/commit")
async def commit_batch(
    batch_id: UUID,
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, Any]:
    try:
        rows = await _caller_client(supabase, authorization)._rest_request(
            "POST", "/rest/v1/rpc/commit_report_import_batch", {"p_batch_id": str(batch_id)}
        )
        if not rows:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Import batch was not committed")
        return rows[0]
    except HTTPException:
        raise
    except SupabaseAdminError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Import batch is incomplete, unresolved, unreviewed, or conflicts with an approved report",
        ) from exc
