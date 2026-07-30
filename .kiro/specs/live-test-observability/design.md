# Technical Design: Live Test Observability

## Overview

This feature extends, but does not replace, the existing `POST /test/start` → `GET /test/{id}/stream` WebSocket lifecycle. The Go load tester produces authoritative test-scoped `MetricFrame`s; the Dashboard validates and reduces only frames belonging to the active test. It then presents live latency/throughput graphs, the latest completed request-response packet, a timeline, and retained final summaries.

Requirement 5 adds browser-only exports to that established lifecycle. When the Dashboard accepts the first valid completed frame and displays its summary, it captures one immutable, test-scoped export snapshot. A summary's export control independently produces (1) a standalone, README-ready UTF-8 SVG latency graph and (2) a UTF-8 JSON source-data download from that snapshot. Export neither adds a REST endpoint nor changes the WebSocket protocol after the terminal frame has arrived.

### Research findings and decisions

- The current Go service owns a buffered channel per `Test_ID`, stores it in the session map after `POST /test/start`, and transfers that channel once to `GET /test/{id}/stream`. The revised design keeps these routes, their one-stream hand-off, and terminal channel closure unchanged.
- Current frame production already has a one-second cadence and a final `done` frame. A per-test `TestRun` reducer will extend that producer with packets, events, cumulative summaries, and terminal data without introducing a polling or export API.
- The Dashboard's `useMetricsStream` currently owns the active socket and resets on active-test change. The app-shell reducer will instead own browser-session final summaries and export snapshots, allowing them to survive socket closure and in-app navigation while live observation continues to be active-test scoped.
- Recharts remains the interactive live-chart dependency. README exports use a separate deterministic SVG serializer rather than serializing a Recharts DOM tree; this avoids JavaScript, responsive-layout, font-loading, and external-asset dependencies in exported files.
- Full request/response bodies remain in memory and on the existing stream as required. A payload size/redaction policy remains a production hardening follow-up identified in the requirements assumptions.

## Architecture

```mermaid
sequenceDiagram
  participant O as Operator
  participant D as Dashboard App Shell and Reducers
  participant S as Load Tester
  participant T as HTTP Target
  O->>D: Start test
  D->>S: POST /test/start
  S-->>D: test_id
  D->>S: WebSocket GET /test/{id}/stream
  loop test execution
    S->>T: HTTP request
    T-->>S: response or failure
    S->>S: reduce completion, packet, event, aggregate
    S-->>D: MetricFrame
    D->>D: validate and reduce active observation
  end
  S-->>D: terminal MetricFrame (done, final_summary, events)
  D->>D: append terminal datum; retain summary; deep-copy ordered export snapshot
  O->>D: Select export for a retained summary
  D->>D: validate snapshot, independently generate SVG and JSON, download successes
```

The load tester owns one `TestRun` reducer for each generated `Test_ID`. Workers submit immutable completion facts; only the reducer updates counters, latency samples, latest packet, and pending events. It emits the existing per-test frame stream at the current cadence and one terminal frame after work drains. The existing session map and WebSocket writer remain the only server-to-browser transport.

The Dashboard has two ownership scopes: `activeObservation` is keyed to the currently selected `Test_ID` and may reset on selection change; `sessionFinals` is an app-shell map keyed by completed `Test_ID` and persists for the Browser_Session. Each `sessionFinals` entry pairs a displayed `FinalSummary` with its immutable export snapshot. It is not local-storage persistence: closing the tab or leaving the application releases the data, while in-app navigation does not.

## Components and Interfaces

### Load tester boundaries

- **`TestRun` reducer:** accepts `RequestCompletion` values from workers; owns cumulative latency samples, completed/failed counts, `latestRecord`, event IDs, and `pendingEvents`. It emits immutable frame snapshots. One reducer owns mutation, so packet/event facts cannot be concurrently observed half-written.
- **HTTP worker:** captures request method, URL, headers, and body; records completion timestamp and ping time; captures either response status/headers/body or a non-empty failure; closes response bodies; and submits exactly one completion fact. It does not calculate aggregates or construct frames.
- **Frame builder:** produces aggregate values, adds the latest record whose completion is not later than the frame timestamp, atomically drains newly created events, and omits optional fields when no eligible value exists. Terminal construction produces the sole `done: true` frame with the whole-test `final_summary` and remaining events.
- **REST/WebSocket handlers:** keep `POST /test/start`, `GET /test/{id}/stream`, generated UUID IDs, the buffered frame channel, and one channel consumer. No export endpoint, server filesystem write, or background export job is introduced.

