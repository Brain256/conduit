import { useEffect, useRef } from 'react';

export interface MetricsStreamCallbacks {
  /** Reduces one parsed stream value and reports whether it accepted a terminal summary. */
  onFrame: (frame: unknown) => { acceptedTerminalSummary: boolean };
  /** Runs only for a stream close that was not caused by changing the active test. */
  onClose: (testId: string, followedAcceptedTerminalSummary: boolean) => void;
}

/**
 * Owns only the active stream socket. App-shell reducers own all stream data and
 * browser-session retention, which keeps them independent of this hook's lifecycle.
 */
export function useMetricsStream(testId: string | null, callbacks: MetricsStreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  const wsRef = useRef<WebSocket | null>(null);
  useEffect(() => { callbacksRef.current = callbacks; }, [callbacks]);

  useEffect(() => {
    if (!testId) return;

    let cleanedUp = false;
    let acceptedTerminalSummary = false;
    const socket = new WebSocket(`ws://localhost:8081/test/${testId}/stream`);
    wsRef.current = socket;

    socket.onmessage = (event) => {
      let frame: unknown;
      try { frame = JSON.parse(String(event.data)); } catch { frame = null; }
      const result = callbacksRef.current.onFrame(frame);
      acceptedTerminalSummary ||= result.acceptedTerminalSummary;
    };
    socket.onclose = () => {
      if (!cleanedUp) callbacksRef.current.onClose(testId, acceptedTerminalSummary);
    };

    return () => {
      cleanedUp = true;
      if (wsRef.current === socket) wsRef.current = null;
      socket.close();
    };
  }, [testId]);
}
