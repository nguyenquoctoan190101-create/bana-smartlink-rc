from __future__ import annotations

from datetime import datetime
import re
from typing import Annotated, Any, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field, field_validator

from routers.auth import get_settings, get_supabase_admin, require_admin_or_leader, require_admin_xa
from services.settings import Settings
from services.supabase_admin import SupabaseAdminClient, SupabaseAdminError, UserProfile

router = APIRouter(prefix="/pilots", tags=["feature-flagged-pilots"])


class EvacuationPointRequest(BaseModel):
    village_id: UUID
    name: str = Field(min_length=3, max_length=180)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    capacity_households: int = Field(gt=0, le=100000)
    contact_name: str = Field(min_length=2, max_length=180)
    contact_phone: str | None = Field(default=None, max_length=40)

    @field_validator("contact_phone")
    @classmethod
    def validate_contact_phone(cls, value: str | None) -> str | None:
        """Accept only an explicitly supplied, plausible phone number.

        A missing number is valid for synthetic/pre-publication points; a fake
        placeholder must never be presented as an operational contact.
        """
        if value is None or not value.strip():
            return None
        normalized = re.sub(r"[\s().-]+", "", value)
        if not re.fullmatch(r"\+?\d{7,15}", normalized):
            raise ValueError("contact_phone must be a valid phone number")
        return value.strip()


class EvacuationPointVerificationRequest(BaseModel):
    is_verified: bool


