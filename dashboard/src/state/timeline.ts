import type { TestEvent, TestEventType } from '../types/metrics';

/** The status required when an event cannot be accepted for the active test. */
export const INVALID_TEST_EVENT_STATUS = 'Invalid test event received for the active test.';

export interface TimelineState {
  /** Entries sorted for display without losing their original timestamp text. */
  readonly entries: ReadonlyArray<Readonly<TestEvent>>;
  /** Test-scoped IDs already accepted into the timeline. */
  readonly receivedEventIds: ReadonlySet<string>;
  /** The most recent event-validation status, if any. */
  readonly eventStatus: string | null;
}

const EVENT_TYPES: ReadonlySet<TestEventType> = new Set([
  'test-started',
  'request-failed',
  'test-completed',
]);

const UTC_RFC_3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/;

/** Creates an empty active-test timeline. */
export function createTimelineState(): TimelineState {
  return {
    entries: [],
    receivedEventIds: new Set<string>(),
    eventStatus: null,
  };
}

/**
 * Returns whether text is representable as UTF-8 without replacement characters.
 * JavaScript strings can contain unpaired UTF-16 surrogates, which are not UTF-8 text.
 */
export function isUtf8Text(value: unknown): value is string {
  if (typeof value !== 'string') {
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

/** Returns whether a timestamp is an actual UTC RFC 3339 instant, not merely matching its shape. */
export function isUtcRfc3339Timestamp(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }

  const match = UTC_RFC_3339.exec(value);
  if (!match) {
    return false;
  }

  const [, year, month, day, hour, minute, second] = match;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const date = new Date(timestamp);
  return (
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() + 1 === Number(month) &&
    date.getUTCDate() === Number(day) &&
    date.getUTCHours() === Number(hour) &&
    date.getUTCMinutes() === Number(minute) &&
    date.getUTCSeconds() === Number(second)
  );
}

/** Validates the event fields that are required independently of timestamp validity. */
export function isValidTimelineEvent(value: unknown): value is TestEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isNonEmptyUtf8Text(value.event_id) &&
    isNonEmptyUtf8Text(value.test_id) &&
    typeof value.type === 'string' &&
    EVENT_TYPES.has(value.type as TestEventType) &&
    isNonEmptyUtf8Text(value.message) &&
    isUtf8Text(value.timestamp)
  );
}

/**
 * Reduces one received event. Invalid or foreign events leave entries and accepted IDs intact,
 * whereas an invalid timestamp is retained as timeline text and sorted after valid timestamps.
 */
export function reduceTimelineEvent(
  state: TimelineState,
  activeTestId: string,
  event: unknown,
): TimelineState {
  if (!isValidTimelineEvent(event) || event.test_id !== activeTestId) {
    return {
      ...state,
      eventStatus: INVALID_TEST_EVENT_STATUS,
    };
  }

  if (state.receivedEventIds.has(event.event_id)) {
    return state;
  }

  const acceptedEvent: Readonly<TestEvent> = {
    event_id: event.event_id,
    test_id: event.test_id,
    timestamp: event.timestamp,
    type: event.type,
    message: event.message,
  };
  const entries = stableTimelineOrder([...state.entries, acceptedEvent]);
  const receivedEventIds = new Set(state.receivedEventIds);
  receivedEventIds.add(acceptedEvent.event_id);

  return {
    entries,
    receivedEventIds,
    eventStatus: null,
  };
}

/** Reduces a frame's event batch in receipt order. */
export function reduceTimelineEvents(
  state: TimelineState,
  activeTestId: string,
  events: ReadonlyArray<unknown> | undefined,
): TimelineState {
  if (events === undefined) {
    return state;
  }

  return events.reduce<TimelineState>(
    (nextState, event) => reduceTimelineEvent(nextState, activeTestId, event),
    state,
  );
}

function stableTimelineOrder(
  entries: ReadonlyArray<Readonly<TestEvent>>,
): ReadonlyArray<Readonly<TestEvent>> {
  return entries
    .map((event, receiptIndex) => ({
      event,
      receiptIndex,
      hasValidTimestamp: isUtcRfc3339Timestamp(event.timestamp),
    }))
    .sort((left, right) => {
      if (left.hasValidTimestamp && right.hasValidTimestamp) {
        return (
          compareUtcRfc3339Timestamps(left.event.timestamp, right.event.timestamp) ||
          left.receiptIndex - right.receiptIndex
        );
      }
      if (left.hasValidTimestamp) {
        return -1;
      }
      if (right.hasValidTimestamp) {
        return 1;
      }
      return left.receiptIndex - right.receiptIndex;
    })
    .map(({ event }) => event);
}

function compareUtcRfc3339Timestamps(left: string, right: string): number {
  const leftDateTime = left.slice(0, 19);
  const rightDateTime = right.slice(0, 19);
  if (leftDateTime !== rightDateTime) {
    return leftDateTime < rightDateTime ? -1 : 1;
  }

  const leftFraction = normalizedFraction(left);
  const rightFraction = normalizedFraction(right);
  const length = Math.max(leftFraction.length, rightFraction.length);
  for (let index = 0; index < length; index += 1) {
    const leftDigit = leftFraction[index] ?? '0';
    const rightDigit = rightFraction[index] ?? '0';
    if (leftDigit !== rightDigit) {
      return leftDigit < rightDigit ? -1 : 1;
    }
  }

  return 0;
}

function normalizedFraction(timestamp: string): string {
  const fraction = timestamp.slice(19, -1);
  return fraction.startsWith('.') ? fraction.slice(1).replace(/0+$/, '') : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyUtf8Text(value: unknown): value is string {
  return isUtf8Text(value) && value.length > 0;
}
