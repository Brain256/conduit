import { formatClockTime, formatMs } from '../lib/format';
import type { RequestResponseRecord } from '../types/metrics';

interface Props { packet: RequestResponseRecord | null; status: string | null; }

type AnyPayload = {
  method?: string;
  target_url?: string;
  status_code?: number;
  headers: Record<string, string[]>;
  body: string;
};

function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold tracking-widest text-faint uppercase">{label}</p>
      {children}
    </div>
  );
}

function Payload({ title, payload }: { title: string; payload: AnyPayload }) {
  const meta: Array<[string, string]> = [
    ...(payload.method ? [['Method', payload.method] as [string, string]] : []),
    ...(payload.target_url ? [['Target', payload.target_url] as [string, string]] : []),
    ...(payload.status_code !== undefined ? [['Status', String(payload.status_code)] as [string, string]] : []),
  ];

  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-muted">{title}</h3>
      {meta.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {meta.map(([term, value]) => (
            <div key={term} className="flex gap-1.5">
              <dt className="text-faint">{term}</dt>
              <dd className="metric-number text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      <Block label="Headers">
        <pre className="max-h-40 overflow-auto rounded-lg border border-edge bg-canvas p-2 text-[11px] leading-relaxed text-muted">
          {JSON.stringify(payload.headers, null, 2)}
        </pre>
      </Block>
      <Block label="Body">
        <pre className="max-h-24 overflow-auto rounded-lg border border-edge bg-canvas p-2 text-[11px] leading-relaxed text-muted">
          {payload.body || '(empty)'}
        </pre>
      </Block>
    </section>
  );
}

/** Displays the reducer-owned latest record; omitted packet fields never clear it. */
export function PacketView({ packet, status }: Props) {
  return (
    <section className="rounded-xl border border-edge bg-surface" aria-label="Latest request-response packet">
      <details>
        <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Latest packet</h2>
          {packet && (
            <span className="metric-number text-xs text-faint">
              {formatClockTime(packet.completed_at)} · {formatMs(packet.ping_ms)} ms
              {packet.response ? '' : ' · failed'}
            </span>
          )}
        </summary>
        <div className="space-y-4 border-t border-edge px-4 py-3">
          {!packet ? <p role="status" className="text-xs text-muted">No completed request-response packet received.</p> : (
            <>
              <Payload title="Request" payload={packet.request} />
              {packet.response !== undefined ? (
                <Payload title="Response" payload={packet.response} />
              ) : (
                <section className="space-y-1">
                  <h3 className="text-xs font-semibold text-danger">Failure</h3>
                  <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">{packet.failure}</p>
                </section>
              )}
            </>
          )}
          {packet && status && <p role="status" className="text-xs text-muted">{status}</p>}
        </div>
      </details>
    </section>
  );
}
