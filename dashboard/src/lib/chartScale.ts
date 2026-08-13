import type { GraphDatum } from '../types/metrics';

/** A graph datum plus the smoothed instantaneous rate derived for display. */
export type ChartDatum = GraphDatum & { instant_rps: number };

const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

/**
 * Rounds an axis maximum up to the next "nice" value.
 *
 * An auto-fitted axis rescales on almost every frame, which makes the plot
 * appear to twitch continuously. Quantising the maximum means it only changes
 * when the data crosses a step, so the axis holds still between steps.
 */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const fraction = value / magnitude;
  const step = LADDER.find((candidate) => fraction <= candidate) ?? 10;
  return step * magnitude;
}

/**
 * The horizontal domain to plot against.
 *
 * Anchoring the axis to the configured duration lets the series sweep across a
 * stationary axis instead of the axis rescaling to fit each new point. A run
 * that overruns its configured duration still extends rather than clipping.
 */
export function timeDomainMax(configuredDuration: number | null, latestElapsed: number): number {
  const configured = configuredDuration && configuredDuration > 0 ? configuredDuration : 0;
  return Math.max(1, configured, Math.ceil(latestElapsed));
}

/**
 * Adds a smoothed instantaneous request rate to each datum.
 *
 * `throughput_rps` on the wire is cumulative (total requests / elapsed), so it
 * converges to a flat line and hides what the target is doing right now. This
 * differences the cumulative counts over a trailing window instead. The window
 * matters because frames arrive every 100ms, and a single 100ms gap quantises
 * to multiples of 10 rps, which looks like noise.
 */
export function withInstantRate(data: ReadonlyArray<GraphDatum>, windowSeconds = 1): ChartDatum[] {
  const total = (datum: GraphDatum) => datum.completed_count + datum.failed_count;

  return data.map((datum, index) => {
    let baseline = index;
    while (baseline > 0 && datum.elapsed_seconds - data[baseline - 1].elapsed_seconds < windowSeconds) {
      baseline -= 1;
    }

    const span = datum.elapsed_seconds - data[baseline].elapsed_seconds;
    // Before a full window exists, the cumulative average is the best estimate.
    const instant = span > 0 ? (total(datum) - total(data[baseline])) / span : datum.throughput_rps;
    return { ...datum, instant_rps: Number.isFinite(instant) && instant >= 0 ? instant : 0 };
  });
}
