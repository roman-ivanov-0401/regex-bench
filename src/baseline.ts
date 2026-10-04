import raw from "./data/baseline.json";
import type { MatchOutcome, SeriesPoint } from "./bench/runner";

// Снимок замеров из `npm run bench:node`; обновляется при каждом его запуске.

export interface ResultRow {
  pair: string;
  n: number;
  kind: "unsafe" | "safe";
  status: "completed" | "timeout";
  medianMs: number | null;
}

interface Baseline {
  timestamp: string;
  timeoutMs: number;
  env: { cpu: string; node: string; platform: string };
  series: ResultRow[];
}

export const baseline = raw as Baseline;

const empty: MatchOutcome = { status: "completed", medianMs: null, samplesMs: [], matched: null };

/** Строки замеров одной пары → точки графика. */
export function rowsToPoints(rows: ResultRow[], pairId: string): SeriesPoint[] {
  const byN = new Map<number, SeriesPoint>();
  for (const row of rows) {
    if (row.pair !== pairId) continue;
    const point = byN.get(row.n) ?? { n: row.n, unsafe: empty, safe: empty };
    point[row.kind] = { status: row.status, medianMs: row.medianMs, samplesMs: [], matched: null };
    byN.set(row.n, point);
  }
  return [...byN.values()].sort((a, b) => a.n - b.n);
}

export function baselinePoints(pairId: string): SeriesPoint[] {
  return rowsToPoints(baseline.series, pairId);
}
