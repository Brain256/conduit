import type { TimelineState } from '../state/timeline';

interface Props {
  timeline: TimelineState;
  pendingEventCount: number;
  isOpen: boolean;
  onToggle: () => void;
}

/** The control keeps event details hidden until requested without discarding active-test state. */
export function Timeline({ timeline, pendingEventCount, isOpen, onToggle }: Props) {
  const hasEntries = timeline.entries.length > 0;
  return <section className="space-y-3 rounded border p-4" aria-label="Test event timeline"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Test event timeline</h2><button type="button" onClick={onToggle} aria-expanded={isOpen}>{isOpen ? 'Hide timeline' : 'Show timeline'}</button></div>
    {!hasEntries && pendingEventCount === 0 && <p role="status">No test events received.</p>}
    {!hasEntries && pendingEventCount > 0 && <p role="status">Pending test events are being processed.</p>}
    {timeline.eventStatus && <p role="status">{timeline.eventStatus}</p>}
    {isOpen && (hasEntries ? <ol className="space-y-2">{timeline.entries.map((event) => <li key={event.event_id} className="rounded bg-slate-50 p-2"><p><strong>Timestamp:</strong> {event.timestamp}</p><p><strong>Event type:</strong> {event.type}</p><p><strong>Message:</strong> {event.message}</p></li>)}</ol> : <dl className="grid grid-cols-1 gap-1"><dt>Timestamp</dt><dd aria-label="timestamp empty">—</dd><dt>Event type</dt><dd aria-label="event type empty">—</dd><dt>Message</dt><dd aria-label="message empty">—</dd></dl>)}
  </section>;
}
