# Ba Na SmartLink — feature pilot gates

The release candidate keeps the new pilot domains isolated and fail-closed.
They are not production-ready merely because their API and migration exist.

## Enabled in the current RC

- Citizen field reports: `FEATURE_CASES=true`.
- Citizen attachments: up to five validated JPG/PNG/WebP images per case. Video
  remains fail-closed until a server-side duration probe is installed; the UI
  does not pretend that a client-provided duration is trustworthy.
- Knowledge centre, Digital Champions and deterministic what-if scenarios: available to authenticated internal roles.
- Chatbot: deterministic, role-scoped answers remain available when Gemini is unavailable; Gemini only explains already-filtered aggregate rows.

## Disabled by default

Set these only on a separate staging project after the stated evidence exists:

| Flag | Pilot | Required evidence before enabling |
| --- | --- | --- |
| `FEATURE_VOICE` | short speech-to-text input | HTTPS, consent copy, retention, transcription review and accessibility test |
| `FEATURE_IOT_PILOT` | sensor observations and internal alerts | device inventory, calibration record, gateway credential, alert owner/SLA and false-positive drill |
| `FEATURE_TOURISM_PILOT` | approved places and map catalogue | verified coordinates, content licence, opening hours owner and non-map fallback |

The IoT endpoints accept only authenticated `admin_xa` mutations. Raw sensor data,
device credentials and internal alert notes are never public. The public tourism
endpoint returns only approved catalogue fields and is unavailable while the flag
is off.

## What-if safety contract

Scenario runs are deterministic (`baseline x (1 + assumption_percent / 100)`),
store baseline/assumptions/formula version, and never write back into reports.
They are decision-support drafts, not forecasts or official warnings.

## External release gates still owned by the operator

Credential rotation and access-log review, real staging RLS, backup/restore,
five-principal UAT, privacy/legal approval, device/content ownership and release
approval cannot be proven by source code. Keep the flags off until those gates
are signed in the staging evidence record.
