import { useEffect, useState, useRef } from 'react';
import type { MetricFrame } from '../types/metrics';

export function useMetricsStream(testId: string | null) {
  const [frames, setFrames] = useState<MetricFrame[]>([]);
  const [isDone, setIsDone] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!testId) return;

    setFrames([]);
    setIsDone(false);

    const ws = new WebSocket(`ws://localhost:8081/test/${testId}/stream`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const frame: MetricFrame = JSON.parse(event.data);
      setFrames(prev => [...prev, frame]);
      if (frame.done) setIsDone(true);
    };

    ws.onerror = (err) => console.error('WS error:', err);

    return () => {
      ws.close();
    };
  }, [testId]);

  return { frames, isDone };
}