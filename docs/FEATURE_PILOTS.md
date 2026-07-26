# Ba Na SmartLink — feature pilot gates

The release candidate keeps the new pilot domains isolated and fail-closed.
They are not production-ready merely because their API and migration exist.

## Enabled in the current RC

- Citizen field reports: `FEATURE_CASES=true`.
- Citizen attachments: up to five validated JPG/PNG/WebP images per case. Video
  remains fail-closed until a server-side duration probe is installed; the UI
  does not pretend that a client-provided duration is trustworthy.
- Knowledge centre and Digital Champions: available to authenticated internal roles.
- Chatbot: deterministic, role-scoped answers remain available when Gemini is unavailable; Gemini only explains already-filtered aggregate rows.

## Disabled by default

Set these only on a separate staging project after the stated evidence exists:

| Flag | Pilot | Required evidence before enabling |
| --- | --- | --- |
| `FEATURE_VOICE` | short speech-to-text input | HTTPS, consent copy, retention, transcription review and accessibility test |
| `FEATURE_IOT_PILOT` | sensor observations and internal alerts | device inventory, calibration record, gateway credential, alert owner/SLA and false-positive drill |
| `FEATURE_TOURISM_PILOT` | approved places and map catalogue | verified coordinates, content licence, opening hours owner and non-map fallback |
| `FEATURE_DIGITAL_MATURITY` | digital maturity assessment | approved framework, accountable data owner, scoring rubric and review schedule |
| `FEATURE_SCENARIO_SIMULATION` | deterministic scenario simulation | approved assumptions, formula owner, versioned baseline and decision-use disclaimer |

`FEATURE_VOICE` enables both press-to-speak input and answer playback. The
browser requests `vi-VN` and prefers a voice explicitly labelled Da Nang,
Central Vietnamese or Central Vietnam. When the operating system exposes only
a generic Vietnamese voice, the interface states that fallback instead of
claiming a regional voice that cannot be verified.

The IoT endpoints accept only authenticated `admin_xa` mutations. Raw sensor data,
device credentials and internal alert notes are never public. The public tourism
endpoint returns only approved catalogue fields and is unavailable while the flag
is off.

## Scenario simulation safety contract

Scenario runs are deterministic (`baseline x (1 + assumption_percent / 100)`),
store baseline/assumptions/formula version, and never write back into reports.
They are decision-support drafts, not forecasts or official warnings.
Both the interface and API remain restricted to `admin_xa` and fail closed unless
`FEATURE_SCENARIO_SIMULATION=true`. Digital maturity follows the same
administrator-only contract through `FEATURE_DIGITAL_MATURITY`.

## External release gates still owned by the operator

Credential rotation and access-log review, real staging RLS, backup/restore,
five-principal UAT, privacy/legal approval, device/content ownership and release
approval cannot be proven by source code. Keep the flags off until those gates
are signed in the staging evidence record.
