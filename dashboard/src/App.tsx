import { useRef, useState } from 'react';
import { Charts } from './components/Charts';
import { FinalSummary } from './components/FinalSummary';
import { PacketView } from './components/PacketView';
import { TestConfig } from './components/TestConfig';
import { Timeline } from './components/Timeline';
import { useMetricsStream } from './hooks/useMetricsStream';
import { activeObservationReducer, createActiveObservationState, type ActiveObservationState } from './state/activeObservation';
import { createSessionFinalsState, sessionFinalsReducer, type SessionFinalsState } from './state/sessionFinals';
import { createTimelineState, reduceTimelineEvents, type TimelineState } from './state/timeline';
import './index.css';

const EARLY_STREAM_CLOSE_STATUS = 'Metric stream ended before a final summary was received.';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const testIdOf = (frame: unknown): string | null => record(frame) && typeof frame.test_id === 'string' ? frame.test_id : null;

function App() {
  const activeRef = useRef<ActiveObservationState>(createActiveObservationState(null));
  const finalsRef = useRef<SessionFinalsState>(createSessionFinalsState());
  const timelineRef = useRef<TimelineState>(createTimelineState());
  const [activeObservation, setActiveObservation] = useState(() => createActiveObservationState(null));
  const [sessionFinals, setSessionFinals] = useState(() => createSessionFinalsState());
  const [timeline, setTimeline] = useState(() => createTimelineState());
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);

  const setActiveState = (next: ActiveObservationState) => { activeRef.current = next; setActiveObservation(next); };
  const setFinalsState = (next: SessionFinalsState) => { finalsRef.current = next; setSessionFinals(next); };
  const setTimelineState = (next: TimelineState) => { timelineRef.current = next; setTimeline(next); };

  const selectActiveTest = (testId: string) => {
    setActiveTestId(testId);
    setStreamStatus(null); setTimelineOpen(false);
    setActiveState(activeObservationReducer(activeRef.current, { type: 'active-test-changed', testId }));
    setTimelineState(createTimelineState());
    setFinalsState(sessionFinalsReducer(finalsRef.current, { type: 'active-test-changed' }));
  };

  const onFrame = (frame: unknown) => {
    const graphHistoryBeforeTerminal = activeRef.current.graphData;
    setActiveState(activeObservationReducer(activeRef.current, { type: 'metric-frame-received', frame }));
    if (record(frame) && Array.isArray(frame.events) && activeRef.current.activeTestId) {
      setTimelineState(reduceTimelineEvents(timelineRef.current, activeRef.current.activeTestId, frame.events));
    }
    const priorFinals = finalsRef.current;
    const nextFinals = sessionFinalsReducer(priorFinals, {
      type: 'terminal-frame-received', activeTestId: activeRef.current.activeTestId, graphHistoryBeforeTerminal, frame,
    });
    setFinalsState(nextFinals);
    const frameTestId = testIdOf(frame);
    return { acceptedTerminalSummary: frameTestId !== null && !priorFinals.finals.has(frameTestId) && nextFinals.finals.has(frameTestId) };
  };

  const onClose = (testId: string, followedAcceptedTerminalSummary: boolean) => {
    setFinalsState(sessionFinalsReducer(finalsRef.current, { type: 'metric-stream-closed' }));
    if (activeRef.current.activeTestId === testId && !followedAcceptedTerminalSummary) setStreamStatus(EARLY_STREAM_CLOSE_STATUS);
  };
  useMetricsStream(activeTestId, { onFrame, onClose });

  const dismiss = (testId: string) => setFinalsState(sessionFinalsReducer(finalsRef.current, { type: 'dismiss-final-summary', testId }));
  return <main className="mx-auto max-w-6xl space-y-6 p-6"><header><h1 className="text-2xl font-bold">Conduit live-test observability</h1><p>Start a test to make it the active live observation.</p></header>
    <section className="rounded border p-4"><h2 className="mb-3 text-lg font-semibold">Start or switch active test</h2><TestConfig onStart={selectActiveTest} /></section>
    {activeTestId ? <section className="space-y-4" aria-label="Active test observation"><p><strong>Active test:</strong> {activeTestId}</p>{streamStatus && <p role="status">{streamStatus}</p>}{activeObservation.metricStatus && <p role="status">{activeObservation.metricStatus}</p>}<Charts graphData={activeObservation.graphData} /><PacketView packet={activeObservation.latestPacket} status={activeObservation.packetStatus} /><Timeline timeline={timeline} pendingEventCount={0} isOpen={timelineOpen} onToggle={() => setTimelineOpen((open) => !open)} /></section> : <p>Select a test by starting one above.</p>}
    <FinalSummary finals={sessionFinals.finals} status={sessionFinals.finalSummaryStatus} onDismiss={dismiss} />
  </main>;
}

export default App;
