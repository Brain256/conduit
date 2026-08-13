import { useState } from 'react';
import { exportFinalSummary, type ExportResult } from '../export/exportFinalSummary';
import { formatCount, formatMs, formatPercent, formatRps, formatSeconds } from '../lib/format';
import type { FinalSummaryExportSnapshot, SessionFinal } from '../types/metrics';

interface Props {
  finals: ReadonlyMap<string, SessionFinal>;
  status: string | null;
  onDismiss: (testId: string) => void;
  exporter?: (snapshot: FinalSummaryExportSnapshot | undefined) => ExportResult;
}

const COLUMNS = ['Run', 'Mode', 'Workers', 'Target', 'Throughput', 'p50', 'p95', 'p99', 'Failures', 'Elapsed', ''] as const;

/**
 * Completed runs as rows rather than stacked descriptions, because a single
 * throughput number means little without the configuration that produced it and
 * the other runs to compare it against.
 */
export function FinalSummary({ finals, status, onDismiss, exporter = exportFinalSummary }: Props) {
  const [exportMessages, setExportMessages] = useState<Record<string, string | null>>({});
  if (finals.size === 0) return status ? <p role="status" className="text-xs text-muted">{status}</p> : null;

  return (
    <section className="rounded-xl border border-edge bg-surface" aria-label="Completed test final summaries">
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Completed runs</h2>
        <span className="text-xs text-faint">{finals.size} retained</span>
      </header>
      {status && <p role="status" className="px-4 pb-2 text-xs text-warn">{status}</p>}

      <div className="overflow-x-auto border-t border-edge">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-[11px] tracking-widest text-faint uppercase">
              {COLUMNS.map((column, index) => (
                <th key={column || index} scope="col" className="px-3 py-2 font-semibold whitespace-nowrap">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...finals.entries()].map(([testId, final]) => {
              const summary = final.summary;
              const parameters = summary.parameters;
              const attempted = summary.completed_count + summary.failed_count;
              const open = parameters.load_mode === 'open';
              return (
                <tr key={testId} className="border-t border-edge/60 align-top">
                  <th scope="row" className="max-w-[10rem] px-3 py-2 font-normal">
                    <span className="metric-number block truncate text-ink" title={testId}>{testId.slice(0, 8)}</span>
                    <span className="metric-number text-faint">:{parameters.port}</span>
                  </th>
                  <td className="px-3 py-2">
                    <span className={open ? 'text-accent' : 'text-muted'}>{open ? 'open' : 'closed'}</span>
                  </td>
                  <td className="metric-number px-3 py-2">{formatCount(parameters.workers)}</td>
                  <td className="metric-number px-3 py-2 text-muted">{open ? 'unpaced' : formatCount(parameters.target_rps)}</td>
                  <td className="metric-number px-3 py-2 font-semibold text-ink">{formatRps(summary.achieved_throughput_rps)}</td>
                  <td className="metric-number px-3 py-2 text-p50">{formatMs(summary.p50_ms)}</td>
                  <td className="metric-number px-3 py-2 text-p95">{formatMs(summary.p95_ms)}</td>
                  <td className="metric-number px-3 py-2 text-p99">{formatMs(summary.p99_ms)}</td>
                  <td className={`metric-number px-3 py-2 ${summary.failed_count > 0 ? 'text-danger' : 'text-muted'}`}>
                    {formatCount(summary.failed_count)}
                    <span className="block text-faint">{formatPercent(summary.failed_count, attempted)}</span>
                  </td>
                  <td className="metric-number px-3 py-2 text-muted">
                    {formatSeconds(summary.elapsed_seconds)}s
                    <span className="block text-faint">of {parameters.duration_seconds}s</span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => setExportMessages((messages) => ({ ...messages, [testId]: exporter(final.export_snapshot).message }))}
                        className="rounded border border-edge bg-elevated px-2 py-1 text-[11px] whitespace-nowrap text-muted transition-colors hover:border-edge-strong hover:text-ink"
                      >
                        Export latency graph and data
                      </button>
                      <button
                        type="button"
                        onClick={() => onDismiss(testId)}
                        className="rounded px-2 py-1 text-[11px] whitespace-nowrap text-faint transition-colors hover:text-danger"
                      >
                        Dismiss final summary
                      </button>
                      {exportMessages[testId] && <p role="status" className="text-[11px] text-warn">{exportMessages[testId]}</p>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
