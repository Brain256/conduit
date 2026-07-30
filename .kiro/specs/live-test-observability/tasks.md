# Implementation Plan: Live Test Observability

## Overview

Extend the Go load tester's existing test stream with authoritative run reduction, packets, events, and terminal summaries. Refactor the TypeScript dashboard around validated active observation and browser-session final state, then add deterministic SVG/JSON exports and wire the UI to the preserved REST/WebSocket lifecycle.

## Tasks

- [x] 1. Implement authoritative live-test data production in the Go load tester
  - [x] 1.1 Add the wire models and a single-owner `TestRun` reducer in `load-tester/test_run.go`
    - Define JSON-compatible frame, aggregate, request/response record, event, and final-summary types.
    - Implement immutable completion submission, cumulative metrics, latest-eligible packet selection, and one-time terminal summary creation.
    - _Requirements: 2.1, 2.2, 2.3, 3.1_

  - [x] 1.2 Refactor HTTP worker execution in `load-tester/agent.go` to submit one complete request outcome per attempt
    - Capture request payload, response payload or a non-empty failure, UTC completion time, and ping time; close response bodies.
    - Do not calculate aggregates or construct frames in workers.
    - _Requirements: 2.1, 4.2_

  - [x] 1.3 Integrate `TestRun` frame emission with the existing start and WebSocket lifecycle in `load-tester/main.go`
    - Preserve `POST /test/start`, the one-stream hand-off, one-second cadence, and channel closure.
    - Emit newly queued events exactly once, omit empty optional fields, and emit one terminal frame after workers drain.
    - _Requirements: 2.2, 2.3, 3.1, 4.1, 4.3, 4.4, 4.5, 4.6_

  - [ ]* 1.4 Write a Go property-based test for newest eligible frame packets in `load-tester/test_run_packet_property_test.go`
    - **Property 2: Frame packet selection is newest eligible completion**
    - Generate time-ordered successful/failed completions and frame times; compare reducer output with an independent latest-eligible selector.
    - Run at least 100 cases using `testing/quick` and include the required feature/property comment.
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 1.5 Write a Go property-based test for terminal summaries in `load-tester/test_run_summary_property_test.go`
    - **Property 4: Terminal summaries are whole-test and unique**
    - Compare the sole terminal frame with an independent totals, throughput, and percentile reference model across mixed outcomes.
    - Run at least 100 cases using `testing/quick` and include the required feature/property comment.
    - **Validates: Requirements 3.1**

  - [ ]* 1.6 Write a Go property-based test for event queue delivery in `load-tester/test_run_events_property_test.go`
    - **Property 6: Test-event queue is complete, retained, and exactly once**
    - Compare start/failure/completion event creation and frame draining against an independent FIFO queue model.
    - Run at least 100 cases using `testing/quick` and include the required feature/property comment.
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

  - [ ]* 1.7 Add protocol and handler integration tests in `load-tester/main_test.go`
    - Exercise valid/invalid starts and WebSocket streaming with successful and failed targets.
    - Assert JSON field names, packet/event content, one terminal frame, and stream closure while retaining the existing endpoint contract.
    - _Requirements: 2.1, 2.4, 3.1, 4.1, 4.2, 4.3, 4.4_

- [x] 2. Build validated active-observation and timeline state in the dashboard
  - [x] 2.1 Extend `dashboard/src/types/metrics.ts` with the full live-observability protocol models
    - Add aggregate, graph datum, request/response record, test event, final summary, metric frame, and export snapshot types.
    - Model the response-or-failure and event-type invariants in TypeScript.
    - _Requirements: 1.1, 2.4, 3.2, 4.7, 5.1_

  - [x] 2.2 Create `dashboard/src/state/activeObservation.ts` with transactional frame validation and active-test reduction
    - Validate IDs, timestamps, numeric domains, counts, percentile ordering, and packet exclusivity before state mutation.
    - Append value-copied graph data for valid active frames, ignore foreign metric frames without status changes, retain packets through omitted fields, and set mandated metric/packet statuses.
    - _Requirements: 1.1, 1.2, 1.3, 1.8, 1.9, 1.10, 2.4, 2.5, 2.6_

  - [x] 2.3 Create `dashboard/src/state/timeline.ts` for event validation, deduplication, and stable ordering
    - Keep first-received active event IDs once; stably order valid RFC 3339 timestamps and place invalid timestamp text after them in receipt order.
    - Reject invalid or foreign events without changing timeline data and provide the required event status.
    - _Requirements: 4.7, 4.8, 4.9, 4.10, 4.11_

  - [ ]* 2.4 Write a fast-check property test for active observation reduction in `dashboard/src/state/activeObservation.property.test.ts`
    - **Property 1: Active observation reduction is lossless and guarded**
    - Generate valid, invalid, and foreign frame sequences; verify data losslessness, datum detail, transactional errors, and silent foreign-frame behavior.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.6**

  - [ ]* 2.5 Write a fast-check property test for packet-view state in `dashboard/src/state/packetView.property.test.ts`
    - **Property 3: Packet view preserves complete received records**
    - Generate exclusive response/failure records followed by omitted-record frames and assert full sticky preservation.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 2.4, 2.5**

  - [ ]* 2.6 Write a fast-check property test for timeline reduction in `dashboard/src/state/timeline.property.test.ts`
    - **Property 7: Timeline reduction is unique, stable, and guarded**
    - Generate duplicate, foreign, malformed, valid-timestamp, and invalid-timestamp event batches against a stable-sort reference model.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 4.7, 4.8, 4.9, 4.10, 4.11**

