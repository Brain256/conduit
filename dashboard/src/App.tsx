import { useRef, useState } from 'react';
import { Charts } from './components/Charts';
import { FinalSummary } from './components/FinalSummary';
import { KpiStrip } from './components/KpiStrip';
import { PacketView } from './components/PacketView';
import { RunHeader, type RunStatus } from './components/RunHeader';
import { TestConfig } from './components/TestConfig';
import { Timeline } from './components/Timeline';
import { useMetricsStream } from './hooks/useMetricsStream';
import { activeObservationReducer, createActiveObservationState, type ActiveObservationState } from './state/activeObservation';
import { createSessionFinalsState, sessionFinalsReducer, type SessionFinalsState } from './state/sessionFinals';
import { createTimelineState, reduceTimelineEvents, type TimelineState } from './state/timeline';
import type { ActiveRunConfig } from './types/metrics';
import './index.css';

const EARLY_STREAM_CLOSE_STATUS = 'Metric stream ended before a final summary was received.';
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const testIdOf = (frame: unknown): string | null => (record(frame) && typeof frame.test_id === 'string' ? frame.test_id : null);

function App() {
  const activeRef = useRef<ActiveObservationState>(createActiveObservationState(null));
  const finalsRef = useRef<SessionFinalsState>(createSessionFinalsState());
  const timelineRef = useRef<TimelineState>(createTimelineState());
  const [activeObservation, setActiveObservation] = useState(() => createActiveObservationState(null));
  const [sessionFinals, setSessionFinals] = useState(() => createSessionFinalsState());
  const [timeline, setTimeline] = useState(() => createTimelineState());
  const [activeTestId, setActiveTestId] = useState<string | null>(null);
  const [activeConfig, setActiveConfig] = useState<ActiveRunConfig | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [streamStatus, setStreamStatus] = useState<string | null>(null);

  const setActiveState = (next: ActiveObservationState) => { activeRef.current = next; setActiveObservation(next); };
  const setFinalsState = (next: SessionFinalsState) => { finalsRef.current = next; setSessionFinals(next); };
  const setTimelineState = (next: TimelineState) => { timelineRef.current = next; setTimeline(next); };

  const selectActiveTest = (testId: string, config: ActiveRunConfig) => {
    setActiveTestId(testId);
    setActiveConfig(config);
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

  const latest = activeObservation.graphData.at(-1);
  const completedActive = activeTestId !== null && sessionFinals.finals.has(activeTestId);
  const status: RunStatus = activeTestId === null ? 'idle'
    : completedActive ? 'completed'
      : streamStatus ? 'ended-early' : 'running';

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <RunHeader testId={activeTestId} config={activeConfig} latest={latest} status={status} />

      <main className="mx-auto grid max-w-[1600px] gap-4 p-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:p-6">
        <div className="space-y-4">
          <TestConfig onStart={selectActiveTest} />
          {activeTestId === null && (
            <p className="rounded-xl border border-dashed border-edge px-4 py-6 text-center text-xs text-faint">
              Start a run to make it the active live observation.
            </p>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          {activeTestId ? (
            <section className="space-y-4" aria-label="Active test observation">
              <KpiStrip latest={latest} config={activeConfig} />
              {(streamStatus || activeObservation.metricStatus) && (
                <div className="space-y-1 rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-xs text-warn">
                  {streamStatus && <p role="status">{streamStatus}</p>}
                  {activeObservation.metricStatus && <p role="status">{activeObservation.metricStatus}</p>}
                </div>
              )}
              <Charts graphData={activeObservation.graphData} durationSeconds={activeConfig?.duration_seconds ?? null} />
              <div className="grid gap-4 xl:grid-cols-2">
                <PacketView packet={activeObservation.latestPacket} status={activeObservation.packetStatus} />
                <Timeline
                  timeline={timeline}
                  pendingEventCount={0}
                  isOpen={timelineOpen}
                  onToggle={() => setTimelineOpen((open) => !open)}
                />
              </div>
            </section>
          ) : (
            <KpiStrip latest={undefined} config={null} />
          )}

          <FinalSummary finals={sessionFinals.finals} status={sessionFinals.finalSummaryStatus} onDismiss={dismiss} />
        </div>
      </main>
    </div>
  );
}

export default App;
