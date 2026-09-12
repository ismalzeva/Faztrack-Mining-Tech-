# Faztrack FMS — PRE-POC Gate Status

## Gate A — Domain / Process Fidelity: PASS
- Shift Assignment remains Human Authority.
- P2H decision remains Human Authority.
- Client terms are preserved.
- Machine telemetry is PROVISIONAL.
- Ritasi counting is not auto-enabled while August 2026 parity investigation is open.
- Working / Standby / Delay / BD are not inferred from speed or ignition alone.

## Gate B — Telemetry Pipeline: READY FOR DETERMINISTIC TEST
`Simulator -> Traccar-shaped position -> Traccar Adapter -> CanonicalMiningEvent`

Expected canonical events for the current pre-POC unit:
- Lokasi
- Kecepatan
- HM (when engineHours is supplied)
- KM (when totalDistance is supplied)

Forbidden automatic inference at this gate:
- Ritasi
- Status Unit

## Gate C — Persistence: BLOCKED BY DEPLOYMENT CONFIG
The repository has D1/Drizzle persistence code and FMS tables, but `.openai/hosting.json` currently has `"d1": null`.

Therefore we must NOT claim end-to-end persistence PASS yet.

Required actions before persistence PASS:
1. Provision/bind Cloudflare D1 for this app.
2. Add migration/generation workflow for the FMS schema.
3. Apply schema to the bound D1 database.
4. Verify POST/GET for Shift Assignment.
5. Verify POST/GET for P2H.
6. Verify canonical event persistence and idempotency.
7. Verify CCR Hourly reads the same shift/unit context.

## Gate D — Hardware: WAITING FOR FMC650
After Gate C passes, replace simulator input with real Traccar positions from FMC650. Downstream canonical/FMS/MEI contracts must remain unchanged.

## Deterministic demo endpoint
`GET /api/fms/pre-poc`

This endpoint verifies the process/telemetry contract without pretending persistence has passed. It explicitly reports persistence as NOT_TESTED until D1 is bound.
