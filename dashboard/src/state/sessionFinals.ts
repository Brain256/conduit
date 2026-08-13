import { validateActiveMetricFrame } from './activeObservation';
import type {
  FinalSummary,
  FinalSummaryExportSnapshot,
  GraphDatum,
  LoadMode,
  SessionFinal,
  TestParameters,
} from '../types/metrics';

export const INVALID_FINAL_SUMMARY_STATUS = 'Invalid final summary received for the active test.';
export const UNABLE_TO_DISMISS_FINAL_SUMMARY_STATUS = 'Unable to dismiss final summary. Try again.';

export interface SessionFinalsState {
  /** Completed-test data retained for the lifetime of the dashboard browser session. */
  readonly finals: ReadonlyMap<string, SessionFinal>;
  /** The last final-summary operation error, if any. */
  readonly finalSummaryStatus: string | null;
}

export type SessionFinalsAction =
  | {
      type: 'terminal-frame-received';
      activeTestId: string | null;
      /** Graph data recorded before this terminal frame was reduced. */
      graphHistoryBeforeTerminal: ReadonlyArray<unknown>;
      frame: unknown;
    }
  | { type: 'dismiss-final-summary'; testId: string }
  | { type: 'metric-stream-closed' }
  | { type: 'active-test-changed' }
  | { type: 'in-app-navigation' };

type TerminalFrameValidation =
  | { kind: 'foreign-or-non-terminal' }
  | { kind: 'invalid' }
  | { kind: 'duplicate' }
  | { kind: 'valid'; summary: FinalSummary; terminalDatum: GraphDatum };

/** Creates browser-session final-summary state with no retained completed tests. */
export function createSessionFinalsState(): SessionFinalsState {
  return { finals: new Map<string, SessionFinal>(), finalSummaryStatus: null };
}

/**
 * Accepts the first valid terminal frame for the active test. `graphHistoryBeforeTerminal`
 * intentionally excludes the terminal frame, which this reducer appends exactly once.
 */
export function reduceSessionFinalTerminalFrame(
  state: SessionFinalsState,
  activeTestId: string | null,
  graphHistoryBeforeTerminal: ReadonlyArray<unknown>,
  frame: unknown,
): SessionFinalsState {
  const validation = validateTerminalFrame(state, activeTestId, graphHistoryBeforeTerminal, frame);

  if (validation.kind === 'foreign-or-non-terminal' || validation.kind === 'duplicate') {
    return state;
  }
  if (validation.kind === 'invalid') {
    return { ...state, finalSummaryStatus: INVALID_FINAL_SUMMARY_STATUS };
  }

  const summary = copyAndFreezeSummary(validation.summary);
  const exportSnapshot = createFrozenExportSnapshot(
    summary,
    graphHistoryBeforeTerminal as ReadonlyArray<GraphDatum>,
    validation.terminalDatum,
  );
  const sessionFinal: SessionFinal = Object.freeze({
    summary,
    export_snapshot: exportSnapshot,
  });
  const finals = new Map(state.finals);
  finals.set(summary.test_id, sessionFinal);

  return { finals, finalSummaryStatus: null };
}

/** Removes one retained final and its paired snapshot, or reports a failed dismissal. */
export function dismissSessionFinal(
  state: SessionFinalsState,
  testId: string,
): SessionFinalsState {
  if (!isNonEmptyUtf8Text(testId) || !state.finals.has(testId)) {
    return { ...state, finalSummaryStatus: UNABLE_TO_DISMISS_FINAL_SUMMARY_STATUS };
  }

  const finals = new Map(state.finals);
  finals.delete(testId);
  return { finals, finalSummaryStatus: null };
}

/**
 * Browser-session entries deliberately survive stream closure, active-test changes, and
 * in-application navigation. Only dismissal is allowed to remove a retained entry.
 */
export function sessionFinalsReducer(
  state: SessionFinalsState,
  action: SessionFinalsAction,
): SessionFinalsState {
  switch (action.type) {
    case 'terminal-frame-received':
      return reduceSessionFinalTerminalFrame(
        state,
        action.activeTestId,
        action.graphHistoryBeforeTerminal,
        action.frame,
      );
    case 'dismiss-final-summary':
      return dismissSessionFinal(state, action.testId);
    case 'metric-stream-closed':
    case 'active-test-changed':
    case 'in-app-navigation':
      return state;
  }
}

function validateTerminalFrame(
  state: SessionFinalsState,
  activeTestId: string | null,
  graphHistoryBeforeTerminal: ReadonlyArray<unknown>,
  frame: unknown,
): TerminalFrameValidation {
  if (!isRecord(frame) || !isNonEmptyUtf8Text(activeTestId) || frame.test_id !== activeTestId) {
    return { kind: 'foreign-or-non-terminal' };
  }

  if (frame.done !== true) {
    return { kind: 'foreign-or-non-terminal' };
  }

  if (!isRecord(frame.final_summary) || frame.final_summary.test_id !== frame.test_id) {
    return { kind: 'invalid' };
  }

  if (state.finals.has(frame.test_id)) {
    return { kind: 'duplicate' };
  }

  const activeFrame = validateActiveMetricFrame(frame, activeTestId);
  const summary = readFinalSummary(frame.final_summary);
  if (activeFrame.kind !== 'valid' || !summary || !isGraphHistory(graphHistoryBeforeTerminal)) {
    return { kind: 'invalid' };
  }

  return {
    kind: 'valid',
    summary,
    terminalDatum: activeFrame.graphDatum,
  };
}

