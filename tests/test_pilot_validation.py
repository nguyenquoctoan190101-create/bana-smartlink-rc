from uuid import uuid4

import pytest
from pydantic import ValidationError

from routers.pilots import EvacuationPointRequest


def _payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "village_id": uuid4(),
        "name": "Nhà văn hóa thôn",
        "latitude": 15.95,
        "longitude": 108.12,
        "capacity_households": 120,
        "contact_name": "Trực ban UBND xã",
        "contact_phone": None,
    }
    payload.update(overrides)
    return payload


def test_evacuation_contact_phone_may_be_unknown_before_authority_confirmation() -> None:
    point = EvacuationPointRequest.model_validate(_payload())
    assert point.contact_phone is None


def test_evacuation_contact_phone_rejects_fake_or_malformed_values() -> None:
    with pytest.raises(ValidationError):
        EvacuationPointRequest.model_validate(_payload(contact_phone="000000"))


def test_evacuation_contact_phone_accepts_explicit_number() -> None:
    point = EvacuationPointRequest.model_validate(_payload(contact_phone="0901 234 567"))
    assert point.contact_phone == "0901 234 567"
