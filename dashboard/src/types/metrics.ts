export interface AgentMetrics { agent_id: string; throughput_rps: number; p50_ms: number; p95_ms: number; p99_ms: number; }
export interface BackendHealthEntry { backend: string; healthy: boolean; }

/** The immutable configuration used to execute a test. */
export interface TestParameters { port: number; duration_seconds: number; target_rps: number; workers: number; }

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

export interface TestConfig { target_rps: number; duration_seconds: number; }
