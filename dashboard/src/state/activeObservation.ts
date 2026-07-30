import type {
  AggregateMetrics,
  GraphDatum,
  RequestPayload,
  RequestResponseRecord,
  ResponsePayload,
} from '../types/metrics';

export const INVALID_METRIC_DATA_STATUS = 'Invalid metric data received for the active test.';
export const NO_COMPLETED_PACKET_STATUS = 'No completed request-response packet received.';

export interface ActiveObservationState {
  activeTestId: string | null;
  graphData: ReadonlyArray<GraphDatum>;
  latestPacket: RequestResponseRecord | null;
  metricStatus: typeof INVALID_METRIC_DATA_STATUS | null;
  packetStatus: typeof NO_COMPLETED_PACKET_STATUS | null;
}

export type ActiveFrameValidation =
  | { kind: 'foreign' }
  | { kind: 'invalid' }
  | {
      kind: 'valid';
      graphDatum: GraphDatum;
      requestResponseRecord: RequestResponseRecord | undefined;
    };

export type ActiveObservationAction =
  | { type: 'active-test-changed'; testId: string | null }
  | { type: 'metric-frame-received'; frame: unknown };

type UnknownRecord = Record<string, unknown>;

const UTC_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isUtcRfc3339(value: unknown): value is string {
  if (typeof value !== 'string') return false;

  const match = UTC_RFC3339.exec(value);
  if (!match) return false;

  const date = new Date(value);
  return Number.isFinite(date.getTime())
    && date.getUTCFullYear() === Number(match[1])
    && date.getUTCMonth() + 1 === Number(match[2])
    && date.getUTCDate() === Number(match[3])
    && date.getUTCHours() === Number(match[4])
    && date.getUTCMinutes() === Number(match[5])
    && date.getUTCSeconds() === Number(match[6]);
}

function isStringArrayRecord(value: unknown): value is Record<string, string[]> {
  return isRecord(value) && Object.values(value).every(
    (headerValues) => Array.isArray(headerValues) && headerValues.every((header) => typeof header === 'string'),
  );
}

function cloneHeaders(headers: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(headers).map(([name, values]) => [name, [...values]]));
}

function readRequestPayload(value: unknown): RequestPayload | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.method)
    || !isNonEmptyString(value.target_url)
    || !isStringArrayRecord(value.headers)
    || typeof value.body !== 'string') {
    return null;
  }

  return {
    method: value.method,
    target_url: value.target_url,
    headers: cloneHeaders(value.headers),
    body: value.body,
  };
}

function readResponsePayload(value: unknown): ResponsePayload | null {
  if (!isRecord(value)
    || !isNonNegativeCount(value.status_code)
    || !isStringArrayRecord(value.headers)
    || typeof value.body !== 'string') {
    return null;
  }

  return {
    status_code: value.status_code,
    headers: cloneHeaders(value.headers),
    body: value.body,
  };
}

function readRequestResponseRecord(value: unknown): RequestResponseRecord | null {
  if (!isRecord(value)
    || !isUtcRfc3339(value.completed_at)
    || !isFiniteNonNegative(value.ping_ms)) {
    return null;
  }

  const request = readRequestPayload(value.request);
  const hasResponse = hasOwn(value, 'response');
  const hasFailure = hasOwn(value, 'failure');
  if (!request || hasResponse === hasFailure) return null;

  if (hasResponse) {
    const response = readResponsePayload(value.response);
    return response
      ? { completed_at: value.completed_at, ping_ms: value.ping_ms, request, response }
      : null;
  }

  return isNonEmptyString(value.failure)
    ? { completed_at: value.completed_at, ping_ms: value.ping_ms, request, failure: value.failure }
    : null;
}

function readAggregateMetrics(value: unknown): AggregateMetrics | null {
  if (!isRecord(value)
    || !isFiniteNonNegative(value.throughput_rps)
    || !isNonNegativeCount(value.completed_count)
    || !isNonNegativeCount(value.failed_count)
    || !isFiniteNonNegative(value.p50_ms)
    || !isFiniteNonNegative(value.p95_ms)
    || !isFiniteNonNegative(value.p99_ms)
    || value.p50_ms > value.p95_ms
    || value.p95_ms > value.p99_ms) {
    return null;
  }

  return {
    throughput_rps: value.throughput_rps,
    completed_count: value.completed_count,
    failed_count: value.failed_count,
    p50_ms: value.p50_ms,
    p95_ms: value.p95_ms,
    p99_ms: value.p99_ms,
  };
}

/**
 * Validates only data owned by active observation. A mismatched or absent test ID
 * is deliberately foreign, so it cannot alter the current observation's status.
 */
export function validateActiveMetricFrame(
  frame: unknown,
  activeTestId: string | null,
): ActiveFrameValidation {
  if (!isNonEmptyString(activeTestId) || !isRecord(frame) || frame.test_id !== activeTestId) {
    return { kind: 'foreign' };
  }

  const aggregate = readAggregateMetrics(frame.aggregate);
  if (!isUtcRfc3339(frame.timestamp)
    || !isFiniteNonNegative(frame.elapsed_seconds)
    || !aggregate) {
    return { kind: 'invalid' };
  }

  const requestResponseRecord = hasOwn(frame, 'request_response_record')
    ? readRequestResponseRecord(frame.request_response_record)
    : undefined;
  if (requestResponseRecord === null) return { kind: 'invalid' };

  return {
    kind: 'valid',
    graphDatum: { elapsed_seconds: frame.elapsed_seconds, ...aggregate },
    requestResponseRecord,
  };
}

export function createActiveObservationState(activeTestId: string | null): ActiveObservationState {
  return {
    activeTestId: isNonEmptyString(activeTestId) ? activeTestId : null,
    graphData: [],
    latestPacket: null,
    metricStatus: null,
    packetStatus: null,
  };
}

/** Reduces one stream frame without allowing invalid input to partially mutate state. */
export function reduceActiveObservationFrame(
  state: ActiveObservationState,
  frame: unknown,
): ActiveObservationState {
  const validation = validateActiveMetricFrame(frame, state.activeTestId);
  if (validation.kind === 'foreign') return state;
  if (validation.kind === 'invalid') {
    return { ...state, metricStatus: INVALID_METRIC_DATA_STATUS };
  }

  const graphData = [...state.graphData, { ...validation.graphDatum }];
  if (validation.requestResponseRecord) {
    return {
      ...state,
      graphData,
      latestPacket: validation.requestResponseRecord,
      metricStatus: null,
      packetStatus: null,
    };
  }

  return {
    ...state,
    graphData,
    metricStatus: null,
    packetStatus: state.latestPacket ? null : NO_COMPLETED_PACKET_STATUS,
  };
}

export function activeObservationReducer(
  state: ActiveObservationState,
  action: ActiveObservationAction,
): ActiveObservationState {
  switch (action.type) {
    case 'active-test-changed':
      return createActiveObservationState(action.testId);
    case 'metric-frame-received':
      return reduceActiveObservationFrame(state, action.frame);
  }
}
