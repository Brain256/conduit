import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { GraphDatum } from '../types/metrics';

interface Props { graphData: ReadonlyArray<GraphDatum>; }
type HoverDetail = { kind: 'datum'; datum: GraphDatum } | { kind: 'empty'; elapsed: string } | null;
type ChartPointer = { activeLabel?: unknown; activePayload?: Array<{ payload?: unknown }> };

function isGraphDatum(value: unknown): value is GraphDatum {
  return typeof value === 'object' && value !== null && 'elapsed_seconds' in value
    && typeof (value as GraphDatum).elapsed_seconds === 'number';
}
function detailFor(pointer: unknown): HoverDetail {
  const { activeLabel, activePayload } = pointer as ChartPointer;
  const datum = activePayload?.map((entry) => entry.payload).find(isGraphDatum);
  if (datum) return { kind: 'datum', datum };
  return activeLabel === undefined ? null : { kind: 'empty', elapsed: String(activeLabel) };
}
function DatumDetail({ detail }: { detail: HoverDetail }) {
  if (!detail) return <p className="text-sm text-slate-600">Point at a graph position to inspect its metrics.</p>;
  if (detail.kind === 'empty') return <p role="status">No metric was recorded at elapsed test time {detail.elapsed} seconds.</p>;
  const datum = detail.datum;
  return <dl className="grid grid-cols-2 gap-x-4 text-sm" aria-live="polite">
    <dt>Elapsed test time</dt><dd>{datum.elapsed_seconds} s</dd><dt>Throughput</dt><dd>{datum.throughput_rps} rps</dd>
    <dt>Completed requests</dt><dd>{datum.completed_count}</dd><dt>Failed requests</dt><dd>{datum.failed_count}</dd>
    <dt>p50 ping time</dt><dd>{datum.p50_ms} ms</dd><dt>p95 ping time</dt><dd>{datum.p95_ms} ms</dd><dt>p99 ping time</dt><dd>{datum.p99_ms} ms</dd>
  </dl>;
}
export function Charts({ graphData }: Props) {
  const [detail, setDetail] = useState<HoverDetail>(null);
  if (graphData.length === 0) return <section aria-live="polite"><h2 className="text-lg font-semibold">Live performance</h2><p>Waiting for metric data.</p></section>;
  const pointer = (event: unknown) => setDetail(detailFor(event));
  const chartProps = { data: graphData, onMouseMove: pointer, onMouseLeave: () => setDetail(null) };
  return <section className="space-y-4" aria-label="Live performance graphs"><p>Graph data points: {graphData.length}</p>
    <section className="rounded border p-4"><h2 className="mb-2 text-lg font-semibold">Latency</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart {...chartProps}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="elapsed_seconds" label={{ value: 'Elapsed test time (seconds)', position: 'insideBottom', offset: -5 }} /><YAxis label={{ value: 'Ping time (ms)', angle: -90, position: 'insideLeft' }} /><Tooltip content={() => null} /><Line type="monotone" dataKey="p50_ms" name="p50 ping time" stroke="#22c55e" dot /><Line type="monotone" dataKey="p95_ms" name="p95 ping time" stroke="#eab308" dot /><Line type="monotone" dataKey="p99_ms" name="p99 ping time" stroke="#ef4444" dot /></LineChart></ResponsiveContainer></div></section>
    <section className="rounded border p-4"><h2 className="mb-2 text-lg font-semibold">Throughput</h2><div className="h-72"><ResponsiveContainer width="100%" height="100%"><LineChart {...chartProps}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="elapsed_seconds" label={{ value: 'Elapsed test time (seconds)', position: 'insideBottom', offset: -5 }} /><YAxis label={{ value: 'Achieved throughput (requests/second)', angle: -90, position: 'insideLeft' }} /><Tooltip content={() => null} /><Line type="monotone" dataKey="throughput_rps" name="Achieved throughput" stroke="#2563eb" dot /></LineChart></ResponsiveContainer></div></section>
    <section className="rounded border p-4" aria-label="Graph interaction details"><h2 className="text-lg font-semibold">Metric detail</h2><DatumDetail detail={detail} /></section>
  </section>;
}
