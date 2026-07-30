import type { RequestResponseRecord } from '../types/metrics';

interface Props { packet: RequestResponseRecord | null; status: string | null; }
function Payload({ title, payload }: { title: string; payload: { method?: string; target_url?: string; status_code?: number; headers: Record<string, string[]>; body: string } }) {
  return <section className="space-y-1"><h3 className="font-medium">{title}</h3>
    {'method' in payload && <p><strong>Method:</strong> {payload.method}</p>}
    {'target_url' in payload && <p><strong>Target URL:</strong> {payload.target_url}</p>}
    {'status_code' in payload && <p><strong>Status code:</strong> {payload.status_code}</p>}
    <p><strong>Headers:</strong></p><pre className="overflow-auto rounded bg-slate-100 p-2 text-xs">{JSON.stringify(payload.headers, null, 2)}</pre>
    <p><strong>Body:</strong></p><pre className="overflow-auto rounded bg-slate-100 p-2 text-xs">{payload.body}</pre>
  </section>;
}

/** Displays the reducer-owned latest record; omitted packet fields never clear it. */
export function PacketView({ packet, status }: Props) {
  return <section className="space-y-3 rounded border p-4" aria-label="Latest request-response packet"><h2 className="text-lg font-semibold">Latest request-response packet</h2>
    {!packet ? <p role="status">No completed request-response packet received.</p> : <>
      <p><strong>Completed at:</strong> {packet.completed_at}</p><p><strong>Ping time:</strong> {packet.ping_ms} ms</p>
      <Payload title="Request payload" payload={packet.request} />
      {packet.response !== undefined ? <Payload title="Response payload" payload={packet.response} /> : <section><h3 className="font-medium">Failure</h3><p>{packet.failure}</p></section>}
    </>}
    {packet && status && <p role="status">{status}</p>}
  </section>;
}
