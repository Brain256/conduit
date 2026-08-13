import { useState } from 'react';
import type { ActiveRunConfig, LoadMode } from '../types/metrics';

interface Props {
  onStart: (testId: string, config: ActiveRunConfig) => void;
}

const MODES: Array<{ value: LoadMode; title: string; help: string }> = [
  {
    value: 'closed',
    title: 'Target rate',
    help: 'Paces requests to the rate you set. Answers whether the balancer kept up; throughput cannot exceed the target.',
  },
  {
    value: 'open',
    title: 'Max throughput',
    help: 'No pacing. Workers send flat out, so throughput is workers ÷ mean latency. Sweep workers to find the ceiling.',
  },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold tracking-widest text-faint uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-faint">{hint}</span>}
    </label>
  );
}

const inputClass = 'metric-number mt-1 w-full rounded-lg border border-edge bg-elevated px-3 py-2 text-sm text-ink '
  + 'outline-none transition-colors focus:border-accent';

export function TestConfig({ onStart }: Props) {
  const [port, setPort] = useState(8080);
  const [duration, setDuration] = useState(30);
  const [rps, setRps] = useState(1000);
  const [workers, setWorkers] = useState(10);
  const [mode, setMode] = useState<LoadMode>('closed');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const response = await fetch('http://localhost:8081/test/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // rps is omitted in open mode: there is no pacer for it to configure.
        body: JSON.stringify({ port, dur: duration, workers, mode, ...(mode === 'closed' ? { rps } : {}) }),
      });

      if (!response.ok) {
        setError((await response.text()).trim() || 'Unable to start the test.');
        return;
      }

      const data = await response.json();
      onStart(data.test_id, {
        port,
        duration_seconds: duration,
        target_rps: mode === 'closed' ? rps : 0,
        workers,
        load_mode: mode,
      });
    } catch {
      setError('Unable to reach the load tester on localhost:8081.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-edge bg-surface p-4">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">New run</h2>

      <fieldset className="space-y-2">
        <legend className="text-[11px] font-semibold tracking-widest text-faint uppercase">Load model</legend>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((option) => {
            const selected = mode === option.value;
            return (
              <label
                key={option.value}
                className={`cursor-pointer rounded-lg border px-3 py-2 text-center text-xs font-medium transition-colors ${
                  selected ? 'border-accent bg-accent/10 text-accent' : 'border-edge bg-elevated text-muted hover:border-edge-strong'
                }`}
              >
                <input
                  type="radio"
                  name="load-mode"
                  value={option.value}
                  checked={selected}
                  onChange={() => setMode(option.value)}
                  className="sr-only"
                />
                {option.title}
              </label>
            );
          })}
        </div>
        <p className="text-[11px] leading-relaxed text-faint">
          {MODES.find((option) => option.value === mode)?.help}
        </p>
      </fieldset>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Port">
          <input type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputClass} />
        </Field>
        <Field label="Duration (s)">
          <input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputClass} />
        </Field>
        {mode === 'closed' && (
          <Field label="Target rps">
            <input type="number" min={1} value={rps} onChange={(e) => setRps(Number(e.target.value))} className={inputClass} />
          </Field>
        )}
        <Field label="Workers">
          <input type="number" min={1} value={workers} onChange={(e) => setWorkers(Number(e.target.value))} className={inputClass} />
        </Field>
      </div>

      {error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? 'Starting…' : 'Start run'}
      </button>
    </form>
  );
}