### Dashboard boundaries

- **`useMetricsStream`:** owns socket creation/cleanup for the active test, parses incoming JSON, records whether a close followed an accepted terminal frame, and dispatches frames/actions. It does not decide presentation or retain final summaries.
- **Frame validator and active-observation reducer:** rejects malformed active frames before mutation; ignores foreign metric frames without altering metric status; appends exactly one valid `GraphDatum`; keeps packets sticky across an omitted packet field; and handles validated events with first-receipt deduplication and stable ordering.
- **Session-final reducer:** accepts the first valid terminal summary for a test, creates the corresponding snapshot in the same atomic state transition, ignores duplicate terminal summaries, preserves entries through in-app lifecycle actions, and removes only the selected summary/snapshot after a successful dismissal action.
- **`Charts`, `PacketView`, `FinalSummary`, and `Timeline`:** are presentational components driven by reducer state. `Charts` supplies both live graphs and discrete datum/no-datum interaction detail. `FinalSummary` exposes separate dismissal and export controls. Components never mutate snapshots or derive an export from live mutable graph data.
- **`exportFinalSummary` coordinator:** receives one validated snapshot and two injected pure serializers (`createLatencySvg`, `createLatencyExportJson`) plus a browser download sink. It is the sole component that invokes exports, tracks per-format outcome, and reports partial failures.
- **SVG and JSON serializers:** are pure functions over a snapshot. They have no access to active charts, the network, current time, random values, locale-sensitive formatting, or browser state; their output can therefore be unit/property tested and is repeatable.

### Lifecycle and state flow

1. A valid active frame is reduced into graph, packet, and timeline state. Invalid active metric data leaves graph/display data unchanged and reports the required metric status; a foreign metric frame is silently ignored for metric state.
2. The first valid completed frame for the active test is reduced in this order: append its valid graph datum, retain the final summary, stable-sort a copied graph-data array by elapsed seconds (receipt order breaks ties), and deep-copy/freeze it with the final summary as the export snapshot. Thus the completed-frame datum is included.
3. A duplicate completed frame cannot replace the already retained final or snapshot. Later frame, chart, packet, event, navigation, and stream-close actions cannot mutate a snapshot.
4. The export control first locates the displayed summary's snapshot. It performs all snapshot validation before starting either serializer. Once valid, it invokes SVG and JSON generation exactly once each even when the other generation or its download fails.
5. Successful individual outputs download immediately. A failed format reports a format-specific error; neither success is rolled back. Successful dismissal removes only the selected summary, its snapshot, and that summary's export control.

## Data Models

Public timestamps are UTF-8 UTC RFC 3339 strings. Elapsed durations are seconds; ping values are milliseconds. All aggregate/summary numeric values must be finite; elapsed, counts, throughput, and ping values are non-negative; counts are safe non-negative integers; and `p50_ms <= p95_ms <= p99_ms`.