- [x] 3. Add browser-session final-summary and immutable snapshot state
  - [x] 3.1 Create `dashboard/src/state/sessionFinals.ts` to retain final summaries and snapshots by Test_ID
    - On the first valid matching terminal frame, atomically retain one summary and a deep-copied, frozen, stable elapsed-time-sorted snapshot that includes the terminal datum.
    - Ignore malformed and duplicate terminal summaries; retain entries during stream closure, active-test changes, and in-app navigation; remove only a successfully dismissed entry.
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 5.1, 5.2, 5.3, 5.15_

  - [ ]* 3.2 Write a fast-check property test for session final retention in `dashboard/src/state/sessionFinals.property.test.ts`
    - **Property 5: Session summaries are validated, idempotent, and retained**
    - Generate prior state, malformed/matching/duplicate terminal frames, and lifecycle actions; compare with an immutable map reference model.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 3.2, 3.3, 3.4, 3.5**

  - [ ]* 3.3 Write a fast-check property test for immutable export snapshots in `dashboard/src/state/exportSnapshot.property.test.ts`
    - **Property 8: Final-summary export snapshots are stable value captures**
    - Generate graph histories and terminal frames; assert exactly one sorted deep-value snapshot including the terminal datum and no mutation under later actions.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 5.1, 5.2, 5.3**

  - [ ]* 3.4 Write a fast-check property test for isolated final dismissal in `dashboard/src/state/sessionDismissal.property.test.ts`
    - **Property 14: Successful dismissal isolates summary and export removal**
    - Generate distinct session-final maps and dismiss one entry; assert precisely that summary, snapshot, and control disappear.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 3.6, 5.15**

- [ ] 4. Implement validated, deterministic final-summary export services
  - [ ] 4.1 Create `dashboard/src/export/validateExportSnapshot.ts` and `dashboard/src/export/latencyExportJson.ts`
    - Defensively validate snapshot shape, IDs, parameters, summary/domain invariants, and graph values before generation.
    - Serialize a deliberately ordered UTF-8 JSON document containing required metadata, the whole final summary, and graph data in unchanged snapshot order.
    - _Requirements: 5.8, 5.10_

  - [ ] 4.2 Create `dashboard/src/export/latencySvg.ts` for deterministic standalone latency SVG generation
    - Produce the fixed-size, XML-escaped, locale-independent SVG with nonzero fallback domains, axes, fixed ticks, legend, and every p50/p95/p99 point.
    - Include all required visible summary metadata and no script, external asset, remote request, or browser-state dependency.
    - _Requirements: 5.5, 5.6, 5.7_

  - [ ] 4.3 Create `dashboard/src/export/exportFinalSummary.ts` and `dashboard/src/export/filenames.ts`
    - Coordinate pre-generation validation, separate one-time SVG/JSON serializer attempts, exact filenames, Blob MIME types, independent downloads, format-specific errors, and URL cleanup through injected dependencies.
    - Preserve the snapshot on unavailable, invalid, partial-failure, and total-failure paths.
    - _Requirements: 5.4, 5.9, 5.10, 5.11, 5.12, 5.13, 5.14_

  - [ ]* 4.4 Write a fast-check property test for export validation and independent invocation in `dashboard/src/export/exportValidation.property.test.ts`
    - **Property 9: Export validation gates independent generation**
    - Generate valid/invalid snapshots and controlled serializer outcomes; verify invalid snapshots invoke neither serializer and valid snapshots invoke each exactly once.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 5.4, 5.10**

  - [ ]* 4.5 Write a fast-check property test for the SVG serializer in `dashboard/src/export/latencySvg.property.test.ts`
    - **Property 10: SVG export is deterministic, self-contained, and complete**
    - Generate valid zero, one-point, and equal-time snapshots; inspect deterministic bytes, prohibited content, metadata, labels, and per-series point completeness.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 5.5, 5.6, 5.7**

  - [ ]* 4.6 Write a fast-check property test for JSON export fidelity in `dashboard/src/export/latencyExportJson.property.test.ts`
    - **Property 11: JSON export is an ordered lossless snapshot representation**
    - Generate valid snapshots, parse generated JSON, and compare identity, parameters, all summary fields, datum fields, and graph order.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 5.8**

  - [ ]* 4.7 Write a fast-check property test for exact export filenames in `dashboard/src/export/filenames.property.test.ts`
    - **Property 12: Export filenames are exact**
    - Generate valid Test_ID values and assert exact SVG and JSON names.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 5.11, 5.12**

  - [ ]* 4.8 Write a fast-check property test for partial export failures in `dashboard/src/export/exportPartialFailure.property.test.ts`
    - **Property 13: Partial export failure preserves independent success**
    - Inject exactly-one-format serializer/download failures and verify retained state, counterpart delivery, and format-specific error reporting.
    - Run at least 100 cases with reproducible failure seeds and include the required feature/property comment.
    - **Validates: Requirements 5.13**

