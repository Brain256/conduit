import { useState } from 'react';
import {
  Area, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { niceMax, timeDomainMax, withInstantRate, type ChartDatum } from '../lib/chartScale';
import { formatCompact, formatMs, formatRps, formatSeconds, formatSecondsTick } from '../lib/format';
import type { GraphDatum } from '../types/metrics';

interface Props {
  graphData: ReadonlyArray<GraphDatum>;
  durationSeconds: number | null;
}

type HoverDetail = { kind: 'datum'; datum: GraphDatum } | { kind: 'empty'; elapsed: string } | null;
type ChartPointer = { activeLabel?: unknown; activePayload?: Array<{ payload?: unknown }> };

const SERIES = {
  p50: { color: 'var(--color-p50)', label: 'p50' },
  p95: { color: 'var(--color-p95)', label: 'p95' },
  p99: { color: 'var(--color-p99)', label: 'p99' },
  rate: { color: 'var(--color-accent)', label: 'Requests/s' },
} as const;

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

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted">
      <span aria-hidden className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

function ChartCard({ title, legend, children }: { title: string; legend: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-edge bg-surface p-4">
      <header className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
        <div className="flex gap-3">{legend}</div>
      </header>
      <div className="h-64">{children}</div>
    </section>
  );
}

/** Styled readout that follows the cursor, replacing recharts' default box. */
function HoverCard({ active, payload }: { active?: boolean; payload?: Array<{ payload?: unknown }> }) {
  if (!active) return null;
  const datum = payload?.map((entry) => entry.payload).find(isGraphDatum);
  if (!datum) return null;
  const rate = (datum as ChartDatum).instant_rps;
  return (
    <div className="rounded-lg border border-edge-strong bg-elevated/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="mb-1 text-faint">{formatSeconds(datum.elapsed_seconds)}s elapsed</p>
      <dl className="metric-number grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        <dt style={{ color: SERIES.p50.color }}>p50</dt><dd className="text-right">{formatMs(datum.p50_ms)} ms</dd>
        <dt style={{ color: SERIES.p95.color }}>p95</dt><dd className="text-right">{formatMs(datum.p95_ms)} ms</dd>
        <dt style={{ color: SERIES.p99.color }}>p99</dt><dd className="text-right">{formatMs(datum.p99_ms)} ms</dd>
        {rate !== undefined && (
          <><dt style={{ color: SERIES.rate.color }}>rate</dt><dd className="text-right">{formatRps(rate)}</dd></>
        )}
      </dl>
    </div>
  );
}

/**
 * Accessible equivalent of the hover card. The spec requires every aggregate
 * metric to be named and valued on point, including the no-datum case, which a
 * visual-only tooltip cannot announce.
 */
function DatumDetail({ detail }: { detail: HoverDetail }) {
  if (!detail) {
    return <p className="text-xs text-faint">Point at a graph position to inspect its metrics.</p>;
  }
  if (detail.kind === 'empty') {
    return (
      <p role="status" className="text-xs text-muted">
        No metric was recorded at elapsed test time {detail.elapsed} seconds.
      </p>
    );
  }
  const datum = detail.datum;
  const cells: Array<[string, string]> = [
    ['Elapsed test time', `${formatSeconds(datum.elapsed_seconds)} s`],
    ['Throughput', `${formatRps(datum.throughput_rps)} rps`],
    ['Completed requests', String(datum.completed_count)],
    ['Failed requests', String(datum.failed_count)],
    ['p50 ping time', `${formatMs(datum.p50_ms)} ms`],
    ['p95 ping time', `${formatMs(datum.p95_ms)} ms`],
    ['p99 ping time', `${formatMs(datum.p99_ms)} ms`],
  ];
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs" aria-live="polite">
      {cells.map(([term, value]) => (
        <div key={term} className="flex gap-1.5">
          <dt className="text-faint">{term}</dt>
          <dd className="metric-number text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Charts({ graphData, durationSeconds }: Props) {
  const [detail, setDetail] = useState<HoverDetail>(null);

  if (graphData.length === 0) {
    return (
      <section aria-live="polite" className="rounded-xl border border-dashed border-edge bg-surface/50 p-10 text-center">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Live performance</h2>
        <p className="mt-2 text-muted">Waiting for metric data.</p>
      </section>
    );
  }

  const data = withInstantRate(graphData);
  const latest = data[data.length - 1];
  const xMax = timeDomainMax(durationSeconds, latest.elapsed_seconds);
  const latencyMax = niceMax(Math.max(...data.map((datum) => datum.p99_ms)));
  const rateMax = niceMax(Math.max(...data.map((datum) => Math.max(datum.instant_rps, datum.throughput_rps))));

  // A fixed numeric domain keeps the axis still while the series sweeps across
  // it. Animation is disabled because frames arrive ten times a second, and
  // re-animating the whole series on each one is the visible "clunk".
  const axes = {
    xAxis: {
      dataKey: 'elapsed_seconds',
      type: 'number' as const,
      domain: [0, xMax] as [number, number],
      tickFormatter: formatSecondsTick,
      stroke: 'var(--color-faint)',
      tick: { fontSize: 11 },
      tickLine: false,
      axisLine: { stroke: 'var(--color-edge)' },
      allowDecimals: false,
    },
    grid: { stroke: 'var(--color-edge)', strokeDasharray: '3 3', vertical: false },
    shared: {
      data,
      margin: { top: 8, right: 12, bottom: 4, left: 4 },
      onMouseMove: (event: unknown) => setDetail(detailFor(event)),
      onMouseLeave: () => setDetail(null),
    },
    line: { dot: false, isAnimationActive: false, strokeWidth: 2, activeDot: { r: 3, strokeWidth: 0 } },
  };

  const yAxis = (max: number, formatter: (value: number) => string) => ({
    type: 'number' as const,
    domain: [0, max] as [number, number],
    tickFormatter: formatter,
    stroke: 'var(--color-faint)',
    tick: { fontSize: 11 },
    tickLine: false,
    axisLine: false,
    width: 44,
  });

  return (
    <section className="space-y-4" aria-label="Live performance graphs">
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartCard
          title="Latency"
          legend={<>
            <Swatch {...SERIES.p50} />
            <Swatch {...SERIES.p95} />
            <Swatch {...SERIES.p99} />
          </>}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart {...axes.shared}>
              <CartesianGrid {...axes.grid} />
              <XAxis {...axes.xAxis} />
              <YAxis {...yAxis(latencyMax, formatCompact)} unit="ms" />
              <Tooltip content={<HoverCard />} cursor={{ stroke: 'var(--color-edge-strong)' }} />
              <Line {...axes.line} type="monotone" dataKey="p50_ms" name="p50 ping time" stroke={SERIES.p50.color} />
              <Line {...axes.line} type="monotone" dataKey="p95_ms" name="p95 ping time" stroke={SERIES.p95.color} />
              <Line {...axes.line} type="monotone" dataKey="p99_ms" name="p99 ping time" stroke={SERIES.p99.color} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Throughput"
          legend={<>
            <Swatch {...SERIES.rate} />
            <Swatch color="var(--color-faint)" label="Cumulative avg" />
          </>}
        >
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart {...axes.shared}>
              <defs>
                <linearGradient id="rate-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES.rate.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES.rate.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...axes.grid} />
              <XAxis {...axes.xAxis} />
              <YAxis {...yAxis(rateMax, formatCompact)} />
              <Tooltip content={<HoverCard />} cursor={{ stroke: 'var(--color-edge-strong)' }} />
              <Area
                type="monotone" dataKey="instant_rps" name="Requests per second"
                stroke={SERIES.rate.color} strokeWidth={2} fill="url(#rate-fill)"
                dot={false} isAnimationActive={false} activeDot={{ r: 3, strokeWidth: 0 }}
              />
              <Line
                {...axes.line} type="monotone" dataKey="throughput_rps" name="Achieved throughput"
                stroke="var(--color-faint)" strokeWidth={1} strokeDasharray="4 4"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <section
        aria-label="Graph interaction details"
        className="rounded-xl border border-edge bg-surface px-4 py-3"
      >
        <DatumDetail detail={detail} />
        <p className="mt-2 text-[11px] text-faint">Graph data points: {graphData.length}</p>
      </section>
    </section>
  );
}