```ts
type TestParameters = { port: number; duration_seconds: number; target_rps: number; workers: number };
type AggregateMetrics = {
  throughput_rps: number; completed_count: number; failed_count: number;
  p50_ms: number; p95_ms: number; p99_ms: number;
};
type GraphDatum = { elapsed_seconds: number } & AggregateMetrics;
type RequestPayload = { method: string; target_url: string; headers: Record<string, string[]>; body: string };
type ResponsePayload = { status_code: number; headers: Record<string, string[]>; body: string };
type RequestResponseRecord = {
  completed_at: string; ping_ms: number; request: RequestPayload;
  response?: ResponsePayload; failure?: string;
};
type TestEvent = {
  event_id: string; test_id: string; timestamp: string;
  type: 'test-started' | 'request-failed' | 'test-completed'; message: string;
};
type FinalSummary = {
  test_id: string; parameters: TestParameters; elapsed_seconds: number;
  completed_count: number; failed_count: number; achieved_throughput_rps: number;
  p50_ms: number; p95_ms: number; p99_ms: number;
};
type MetricFrame = {
  test_id: string; timestamp: string; elapsed_seconds: number; done: boolean;
  aggregate: AggregateMetrics; request_response_record?: RequestResponseRecord;
  events?: TestEvent[]; final_summary?: FinalSummary; agents: AgentMetrics[];
  backend_health: BackendHealthEntry[];
};
type FinalSummaryExportSnapshot = Readonly<{
  test_id: string; final_summary: Readonly<FinalSummary>;
  graph_data: ReadonlyArray<Readonly<GraphDatum>>;
}>;
type SessionFinal = Readonly<{
  summary: Readonly<FinalSummary>; export_snapshot: FinalSummaryExportSnapshot;
}>;
```

`RequestResponseRecord` has an exclusive outcome invariant: exactly one of `response` and `failure` exists. `TestEvent.event_id` is a test-scoped monotonic opaque identifier, allowing duplicate suppression without conflating distinct equal-looking events. `GraphDatum` is a value copy of frame values, never a reference to a mutable frame or chart object.

`FinalSummaryExportSnapshot` is created only with the first accepted summary for its ID. Construction validates/copies the summary and graph data, performs a stable ascending sort by `elapsed_seconds`, copies each datum, and deep-freezes the stored object (with TypeScript `Readonly` types also preventing mutation through normal application APIs). Its `test_id` must equal `final_summary.test_id`. The session reducer keeps snapshots in `Map<TestID, SessionFinal>` outside components that may unmount.

### Export document contracts

`LatencyExportData` is serialized with deterministic property ordering as UTF-8 JSON:

```json
{
  "schema_version": 1,
  "format": "live-test-observability/latency-export",
  "test_id": "<Test_ID>",
  "parameters": { "port": 0, "duration_seconds": 0, "target_rps": 0, "workers": 0 },
  "final_summary": { "...every FinalSummary field...": "..." },
  "graph_data": [{ "elapsed_seconds": 0, "throughput_rps": 0, "completed_count": 0, "failed_count": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0 }]
}
```

The top-level metadata repeats test identity/configuration for inspection; `final_summary` contains every summary value. `graph_data` is copied in exactly snapshot order with every required datum field. `JSON.stringify` is called on a deliberately constructed object (rather than a map), encoded into a `Blob` as `application/json;charset=utf-8`; no generated-at timestamp is included, so equal snapshots produce byte-identical JSON.

### Deterministic README-ready SVG

`createLatencySvg(snapshot)` returns one complete UTF-8 `image/svg+xml` document. It uses a fixed `1200 × 760` view box, fixed margins, embedded CSS only, fixed colors/line widths, and a fixed tick count. It emits no `<script>`, event handler, `<foreignObject>`, remote URL, `<image>`, stylesheet link, font import, or external asset reference. Text and attribute values are XML-escaped; numeric formatting is locale-independent, canonicalizes `-0` to `0`, and serializes finite values deterministically.

The serializer uses `xMin = 0` and `xMax = max(1, largest elapsed_seconds)` and `yMin = 0` and `yMax = max(1, largest p99_ms)`. These nonzero fallback domains make a valid one-point or all-zero graph render consistently. It draws labeled elapsed-time-seconds and ping-time-milliseconds axes, fixed ticks, a legend, and distinct labeled p50/p95/p99 polylines. Each series has an explicit point for every graph datum, including equal elapsed positions, so no snapshot value is omitted. It also emits visible metadata text for Test_ID, all configured parameters, actual elapsed time, totals, achieved throughput, and p50/p95/p99 final values. Equal snapshot inputs yield byte-identical SVG output.

The SVG is downloaded from a UTF-8 `Blob` with type `image/svg+xml;charset=utf-8` and exact filename `<Test_ID>-latency.svg`. A README can reference the saved file directly because the document needs neither browser application JavaScript nor network access at render time.

### Export validation and outcomes

