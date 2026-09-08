# FMS-B001 — Canonical Event Contract

## Objective
Provide a source-agnostic boundary between the client's existing operational process, Faztrack FMS telemetry, and MEI.

## Non-negotiable rules
1. Preserve client operational terminology in user-facing fields and UI.
2. Do not redesign the client's mature business process during digitalisation.
3. Human decisions remain human-controlled where defined, especially Plan, P2H safety judgement, and exception/reason classification that telemetry cannot prove.
4. FMC650/Traccar data starts as machine observation, not operational truth.
5. Machine observations become authoritative only after parallel-run parity and validation.
6. No silent overwrite. Raw/source identity and review status must remain traceable.
7. Ritasi counting logic remains REVIEW until the August 2026 Input Ritasi vs In Prod variance is resolved.
8. Fuel Issued and Fuel Consumed are different measurements and must not overwrite each other.
9. Rain and Slippery are separate operational events.
10. MEI consumes canonical operational events and must not depend directly on Teltonika/Traccar protocol fields.

## Initial event flow

Existing Excel / Human Input ─┐
                             ├─> CanonicalMiningEvent ─> FMS domain services ─> MEI
FMC650 -> Traccar -> Adapter ─┘

## Phase gate
This contract is safe to build before hardware arrival because it does not freeze unvalidated mining calculations. The next implementation is FMS-B002 Traccar Adapter, followed by Digital Shift Board, Digital P2H, and CCR Hourly Control.