- [x] 5. Connect dashboard state and present all live-test observability views
  - [ ] 5.1 Refactor `dashboard/src/hooks/useMetricsStream.ts` to dispatch parsed stream frames and terminal-close state
    - Retain ownership of active socket creation/cleanup only; dispatch parsed frames to app-shell reducers and track whether closure followed an accepted terminal summary.
    - _Requirements: 1.1, 3.8_

  - [ ] 5.2 Update `dashboard/src/components/Charts.tsx` for interactive latency and throughput graphs
    - Render waiting, live, and first-datum states; plot all required series with elapsed-time axes and provide complete datum/no-datum interaction details.
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10_

  - [ ] 5.3 Add `dashboard/src/components/PacketView.tsx` and render sticky latest request-response data
    - Present request payload, completion timestamp, ping, and exactly one response payload or failure; render the exact initial-absence message.
    - _Requirements: 2.4, 2.5, 2.6_

  - [ ] 5.4 Update `dashboard/src/components/Timeline.tsx` to display the active timeline through its control
    - Render ordered timestamp/type/message entries, no-event and pending-event states, and labeled empty fields when the controlled view is open.
    - _Requirements: 4.12, 4.13, 4.14, 4.15_

  - [ ] 5.5 Add `dashboard/src/components/FinalSummary.tsx` with retained-summary dismissal and export controls
    - Render one selected summary's complete values, surface dismissal failures without mutation, invoke the export coordinator, and render required unavailable/invalid/partial/total export outcomes.
    - _Requirements: 3.2, 3.6, 3.7, 5.4, 5.9, 5.10, 5.13, 5.14, 5.15_

  - [ ] 5.6 Wire reducers, stream actions, retained session finals, and all view components through `dashboard/src/App.tsx`
    - Keep active observation scoped to the selected test while keeping session finals/snapshots across stream closure, active-test switches, and in-app navigation.
    - Handle early stream closure without a valid terminal summary using the exact required status.
    - _Requirements: 1.1, 3.5, 3.8, 4.12, 5.3_

  - [ ]* 5.7 Add dashboard component and integration tests in `dashboard/src/App.test.tsx`
    - Cover chart empty/interactive states, packet response/failure/absence, final-summary retention and early-close error, timeline controls/empty states, and export UI errors/download dependencies.
    - _Requirements: 1.4, 1.5, 1.7, 1.8, 2.4, 2.6, 3.2, 3.7, 3.8, 4.12, 4.13, 4.14, 4.15, 5.9, 5.14_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are not optional.
- Property tasks map one-for-one to the design's 14 correctness properties and use Go `testing/quick` or pinned `fast-check@4.6.0` as designed.
- The plan preserves the existing REST/WebSocket lifecycle, performs browser-only exports, and keeps final summaries only for the Browser_Session.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3"] },
    { "id": 2, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.4", "2.5", "2.6", "3.1"] },
    { "id": 3, "tasks": ["1.7", "3.2", "3.3", "3.4", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.6"] },
    { "id": 5, "tasks": ["4.3", "4.5", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 6, "tasks": ["4.4", "4.7", "4.8", "5.5"] },
    { "id": 7, "tasks": ["5.6"] },
    { "id": 8, "tasks": ["5.7"] }
  ]
}
```
