import { formatSeconds } from '../lib/format';
import type { ActiveRunConfig, GraphDatum } from '../types/metrics';

export type RunStatus = 'idle' | 'running' | 'completed' | 'ended-early';

interface Props {
  testId: string | null;
  config: ActiveRunConfig | null;
  latest: GraphDatum | undefined;
  status: RunStatus;
}

const STATUS_STYLE: Record<RunStatus, { label: string; dot: string; text: string }> = {
  idle: { label: 'Idle', dot: 'bg-faint', text: 'text-muted' },
  running: { label: 'Running', dot: 'bg-accent live-dot', text: 'text-accent' },
  completed: { label: 'Completed', dot: 'bg-ok', text: 'text-ok' },
  'ended-early': { label: 'Ended early', dot: 'bg-warn', text: 'text-warn' },
};

/**
 * Identity and progress for the active run. The configured parameters are shown
 * from the moment a run starts, rather than only appearing in the final summary
 * once it has finished.
 */
export function RunHeader({ testId, config, latest, status }: Props) {
  const style = STATUS_STYLE[status];
  const elapsed = latest?.elapsed_seconds ?? 0;
  const duration = config?.duration_seconds ?? 0;
  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  const descriptor = config
    ? [
      `:${config.port}`,
      config.load_mode === 'open' ? 'open' : 'closed',
      `${config.workers} workers`,
      ...(config.load_mode === 'closed' && config.target_rps ? [`${config.target_rps} rps target`] : []),
    ].join(' · ')
    : 'No active run';

  return (
    <header className="sticky top-0 z-10 border-b border-edge bg-canvas/85 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <div className="flex items-baseline gap-3">
          <span className="text-base font-semibold tracking-tight">conduit</span>
          <span className="text-xs text-faint">load-test observability</span>
        </div>

        <p className="metric-number text-xs text-muted">{descriptor}</p>

        <div className="ml-auto flex items-center gap-4">
          {config && status !== 'idle' && (
            <p className="metric-number text-xs text-muted">
              {formatSeconds(elapsed)}s / {config.duration_seconds}s
            </p>
          )}
          <p className={`flex items-center gap-2 text-xs font-medium ${style.text}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${style.dot}`} />
            {style.label}
          </p>
        </div>

        {testId && (
          <p className="metric-number w-full truncate text-[11px] text-faint" title={testId}>
            {testId}
          </p>
        )}
      </div>

      <div
        className="h-0.5 w-full bg-edge"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        aria-label="Test progress"
      >
        <div
          className={`h-full transition-[width] duration-200 ease-out ${status === 'completed' ? 'bg-ok' : 'bg-accent'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </header>
  );
}
