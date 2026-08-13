import type { FinalSummary, FinalSummaryExportSnapshot, GraphDatum, TestParameters } from '../types/metrics';

export const EXPORT_UNAVAILABLE = 'Unable to export latency graph: completed test data is unavailable.';
export const EXPORT_INVALID = 'Unable to export latency graph: completed test data is invalid.';
export const EXPORT_RETRY = 'Unable to export latency graph. Try again.';
export type ExportResult = { message: string | null; svgDownloaded: boolean; jsonDownloaded: boolean };
export interface ExportDependencies {
  createSvg: (snapshot: FinalSummaryExportSnapshot) => string;
  createJson: (snapshot: FinalSummaryExportSnapshot) => string;
  download: (content: string, filename: string, mimeType: string) => void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteNonNegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positiveFinite = (value: unknown): value is number => finiteNonNegative(value) && value > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
function parameters(value: unknown): value is TestParameters {
  // Open mode has no pacer, so target_rps is legitimately 0 there and is only
  // required to be positive in closed mode.
  const rate = value as Record<string, unknown>;
  const validRate = rate?.load_mode === 'open' ? rate.target_rps === 0 : positiveFinite(rate?.target_rps);
  return isRecord(value) && typeof value.port === 'number' && Number.isSafeInteger(value.port) && value.port > 0 && value.port <= 65535
    && positiveFinite(value.duration_seconds) && validRate && (value.load_mode === 'open' || value.load_mode === 'closed')
    && typeof value.workers === 'number' && Number.isSafeInteger(value.workers) && value.workers > 0;
}
function ordered(values: Record<string, unknown>): boolean {
  return finiteNonNegative(values.p50_ms) && finiteNonNegative(values.p95_ms) && finiteNonNegative(values.p99_ms) && values.p50_ms <= values.p95_ms && values.p95_ms <= values.p99_ms;
}
function validSummary(value: unknown): value is FinalSummary {
  return isRecord(value) && text(value.test_id) && parameters(value.parameters) && positiveFinite(value.elapsed_seconds) && count(value.completed_count) && count(value.failed_count) && finiteNonNegative(value.achieved_throughput_rps) && ordered(value);
}
function validDatum(value: unknown): value is GraphDatum {
  return isRecord(value) && finiteNonNegative(value.elapsed_seconds) && finiteNonNegative(value.throughput_rps) && count(value.completed_count) && count(value.failed_count) && ordered(value);
}

/** Defensive pre-generation boundary for retained browser-session captures. */
export function validateExportSnapshot(value: unknown): value is FinalSummaryExportSnapshot {
  return isRecord(value) && text(value.test_id) && validSummary(value.final_summary) && value.test_id === value.final_summary.test_id
    && Array.isArray(value.graph_data) && value.graph_data.every(validDatum);
}

/** Builds the deliberately ordered UTF-8 JSON source-data document. */
export function createLatencyExportJson(snapshot: FinalSummaryExportSnapshot): string {
  const summary = snapshot.final_summary;
  return JSON.stringify({ schema_version: 1, format: 'live-test-observability/latency-export', test_id: snapshot.test_id, parameters: summary.parameters, final_summary: summary, graph_data: snapshot.graph_data });
}

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] ?? character);
function number(value: number): string {
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return formatted === '-0' ? '0' : formatted;
}
function point(datum: GraphDatum, metric: 'p50_ms' | 'p95_ms' | 'p99_ms', xMax: number, yMax: number): string {
  const x = 90 + (datum.elapsed_seconds / xMax) * 1040;
  const y = 505 - (datum[metric] / yMax) * 365;
  return `${number(x)},${number(y)}`;
}

