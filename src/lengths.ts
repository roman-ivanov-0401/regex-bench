import type { PatternPair } from "./patterns";

/** Строит равномерный целочисленный диапазон длин [start..max]. */
export function buildLengths(max: number, steps: number, start = 2): number[] {
  const lengths: number[] = [];
  const span = Math.max(1, max - start);
  for (let i = 0; i < steps; i++) {
    const n = Math.round(start + (span * i) / Math.max(1, steps - 1));
    if (lengths[lengths.length - 1] !== n) lengths.push(n);
  }
  return lengths;
}

/** Геометрическая прогрессия длин (from..to]: равномерно ложится на лог-шкалу. */
export function geomLengths(from: number, to: number, steps: number): number[] {
  const ratio = Math.pow(to / from, 1 / steps);
  const lengths: number[] = [];
  for (let i = 1; i <= steps; i++) {
    const n = Math.round(from * Math.pow(ratio, i));
    if (lengths[lengths.length - 1] !== n) lengths.push(n);
  }
  return lengths;
}

/**
 * Длины для серии замеров. Экспоненциальным паттернам интересен плотный
 * линейный шаг на малых n, полиномиальным — геометрический до десятков тысяч.
 * safe дополнительно меряется на длинах сверх maxUnsafe.
 */
export function seriesLengths(
  pair: PatternPair,
  maxUnsafe: number,
  maxSafe: number,
): { unsafe: number[]; safe: number[] } {
  const unsafe =
    pair.growth === "exponential"
      ? buildLengths(maxUnsafe, Math.min(maxUnsafe, 20))
      : geomLengths(10, maxUnsafe, 16);
  const safe = maxSafe > maxUnsafe ? geomLengths(maxUnsafe, maxSafe, 8) : [];
  return { unsafe, safe };
}