Before either serializer is invoked, `validateExportSnapshot` checks: snapshot/final-summary/graph-data presence and shape; matching test IDs; a positive finite summary elapsed time; valid configured parameters; finite/non-negative summary metrics with ordered percentiles; and every datum's finite/non-negative elapsed time, throughput, counts, and ordered percentiles. A graph-data array may be empty only if it is structurally present; normally the terminal datum makes it nonempty. Validation is repeated at export time as a defensive boundary even though snapshot creation has already validated the terminal frame.

| Condition | Required behavior |
| --- | --- |
| Displayed summary has no snapshot | Retain summary, start neither serializer, and show `Unable to export latency graph: completed test data is unavailable.` |
| Snapshot fails pre-generation validation | Retain summary/snapshot, start neither serializer or download, and show `Unable to export latency graph: completed test data is invalid.` |
| Both outputs succeed | Download SVG as `<Test_ID>-latency.svg` and JSON as `<Test_ID>-latency.json`; clear export error state. |
| SVG only fails | Retain snapshot, provide JSON, and identify the SVG document as failed. |
| JSON only fails | Retain snapshot, provide SVG, and identify the JSON document as failed. |
| Both outputs fail after attempts begin | Retain snapshot, provide no failed document, and show `Unable to export latency graph. Try again.` |

Failures include serializer exceptions and failure to construct/provide the corresponding browser download. The coordinator catches each format separately; an SVG failure cannot prevent the one JSON attempt, and vice versa. Object URLs are revoked after their download hand-off regardless of success. A retry repeats only the two generation attempts against the unchanged snapshot.

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties bridge human-readable specifications and machine-verifiable correctness guarantees.*

### Consolidation rationale

The testing prework identified pure reducer, queue, snapshot, validation, serialization, and export-coordination logic suitable for property-based testing. The following consolidation removes redundancy: packet replacement, latest-eligible attachment, and the no-eligible boundary form one selection property; event creation, pending retention, and one-time emission form one queue property; accepted/invalid/foreign frame guards and datum details form one active-observation property; first/duplicate/lifecycle snapshot behavior forms one snapshot property; summary and snapshot dismissal isolation form one collection-removal property. SVG standalone structure, plotted-series completeness, and visible summary metadata are intentionally one deterministic-serialization property. JSON completeness/order, filename construction, and partial-failure behavior remain separate because neither implies the other.

### Property 1: Active observation reduction is lossless and guarded

For all active-test frame sequences, reducing valid frames SHALL append exactly one datum containing each accepted frame's elapsed time and aggregate values, and selecting a stored datum SHALL expose that time and every metric; reducing invalid active frames SHALL preserve graph/display data and report the metric error, while foreign metric frames SHALL leave graph/display data and metric status unchanged.

**Validates: Requirements 1.1, 1.2, 1.3, 1.6**

### Property 2: Frame packet selection is newest eligible completion

For all time-ordered successful and failed request-completion sequences and frame timestamps, the test-run reducer SHALL replace its latest record per completion and attach exactly the completion with greatest timestamp not later than the frame timestamp, or omit the record when none is eligible.

**Validates: Requirements 2.1, 2.2, 2.3**

### Property 3: Packet view preserves complete received records

For all valid request-response records and subsequent active frames omitting a record, the packet view model SHALL expose every request, completion, ping, and exclusive response-or-failure field from the received record and SHALL retain it unchanged through every omitted-record frame.

**Validates: Requirements 2.4, 2.5**

### Property 4: Terminal summaries are whole-test and unique

For all valid test configurations and mixed request-outcome/ping sequences, completing a test-run reducer SHALL emit exactly one terminal frame with a matching-ID summary whose configuration, totals, throughput, and p50/p95/p99 values equal a reference calculation over all attempts from test start to completion.

**Validates: Requirements 3.1**

### Property 5: Session summaries are validated, idempotent, and retained

For all retained-summary states and completed-frame/lifecycle action sequences, accepting the first matching valid completion SHALL retain one summary for its ID; malformed/mismatched completions and duplicate matching completions SHALL not mutate it; and stream closure, active-test change, or in-app navigation without successful dismissal SHALL retain every existing summary unchanged.