/** Creates a standalone deterministic SVG without scripts, network access, or external assets. */
export function createLatencySvg(snapshot: FinalSummaryExportSnapshot): string {
  const summary = snapshot.final_summary;
  const xMax = Math.max(1, ...snapshot.graph_data.map((datum) => datum.elapsed_seconds));
  const yMax = Math.max(1, ...snapshot.graph_data.map((datum) => datum.p99_ms));
  const series = (metric: 'p50_ms' | 'p95_ms' | 'p99_ms', color: string) => `<polyline fill="none" stroke="${color}" stroke-width="3" points="${snapshot.graph_data.map((datum) => point(datum, metric, xMax, yMax)).join(' ')}"/>`;
  const metadata = [
    `Test ID: ${summary.test_id}`, `Port: ${summary.parameters.port}`, `Load mode: ${summary.parameters.load_mode}`, `Duration: ${summary.parameters.duration_seconds} s`,
    summary.parameters.load_mode === 'open' ? 'Target RPS: unpaced' : `Target RPS: ${summary.parameters.target_rps}`, `Workers: ${summary.parameters.workers}`,
    `Actual elapsed: ${summary.elapsed_seconds} s`, `Completed: ${summary.completed_count}`, `Failed: ${summary.failed_count}`, `Achieved throughput: ${summary.achieved_throughput_rps} rps`, `p50: ${summary.p50_ms} ms`, `p95: ${summary.p95_ms} ms`, `p99: ${summary.p99_ms} ms`,
  ];
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760"><style>text{font-family:Arial,sans-serif;fill:#172033}.axis{stroke:#334155}.grid{stroke:#cbd5e1;stroke-dasharray:4 4}</style><rect width="1200" height="760" fill="white"/><text x="90" y="35" font-size="24">Latency graph</text><line class="axis" x1="90" y1="505" x2="1130" y2="505"/><line class="axis" x1="90" y1="70" x2="90" y2="505"/><text x="500" y="545">Elapsed test time (seconds)</text><text x="25" y="290" transform="rotate(-90 25 290)">Ping time (milliseconds)</text><text x="90" y="60">0</text><text x="1080" y="525">${number(xMax)}</text><text x="45" y="500">0</text><text x="35" y="85">${number(yMax)}</text><line class="grid" x1="90" y1="287.5" x2="1130" y2="287.5"/>${series('p50_ms', '#22c55e')}${series('p95_ms', '#eab308')}${series('p99_ms', '#ef4444')}<text x="90" y="575" fill="#22c55e">p50 ping time</text><text x="250" y="575" fill="#eab308">p95 ping time</text><text x="410" y="575" fill="#ef4444">p99 ping time</text>${metadata.map((line, index) => { const rows = Math.ceil(metadata.length / 2); return `<text x="90" y="${610 + (index % rows) * 23}" ${index >= rows ? 'dx="500"' : ''}>${escapeXml(line)}</text>`; }).join('')}</svg>`;
}

function browserDownload(content: string, filename: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  try {
    const anchor = document.createElement('a');
    anchor.href = url; anchor.download = filename; anchor.style.display = 'none';
    document.body.append(anchor); anchor.click(); anchor.remove();
  } finally { URL.revokeObjectURL(url); }
}
const defaults: ExportDependencies = { createSvg: createLatencySvg, createJson: createLatencyExportJson, download: browserDownload };

/** Attempts both independent exports exactly once after validation. */
export function exportFinalSummary(snapshot: FinalSummaryExportSnapshot | undefined, dependencies: ExportDependencies = defaults): ExportResult {
  if (!snapshot) return { message: EXPORT_UNAVAILABLE, svgDownloaded: false, jsonDownloaded: false };
  if (!validateExportSnapshot(snapshot)) return { message: EXPORT_INVALID, svgDownloaded: false, jsonDownloaded: false };
  let svgDownloaded = false; let jsonDownloaded = false; let svgFailed = false; let jsonFailed = false;
  try { dependencies.download(dependencies.createSvg(snapshot), `${snapshot.test_id}-latency.svg`, 'image/svg+xml;charset=utf-8'); svgDownloaded = true; } catch { svgFailed = true; }
  try { dependencies.download(dependencies.createJson(snapshot), `${snapshot.test_id}-latency.json`, 'application/json;charset=utf-8'); jsonDownloaded = true; } catch { jsonFailed = true; }
  const message = svgFailed && jsonFailed ? EXPORT_RETRY : svgFailed ? 'Unable to export the SVG document.' : jsonFailed ? 'Unable to export the JSON document.' : null;
  return { message, svgDownloaded, jsonDownloaded };
}