@router.get("/evacuation-points")
async def list_public_evacuation_points(
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> list[dict[str, Any]]:
    """Return verified evacuation points without private contact details.

    This is a public preparedness directory, not an emergency alert channel.
    """
    try:
        return await supabase._rest_request(
            "GET",
            "/rest/v1/evacuation_points?select=id,village_id,name,latitude,longitude,capacity_households,is_verified&is_verified=eq.true&order=name.asc",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=502, detail="Unable to retrieve evacuation points") from exc


@router.get("/evacuation-points/admin")
async def list_admin_evacuation_points(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    """Return the internal evacuation catalogue for admin/leader review."""
    return await _caller(supabase, authorization)._rest_request(
        "GET",
        "/rest/v1/evacuation_points?select=id,village_id,name,latitude,longitude,capacity_households,contact_name,contact_phone,is_verified,created_at,updated_at&order=name.asc",
    )


@router.post("/evacuation-points", status_code=201)
async def create_evacuation_point(
    payload: EvacuationPointRequest,
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Create an unverified point; publication requires a separate admin action."""
    try:
        rows = await _caller(supabase, authorization)._rest_request(
            "POST",
            "/rest/v1/evacuation_points",
            {**payload.model_dump(mode="json"), "is_verified": False},
            prefer="return=representation",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=400, detail="Unable to save evacuation point") from exc
    return rows[0]


@router.patch("/evacuation-points/{point_id}/verification")
async def verify_evacuation_point(
    point_id: UUID,
    payload: EvacuationPointVerificationRequest,
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Publish or withdraw a point after the admin has verified its source."""
    try:
        rows = await _caller(supabase, authorization)._rest_request(
            "PATCH",
            f"/rest/v1/evacuation_points?id=eq.{point_id}",
            {"is_verified": payload.is_verified},
            prefer="return=representation",
        )
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=400, detail="Unable to update evacuation point") from exc
    if not rows:
        raise HTTPException(status_code=404, detail="Evacuation point not found")
    return rows[0]


@router.get("/status")
async def pilot_status(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, bool]:
    """Expose feature flags to the internal pilot workbench without exposing data."""
    return {"iot_enabled": bool(settings.feature_iot_pilot), "tourism_enabled": bool(settings.feature_tourism_pilot)}


class SensorObservationRequest(BaseModel):
    device_id: UUID
    observed_at: datetime
    value: float
    unit: str = Field(min_length=1, max_length=40)
    quality_flag: Literal["good", "suspect", "bad", "uncalibrated"] = "good"
    source_message_id: str | None = Field(default=None, max_length=180)


class SensorDeviceRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    device_type: Literal["water_level", "rain_gauge", "vibration", "noise", "tilt", "other"]
    unit: str = Field(min_length=1, max_length=40)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)


class TourismPlaceRequest(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    category: Literal["nature", "heritage", "homestay", "food", "craft", "service"]
    summary: str = Field(min_length=3, max_length=2000)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    accessibility_notes: str | None = Field(default=None, max_length=1000)
    opening_hours: str | None = Field(default=None, max_length=300)


def _bearer(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer ") or not authorization[7:].strip():
        raise HTTPException(status_code=401, detail="Bearer token required")
    return authorization[7:].strip()


def _caller(client: SupabaseAdminClient, authorization: str | None) -> SupabaseAdminClient:
    return client.as_user(_bearer(authorization))


def _pilot_enabled(settings: Settings, name: str) -> None:
    if not getattr(settings, name, False):
        raise HTTPException(status_code=404, detail="Pilot feature is not enabled")


@router.get("/tourism/places")
async def list_public_tourism_places(
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
) -> list[dict[str, Any]]:
    _pilot_enabled(settings, "feature_tourism_pilot")
    try:
        rows = await supabase._rest_request("GET", "/rest/v1/tourism_places?select=id,name,category,summary,latitude,longitude,accessibility_notes,opening_hours&commune_id=eq." + settings.bana_commune_id + "&status=eq.approved&order=name.asc")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=502, detail="Unable to retrieve tourism places") from exc
    return rows


@router.post("/tourism/places", status_code=201)
async def create_tourism_place(
    payload: TourismPlaceRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _pilot_enabled(settings, "feature_tourism_pilot")
    data = {**payload.model_dump(exclude_none=True), "commune_id": settings.bana_commune_id, "created_by": profile.id}
    try:
        rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/tourism_places", data, prefer="return=representation")
    except SupabaseAdminError as exc:
        raise HTTPException(status_code=400, detail="Unable to save tourism place") from exc
    return rows[0]


@router.get("/sensors/devices")
async def list_sensor_devices(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    _pilot_enabled(settings, "feature_iot_pilot")
    return await _caller(supabase, authorization)._rest_request("GET", "/rest/v1/sensor_devices?select=*&commune_id=eq." + settings.bana_commune_id + "&order=name.asc")


@router.post("/sensors/devices", status_code=201)
async def create_sensor_device(
    payload: SensorDeviceRequest,
    profile: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _pilot_enabled(settings, "feature_iot_pilot")
    data = {**payload.model_dump(exclude_none=True), "commune_id": settings.bana_commune_id, "created_by": profile.id}
    rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/sensor_devices", data, prefer="return=representation")
    return rows[0]


@router.post("/sensors/observations", status_code=201)
async def ingest_sensor_observation(
    payload: SensorObservationRequest,
    _: Annotated[UserProfile, Depends(require_admin_xa)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _pilot_enabled(settings, "feature_iot_pilot")
    data = payload.model_dump(mode="json")
    rows = await _caller(supabase, authorization)._rest_request("POST", "/rest/v1/sensor_observations", data, prefer="return=representation")
    return rows[0]


@router.get("/sensors/observations")
async def list_sensor_observations(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
    device_id: UUID | None = None,
) -> list[dict[str, Any]]:
    """Return recent pilot observations for internal review only.

    This endpoint deliberately exposes raw readings only to admin/leader and never
    creates alerts or public messages by itself.
    """
    _pilot_enabled(settings, "feature_iot_pilot")
    query = "/rest/v1/sensor_observations?select=*&order=observed_at.desc&limit=100"
    if device_id is not None:
        query += f"&device_id=eq.{device_id}"
    return await _caller(supabase, authorization)._rest_request("GET", query)


@router.get("/alerts")
async def list_internal_alerts(
    _: Annotated[UserProfile, Depends(require_admin_or_leader)],
    settings: Annotated[Settings, Depends(get_settings)],
    supabase: Annotated[SupabaseAdminClient, Depends(get_supabase_admin)],
    authorization: str | None = Header(default=None),
) -> list[dict[str, Any]]:
    _pilot_enabled(settings, "feature_iot_pilot")
    return await _caller(supabase, authorization)._rest_request("GET", "/rest/v1/alerts?select=id,severity,headline,description,status,source,effective_from,effective_until&commune_id=eq." + settings.bana_commune_id + "&order=effective_from.desc")


__all__ = ["router"]
