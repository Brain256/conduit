import { formatCount, formatMs, formatPercent, formatRps } from '../lib/format';
import type { ActiveRunConfig, GraphDatum } from '../types/metrics';

interface Props {
  latest: GraphDatum | undefined;
  config: ActiveRunConfig | null;
}

function Tile({ label, value, unit, note, tone = 'normal' }: {
  label: string;
  value: string;
  unit?: string;
  note?: string;
  tone?: 'normal' | 'danger';
}) {
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <p className="text-[11px] font-semibold tracking-widest text-faint uppercase">{label}</p>
      <p className="mt-1.5 flex items-baseline gap-1">
        <span className={`metric-number text-3xl font-semibold ${tone === 'danger' ? 'text-danger' : 'text-ink'}`}>
          {value}
        </span>
        {unit && <span className="text-xs text-muted">{unit}</span>}
      </p>
      <p className="mt-1 h-4 text-[11px] text-faint">{note ?? ''}</p>
    </div>
  );
}

/** The four numbers that answer "how did the run go" without scrolling. */
export function KpiStrip({ latest, config }: Props) {
  const attempted = latest ? latest.completed_count + latest.failed_count : 0;
  const failed = latest?.failed_count ?? 0;
  const target = config && config.load_mode === 'closed' && config.target_rps
    ? `target ${formatCount(config.target_rps)} rps`
    : config?.load_mode === 'open' ? 'unpaced' : undefined;

  return (
    <section aria-label="Key results" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="Throughput"
        value={latest ? formatRps(latest.throughput_rps) : '—'}
        unit="rps"
        note={target}
      />
      <Tile
        label="p95 latency"
        value={latest ? formatMs(latest.p95_ms) : '—'}
        unit="ms"
        note={latest ? `p99 ${formatMs(latest.p99_ms)} ms` : undefined}
      />
      <Tile
        label="Failures"
        value={latest ? formatCount(failed) : '—'}
        note={latest ? formatPercent(failed, attempted) : undefined}
        tone={failed > 0 ? 'danger' : 'normal'}
      />
      <Tile
        label="Completed"
        value={latest ? formatCount(latest.completed_count) : '—'}
        note={config ? `${formatCount(config.workers)} workers` : undefined}
      />
    </section>
  );
}
