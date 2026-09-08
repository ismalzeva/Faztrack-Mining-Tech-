# Faztrack FMS — End-to-End Pre-POC

## Target flow

Approved Roster / Assignment
→ Digital Shift Board
→ P5M reminder/display
→ Digital P2H
→ Unit operation
→ FMC650/Traccar or PRE-POC Simulator
→ Canonical Event API
→ CCR Hourly Control
→ Shift/Daily Summary
→ MEI Input

## Process fidelity
- Assignment is prepared before briefing; Shift Board is a digital display/reminder, not a new approval step.
- P2H physical inspection remains a human activity and safety decision.
- `PRESENT` is not duplicated with a new `AVAILABLE` step.
- User-facing terminology follows the client source.
- Machine observations are PROVISIONAL until parallel-run validation.

## Persistence
D1/Drizzle tables on the feature branch:
- fms_units
- fms_shift_assignments
- fms_p2h_checks
- fms_canonical_events
- fms_hourly_control

Canonical event ingestion is idempotent by `event_id` using conflict-do-nothing. Raw source identity and authority status are retained.

## Business-rule gates
- Ritasi: HOLD_FOR_AUTHORITY. UI/API may carry provisional values, but the automatic counting rule cannot be declared final yet.
- BCM: conversion basis remains REVIEW; do not hard-code 1.76 universally.
- Status Unit: telemetry can support inference; taxonomy/reason validation follows client rules.
- Fuel: Issued and Consumed remain separate measurements.
- Plan: HUMAN_AUTHORITY.
- P2H `Layak Dioperasikan / Tidak Layak Dioperasikan`: HUMAN_AUTHORITY.

## Definition of Pre-POC success
1. One Shift Assignment can be persisted and reused by P2H and CCR.
2. Simulated Traccar positions create canonical Lokasi/Kecepatan/HM/KM events for the assigned Unit.
3. Events persist without silent overwrite.
4. CCR can read the same shift/unit context.
5. No unvalidated rule silently generates Ritasi or Status Unit truth.
6. The simulator can later be replaced by real FMC650 → Traccar input without changing downstream domain contracts.