**Validates: Requirements 3.2, 3.3, 3.4, 3.5**

### Property 6: Test-event queue is complete, retained, and exactly once

For all valid test configurations, request outcomes, event creation times, and frame-emission schedules, the reducer SHALL create exactly one start event, exactly one failure event per failed request, and exactly one completion event; each event SHALL remain pending until one later frame includes it and SHALL occur in emitted frames exactly once, with no events field when the pending delta is empty.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**

### Property 7: Timeline reduction is unique, stable, and guarded

For all event batches containing active, foreign, duplicate, valid-timestamp, invalid-timestamp, and invalid-content events, the Dashboard SHALL retain each first-received valid active event ID once; order RFC 3339 timestamps ascending with receipt-order ties; place non-RFC-3339 entries after valid timestamps in receipt order while preserving their original text; and leave the timeline unchanged with the required error status for foreign or invalid events.

**Validates: Requirements 4.7, 4.8, 4.9, 4.10, 4.11**

### Property 8: Final-summary export snapshots are stable value captures

For all valid graph histories and first valid completed frames, session reduction SHALL create exactly one deep-copied snapshot per summary ID with the terminal datum, graph data stably sorted by elapsed seconds, and matching final summary; subsequent terminal frames and non-dismissal lifecycle actions SHALL leave that snapshot byte-for-value unchanged.

**Validates: Requirements 5.1, 5.2, 5.3**

### Property 9: Export validation gates independent generation

For all snapshot shapes and controlled SVG/JSON generator outcomes, an invalid snapshot SHALL invoke neither generator and retain its state; a valid snapshot SHALL invoke each generator exactly once regardless of the other generator's outcome.

**Validates: Requirements 5.4, 5.10**

### Property 10: SVG export is deterministic, self-contained, and complete

For all valid export snapshots, SVG generation SHALL return the same standalone UTF-8 SVG bytes for equal input, contain no script/network/external-asset dependency, visibly include all required summary metadata and axis/legend labels, and represent one p50, p95, and p99 point for every snapshot datum.

**Validates: Requirements 5.5, 5.6, 5.7**

### Property 11: JSON export is an ordered lossless snapshot representation

For all valid export snapshots, UTF-8 JSON generation followed by parsing SHALL preserve the test ID, parameters, every final-summary field, and every required datum field, with graph-data array order exactly equal to the snapshot order.

**Validates: Requirements 5.8**

### Property 12: Export filenames are exact

For all valid Test_ID values, successful SVG and JSON exports SHALL use exactly `<Test_ID>-latency.svg` and `<Test_ID>-latency.json`, respectively.

**Validates: Requirements 5.11, 5.12**

### Property 13: Partial export failure preserves independent success

For all valid snapshots and exactly-one-failure SVG/JSON outcomes, export coordination SHALL retain the snapshot, provide the other successfully generated document, and report which document failed.

**Validates: Requirements 5.13**

### Property 14: Successful dismissal isolates summary and export removal

For all session maps containing distinct retained summaries and snapshots, successfully dismissing one summary SHALL remove exactly that summary, its snapshot, and its displayed export control while preserving all other summaries and snapshots.

**Validates: Requirements 3.6, 5.15**

## Error Handling

- The existing start handler continues to return HTTP 400 for malformed JSON and will validate port, duration, RPS, and worker count before creating a `Test_ID`. This protects the existing rate limiter and guarantees usable summary inputs.
- Worker transport errors, body-read failures, and timeouts become completed failed requests with measured ping time and a non-empty failure description. They replace the latest packet, increment failed counts, and queue one failure event; the test continues until its deadline.
- Dashboard frame validation is transactional. It validates required IDs, UTC RFC 3339 timestamps, finite numeric domains, count integrality, percentile ordering, packet exclusivity, final-summary ID match, and event content before the relevant reducer branch changes state. Invalid active metric/final/event input produces its mandated status within one second and cannot overwrite existing state.
- The load tester protects terminal transition with a one-time completion guard; the Dashboard protects session retention with one summary/snapshot entry per Test_ID. A terminal duplicate never overwrites a displayed final or its snapshot.
- A socket error/close preserves already displayed graph, packet, timeline, final-summary, and snapshot state. If no accepted terminal summary preceded active-stream closure, it shows `Metric stream ended before a final summary was received.` without fabricating a summary.
- Final-summary dismissal is an explicit reducer action. Failure to process it leaves the selected final/snapshot/control unchanged and shows `Unable to dismiss final summary. Try again.` Successful dismissal is the only action that releases that snapshot from Browser_Session memory.
- Export checks distinguish unavailable snapshot, invalid snapshot, one-format failure, and both-format failure exactly as described in the export-outcomes table. No invalid or unavailable export can create a partial document or invoke a serializer. Each failed generation/download is caught locally so the other independent generation is still attempted.

