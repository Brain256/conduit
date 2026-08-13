/**
 * Display formatting for metric values.
 *
 * The wire carries full-precision floats, which is correct for the data and
 * wrong for the screen: an achieved throughput of 470.93333333333335 or an
 * elapsed time of 5e-324 (the coordinator's non-zero guard) is unreadable.
 * Formatting lives here so every view renders the same value identically.
 */

const DENORMAL_THRESHOLD = 1e-6;

/** Requests per second, e.g. `12,857.4`. */
export function formatRps(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Milliseconds, e.g. `13.59`. */
export function formatMs(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Whole counts with thousands separators, e.g. `1,413`. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return Math.round(value).toLocaleString();
}

/**
 * Elapsed seconds. Values below the denormal threshold come from the
 * coordinator's divide-by-zero guard rather than a real measurement, so they
 * render as the zero they represent.
 */
export function formatSeconds(value: number): string {
  if (!Number.isFinite(value)) return '—';
  if (value < DENORMAL_THRESHOLD) return '0.0';
  return value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** Axis tick for elapsed time, e.g. `12s`. Kept short so ticks never collide. */
export function formatSecondsTick(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (value < DENORMAL_THRESHOLD) return '0s';
  return `${Number.isInteger(value) ? value : Number(value.toFixed(1))}s`;
}

/** Axis tick for magnitudes, compacting thousands to `1.2k`. */
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Math.abs(value) >= 1000) return `${Number((value / 1000).toFixed(1))}k`;
  return String(Number(value.toFixed(Math.abs(value) < 10 ? 1 : 0)));
}

/** A share of a total, e.g. `0.28%`. Returns `0%` for an empty total. */
export function formatPercent(part: number, total: number): string {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return '0%';
  const share = (part / total) * 100;
  if (share > 0 && share < 0.01) return '<0.01%';
  return `${share.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Wall-clock time of day from an RFC3339 timestamp, e.g. `02:14:53.123`.
 * Full timestamps are precise but unscannable, and the date adds nothing while
 * watching a run that lasts seconds.
 */
export function formatClockTime(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return timestamp;
  return parsed.toISOString().slice(11, 23);
}
