import type { MatchRequest, MatchResponse } from "./protocol";
import type { PatternPair } from "../patterns";

export interface MatchOptions {
  timeoutMs: number;
  /** Повторов внутри воркера для усреднения (медиана). */
  repeats: number;
}

export interface MatchOutcome {
  status: "completed" | "timeout";
  /** Медиана времени, мс. null при таймауте. */
  medianMs: number | null;
  samplesMs: number[];
  matched: boolean | null;
}

let requestCounter = 0;

/**
 * Выполняет один матчинг в свежем Web Worker. Если воркер не ответил за
 * timeoutMs, он принудительно завершается (единственный способ прервать
 * синхронный catastrophic backtracking в JS).
 */
export function runMatch(
  source: string,
  flags: string,
  input: string,
  opts: MatchOptions,
): Promise<MatchOutcome> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    });
    const requestId = ++requestCounter;

    const timer = window.setTimeout(() => {
      worker.terminate();
      resolve({
        status: "timeout",
        medianMs: null,
        samplesMs: [],
        matched: null,
      });
    }, opts.timeoutMs);

    worker.onmessage = (event: MessageEvent<MatchResponse>) => {
      const res = event.data;
      if (res.kind !== "result" || res.requestId !== requestId) return;
      window.clearTimeout(timer);
      worker.terminate();
      resolve({
        status: "completed",
        medianMs: res.medianMs,
        samplesMs: res.samplesMs,
        matched: res.matched,
      });
    };

    const req: MatchRequest = {
      kind: "match",
      requestId,
      source,
      flags,
      input,
      repeats: opts.repeats,
    };
    worker.postMessage(req);
  });
}

export interface SeriesPoint {
  n: number;
  unsafe: MatchOutcome;
  safe: MatchOutcome;
}

export interface SeriesOptions {
  /** Длины входа для unsafe-паттерна (растут медленно, малые значения). */
  unsafeLengths: number[];
  /** Длины входа для safe-паттерна (можно брать тысячи). */
  safeLengths: number[];
  timeoutMs: number;
  repeats: number;
  onProgress?: (done: number, total: number, label: string) => void;
}

/**
 * Прогоняет серию замеров для пары паттернов. Делает один warm-up прогон, чтобы
 * JIT успел скомпилировать, затем меряет unsafe и safe по своим длинам.
 */
export async function runSeries(
  pair: PatternPair,
  opts: SeriesOptions,
): Promise<SeriesPoint[]> {
  // Warm-up: короткий безопасный прогон, результат отбрасываем.
  await runMatch(pair.safeSource, pair.flags, pair.attack(8), {
    timeoutMs: opts.timeoutMs,
    repeats: 1,
  });

  const lengths = Array.from(
    new Set([...opts.unsafeLengths, ...opts.safeLengths]),
  ).sort((a, b) => a - b);

  const points: SeriesPoint[] = [];
  const total = lengths.length;
  let done = 0;
  let unsafeTimedOut = false;

  for (const n of lengths) {
    const input = pair.attack(n);

    // Как только unsafe упёрся в таймаут, дальше он только хуже — экономим время.
    // На длинах вне unsafeLengths unsafe не меряется вовсе (medianMs: null).
    const unsafe: MatchOutcome = !opts.unsafeLengths.includes(n)
      ? { status: "completed", medianMs: null, samplesMs: [], matched: null }
      : unsafeTimedOut
        ? { status: "timeout", medianMs: null, samplesMs: [], matched: null }
        : await runMatch(pair.unsafeSource, pair.flags, input, {
            timeoutMs: opts.timeoutMs,
            repeats: opts.repeats,
          });

    if (unsafe.status === "timeout") unsafeTimedOut = true;

    // safe меряем во всех точках, чтобы на коротких длинах его было с чем сравнить.
    const safe = await runMatch(pair.safeSource, pair.flags, input, {
      timeoutMs: opts.timeoutMs,
      repeats: opts.repeats,
    });

    points.push({ n, unsafe, safe });
    done++;
    opts.onProgress?.(done, total, `n=${n}`);
  }

  return points;
}