## Testing Strategy

Property-based testing applies to the pure Go `TestRun`/frame-queue logic and pure TypeScript reducers, snapshot validators, serializers, filename helpers, and export coordinator. It does not apply to HTTP/WebSocket I/O, Recharts layout, DOM accessibility layout, or browser download APIs themselves. The implementation will use Go 1.22 `testing/quick` and add the exact pinned dashboard development dependency `fast-check@4.6.0`; it will not implement a generator framework from scratch.

Each numbered property above is implemented by one property-based test with a minimum of 100 runs. Tests must use reproducible seeds on failure and include a comment in this exact form: `Feature: live-test-observability, Property N: <property text>`. Reference models should be simple, independent implementations: a latest-eligible completion selector, whole-test percentile calculator, FIFO event queue, stable timeline sorter, stable graph-data sorter, and snapshot-to-object serializer.

| Properties | Test target and generated domain | Core oracle |
| --- | --- | --- |
| 1–3 | Dashboard active reducer and packet view model; valid/invalid/foreign frames and records | Lossless data, no unauthorized mutation, packet stickiness |
| 4, 6 | Go `TestRun`; configurations, timestamped completions, outcomes, frame schedules | Independent aggregate, event-queue, and packet-selection reference models |
| 5, 7 | Dashboard session/timeline reducers; duplicate/malformed/foreign frames/events and lifecycle actions | Immutable map and stable-sort reference models |
| 8–9, 14 | Snapshot/session/export coordinator; graph histories, duplicate terminals, lifecycle and controlled outcomes | Deep-copy equality, generator call counts, collection isolation |
| 10–12 | SVG/JSON/filename pure helpers; summaries and graph data including zero/one/equal-time points | Parsed SVG/JSON structure, exact metadata/data/order, deterministic bytes/names |
| 13 | Coordinator with one injected serializer/download failure at a time | Delivered counterpart, retained snapshot, format-specific error |

Example, component, and integration tests complement these properties:

- **Live charts:** render empty/nonempty states; verify `Waiting for metric data.`, both chart structures/series/axis labels, first-datum transition and count, datum detail, and the no-datum interaction detail.
- **Packet and final summary:** render response/failure exclusivity; cover initial packet absence; assert one summary display, invalid-summary status, dismissal failure, retained summaries through stream/selection/navigation transitions, and early-close status.
- **Timeline:** cover the control, displayed timestamp/type/message fields, no-event message, pending-event suppression, and open-empty labeled fields.
- **Export UI:** cover no snapshot (exact unavailable message and zero calls), both serializers failing (exact retry message), browser `Blob` MIME types, isolated click/download behavior, and object-URL cleanup. Component tests use injected serializers/download sinks rather than real navigation.
- **Load tester and protocol:** use `httptest` plus a WebSocket client to verify start validation, successful and failed worker hand-off, JSON field names, one terminal frame, channel close, packet/event fields, and unchanged REST/WebSocket lifecycle. A short local successful run and representative failed-target run serve as smoke/integration tests; they are not property tests.
- **Build checks:** run `go test ./...` from `load-tester`, dashboard unit/component tests once (non-watch mode), `npm run lint`, and `npm run build` from `dashboard` when implementation begins.

This design changes only the planned producer/reducer/UI responsibilities and document contract. It preserves the existing REST/WebSocket lifecycle and creates no persistence or endpoint beyond Browser_Session memory.
