export interface AgentMetrics { agent_id: string; throughput_rps: number; p50_ms: number; p95_ms: number; p99_ms: number; }
export interface BackendHealthEntry { backend: string; healthy: boolean; }

/**
 * How workers pace requests. `closed` holds `target_rps` as a ceiling and
 * answers "did the target keep up"; `open` removes the pacer so achieved
 * throughput reveals the maximum.
 */
export type LoadMode = 'closed' | 'open';

/** The immutable configuration used to execute a test. `target_rps` is meaningful only in `closed` mode, and is 0 in `open` mode. */
export interface TestParameters { port: number; duration_seconds: number; target_rps: number; workers: number; load_mode: LoadMode; }

/**
 * The configuration the operator submitted for the active run, known locally as
 * soon as the run starts. The authoritative copy still arrives in the final
 * summary; this exists so the live view can label and scale itself before then.
 */
export type ActiveRunConfig = Readonly<TestParameters>;

/** Per-frame aggregate measurements. Durations are seconds; ping values are milliseconds. */
export interface AggregateMetrics { throughput_rps: number; completed_count: number; failed_count: number; p50_ms: number; p95_ms: number; p99_ms: number; }

/** A value copy of one frame's graphable aggregate measurements. */
export type GraphDatum = { elapsed_seconds: number } & AggregateMetrics;
export interface RequestPayload { method: string; target_url: string; headers: Record<string, string[]>; body: string; }
export interface ResponsePayload { status_code: number; headers: Record<string, string[]>; body: string; }
interface RequestResponseRecordBase { completed_at: string; ping_ms: number; request: RequestPayload; }

/** A completed request has exactly one response-or-failure outcome. */
export type RequestResponseRecord = RequestResponseRecordBase & (
  | { response: ResponsePayload; failure?: never }
  | { response?: never; failure: string }
);

export type TestEventType = 'test-started' | 'request-failed' | 'test-completed';
export interface TestEvent { event_id: string; test_id: string; timestamp: string; type: TestEventType; message: string; }

export interface FinalSummary {
  test_id: string; parameters: TestParameters; elapsed_seconds: number; completed_count: number;
  failed_count: number; achieved_throughput_rps: number; p50_ms: number; p95_ms: number; p99_ms: number;
}

/** The complete message carried by the metric WebSocket stream. */
export interface MetricFrame {
  test_id: string; timestamp: string; elapsed_seconds: number; done: boolean; aggregate: AggregateMetrics;
  request_response_record?: RequestResponseRecord; events?: TestEvent[]; final_summary?: FinalSummary;
  agents: AgentMetrics[]; backend_health: BackendHealthEntry[];
}

/** A deep-copied, elapsed-time-ordered capture of a completed test. */
export type FinalSummaryExportSnapshot = Readonly<{
  test_id: string; final_summary: Readonly<FinalSummary>; graph_data: ReadonlyArray<Readonly<GraphDatum>>;
}>;

/** Browser-session state retained for a completed test and its export capture. */
export type SessionFinal = Readonly<{
  summary: Readonly<FinalSummary>; export_snapshot: FinalSummaryExportSnapshot;
}>;

export interface TestConfig { target_rps: number; duration_seconds: number; load_mode: LoadMode; }
