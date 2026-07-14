import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { MetricFrame } from '../types/metrics';

interface Props {
  frames: MetricFrame[];
}

export function Charts({ frames }: Props) {
  const data = frames.map(f => ({
    time: f.elapsed_seconds,
    p50: f.aggregate.p50_ms,
    p95: f.aggregate.p95_ms,
    p99: f.aggregate.p99_ms,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="time" label={{ value: 'Elapsed (s)', position: 'insideBottom' }} />
        <YAxis label={{ value: 'Latency (ms)', angle: -90 }} />
        <Tooltip />
        <Line type="monotone" dataKey="p50" stroke="#22c55e" dot={false} />
        <Line type="monotone" dataKey="p95" stroke="#eab308" dot={false} />
        <Line type="monotone" dataKey="p99" stroke="#ef4444" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}