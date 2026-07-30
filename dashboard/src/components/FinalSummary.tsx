import { useState } from 'react';
import { exportFinalSummary, type ExportResult } from '../export/exportFinalSummary';
import type { FinalSummaryExportSnapshot, SessionFinal } from '../types/metrics';

interface Props {
  finals: ReadonlyMap<string, SessionFinal>;
  status: string | null;
  onDismiss: (testId: string) => void;
  exporter?: (snapshot: FinalSummaryExportSnapshot | undefined) => ExportResult;
}
function SummaryValues({ summary }: { summary: SessionFinal['summary'] }) {
  const { parameters } = summary;
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm"><dt>Test ID</dt><dd>{summary.test_id}</dd><dt>Port</dt><dd>{parameters.port}</dd><dt>Configured duration</dt><dd>{parameters.duration_seconds} s</dd><dt>Target rate</dt><dd>{parameters.target_rps} rps</dd><dt>Workers</dt><dd>{parameters.workers}</dd><dt>Actual elapsed time</dt><dd>{summary.elapsed_seconds} s</dd><dt>Total completed requests</dt><dd>{summary.completed_count}</dd><dt>Total failed requests</dt><dd>{summary.failed_count}</dd><dt>Achieved throughput</dt><dd>{summary.achieved_throughput_rps} rps</dd><dt>p50 ping time</dt><dd>{summary.p50_ms} ms</dd><dt>p95 ping time</dt><dd>{summary.p95_ms} ms</dd><dt>p99 ping time</dt><dd>{summary.p99_ms} ms</dd></dl>;
}

/** Renders retained browser-session summaries without owning or mutating their snapshots. */
export function FinalSummary({ finals, status, onDismiss, exporter = exportFinalSummary }: Props) {
  const [exportMessages, setExportMessages] = useState<Record<string, string | null>>({});
  if (finals.size === 0) return status ? <p role="status">{status}</p> : null;
  return <section className="space-y-4" aria-label="Completed test final summaries"><h2 className="text-xl font-semibold">Completed test final summaries</h2>{status && <p role="status">{status}</p>}
    {[...finals.entries()].map(([testId, final]) => <article key={testId} className="space-y-3 rounded border p-4"><h3 className="text-lg font-semibold">Final summary: {testId}</h3><SummaryValues summary={final.summary} />
      <div className="flex gap-2"><button type="button" onClick={() => onDismiss(testId)}>Dismiss final summary</button><button type="button" onClick={() => setExportMessages((messages) => ({ ...messages, [testId]: exporter(final.export_snapshot).message }))}>Export latency graph and data</button></div>
      {exportMessages[testId] && <p role="status">{exportMessages[testId]}</p>}
    </article>)}
  </section>;
}
