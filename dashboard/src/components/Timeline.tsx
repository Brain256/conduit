import { formatClockTime } from '../lib/format';
import type { TimelineState } from '../state/timeline';

interface Props {
  timeline: TimelineState;
  pendingEventCount: number;
  isOpen: boolean;
  onToggle: () => void;
}

const TYPE_STYLE: Record<string, string> = {
  'test-started': 'text-accent',
  'test-completed': 'text-ok',
  'request-failed': 'text-danger',
};

/** The control keeps event details hidden until requested without discarding active-test state. */
export function Timeline({ timeline, pendingEventCount, isOpen, onToggle }: Props) {
  const hasEntries = timeline.entries.length > 0;

  return (
    <section className="rounded-xl border border-edge bg-surface" aria-label="Test event timeline">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
          Events{hasEntries && <span className="ml-2 text-faint normal-case">{timeline.entries.length}</span>}
        </h2>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="rounded-lg border border-edge bg-elevated px-2.5 py-1 text-xs text-muted transition-colors hover:border-edge-strong hover:text-ink"
        >
          {isOpen ? 'Hide timeline' : 'Show timeline'}
        </button>
      </div>

      <div className="space-y-2 border-t border-edge px-4 py-3">
        {!hasEntries && pendingEventCount === 0 && <p role="status" className="text-xs text-muted">No test events received.</p>}
        {!hasEntries && pendingEventCount > 0 && <p role="status" className="text-xs text-muted">Pending test events are being processed.</p>}
        {timeline.eventStatus && <p role="status" className="text-xs text-warn">{timeline.eventStatus}</p>}

        {isOpen && (hasEntries ? (
          <ol className="max-h-64 space-y-1 overflow-auto">
            {timeline.entries.map((event) => (
              <li key={event.event_id} className="flex gap-3 rounded-lg bg-elevated px-3 py-2 text-xs">
                <span className="metric-number shrink-0 text-faint">{formatClockTime(event.timestamp)}</span>
                <span className={`shrink-0 font-medium ${TYPE_STYLE[event.type] ?? 'text-muted'}`}>{event.type}</span>
                <span className="truncate text-muted" title={event.message}>{event.message}</span>
              </li>
            ))}
          </ol>
        ) : (
          <dl className="grid gap-2 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-faint">Timestamp</dt>
              <dd aria-label="timestamp empty" className="text-muted">—</dd>
            </div>
            <div>
              <dt className="text-faint">Event type</dt>
              <dd aria-label="event type empty" className="text-muted">—</dd>
            </div>
            <div>
              <dt className="text-faint">Message</dt>
              <dd aria-label="message empty" className="text-muted">—</dd>
            </div>
          </dl>
        ))}
      </div>
    </section>
  );
}
