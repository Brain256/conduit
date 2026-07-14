export interface AgentMetrics {
  agent_id: string;
  throughput_rps: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
}

export interface BackendHealthEntry {
  backend: string;
  healthy: boolean;
}

export interface TimelineEvent {
  timestamp: string;
  message: string;
}

export interface MetricFrame {
  test_id: string;
  timestamp: string;
  elapsed_seconds: number;
  done: boolean;
  aggregate: {
    throughput_rps: number;
    p50_ms: number;
    p95_ms: number;
    p99_ms: number;
    error_count: number;
  };
  agents: AgentMetrics[];
  backend_health: BackendHealthEntry[];
  events: TimelineEvent[];
}

export interface TestConfig {
  target_rps: number;
  duration_seconds: number;
}