function readFinalSummary(value: unknown): FinalSummary | null {
  if (!isRecord(value)
    || !isNonEmptyUtf8Text(value.test_id)
    || !isValidTestParameters(value.parameters)
    || !isPositiveFinite(value.elapsed_seconds)
    || !isNonNegativeCount(value.completed_count)
    || !isNonNegativeCount(value.failed_count)
    || !isFiniteNonNegative(value.achieved_throughput_rps)
    || !isFiniteNonNegative(value.p50_ms)
    || !isFiniteNonNegative(value.p95_ms)
    || !isFiniteNonNegative(value.p99_ms)
    || value.p50_ms > value.p95_ms
    || value.p95_ms > value.p99_ms) {
    return null;
  }

  return {
    test_id: value.test_id,
    parameters: {
      port: value.parameters.port,
      duration_seconds: value.parameters.duration_seconds,
      target_rps: value.parameters.target_rps,
      workers: value.parameters.workers,
      load_mode: value.parameters.load_mode,
    },
    elapsed_seconds: value.elapsed_seconds,
    completed_count: value.completed_count,
    failed_count: value.failed_count,
    achieved_throughput_rps: value.achieved_throughput_rps,
    p50_ms: value.p50_ms,
    p95_ms: value.p95_ms,
    p99_ms: value.p99_ms,
  };
}

function isGraphHistory(value: ReadonlyArray<unknown>): value is ReadonlyArray<GraphDatum> {
  return value.every(isGraphDatum);
}

function isGraphDatum(value: unknown): value is GraphDatum {
  if (!isRecord(value)
    || !isFiniteNonNegative(value.elapsed_seconds)
    || !isFiniteNonNegative(value.throughput_rps)
    || !isNonNegativeCount(value.completed_count)
    || !isNonNegativeCount(value.failed_count)
    || !isFiniteNonNegative(value.p50_ms)
    || !isFiniteNonNegative(value.p95_ms)
    || !isFiniteNonNegative(value.p99_ms)
    || value.p50_ms > value.p95_ms
    || value.p95_ms > value.p99_ms) {
    return false;
  }

  return true;
}

function isValidTestParameters(value: unknown): value is TestParameters {
  return isRecord(value)
    && isPort(value.port)
    && isPositiveFinite(value.duration_seconds)
    && isValidLoadMode(value.load_mode)
    && isValidTargetRate(value.load_mode, value.target_rps)
    && isPositiveCount(value.workers);
}

function isValidLoadMode(value: unknown): value is LoadMode {
  return value === 'closed' || value === 'open';
}

/** Open mode is unpaced, so a target rate is absent there rather than positive. */
function isValidTargetRate(loadMode: unknown, targetRPS: unknown): boolean {
  return loadMode === 'open' ? targetRPS === 0 : isPositiveFinite(targetRPS);
}

function copyAndFreezeSummary(summary: FinalSummary): Readonly<FinalSummary> {
  return Object.freeze({
    test_id: summary.test_id,
    parameters: Object.freeze({ ...summary.parameters }),
    elapsed_seconds: summary.elapsed_seconds,
    completed_count: summary.completed_count,
    failed_count: summary.failed_count,
    achieved_throughput_rps: summary.achieved_throughput_rps,
    p50_ms: summary.p50_ms,
    p95_ms: summary.p95_ms,
    p99_ms: summary.p99_ms,
  });
}

function createFrozenExportSnapshot(
  summary: Readonly<FinalSummary>,
  graphHistoryBeforeTerminal: ReadonlyArray<GraphDatum>,
  terminalDatum: GraphDatum,
): FinalSummaryExportSnapshot {
  const graphData = stableElapsedTimeOrder([
    ...graphHistoryBeforeTerminal.map(copyGraphDatum),
    copyGraphDatum(terminalDatum),
  ]).map((datum) => Object.freeze(datum));

  return Object.freeze({
    test_id: summary.test_id,
    final_summary: summary,
    graph_data: Object.freeze(graphData),
  });
}

function stableElapsedTimeOrder(graphData: GraphDatum[]): GraphDatum[] {
  return graphData
    .map((datum, receiptIndex) => ({ datum, receiptIndex }))
    .sort((left, right) => left.datum.elapsed_seconds - right.datum.elapsed_seconds || left.receiptIndex - right.receiptIndex)
    .map(({ datum }) => datum);
}

function copyGraphDatum(datum: GraphDatum): GraphDatum {
  return {
    elapsed_seconds: datum.elapsed_seconds,
    throughput_rps: datum.throughput_rps,
    completed_count: datum.completed_count,
    failed_count: datum.failed_count,
    p50_ms: datum.p50_ms,
    p95_ms: datum.p95_ms,
    p99_ms: datum.p99_ms,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyUtf8Text(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const nextCodeUnit = value.charCodeAt(index + 1);
      if (nextCodeUnit < 0xdc00 || nextCodeUnit > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isNonNegativeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isPort(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 1
    && value <= 65535;
}
