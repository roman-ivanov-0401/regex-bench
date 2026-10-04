/// <reference lib="webworker" />
import type { MatchRequest, MatchResponse } from "./protocol";

// Воркер исполняет регулярное выражение в изоляции от main thread.
// Синхронный RegExp.test блокирует ЭТОТ поток, но не UI; если он уходит в
// catastrophic backtracking, main thread по таймауту вызовет worker.terminate().

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

self.onmessage = (event: MessageEvent<MatchRequest>) => {
  const req = event.data;
  if (req.kind !== "match") return;

  const re = new RegExp(req.source, req.flags);
  // V8 сначала исполняет регулярку интерпретатором и компилирует её в машинный
  // код только после первых вызовов; прогреваем на коротком входе.
  const warm = req.input.slice(0, 4);
  re.test(warm);
  re.test(warm);
  const samplesMs: number[] = [];
  let matched = false;

  for (let i = 0; i < req.repeats; i++) {
    const start = performance.now();
    matched = re.test(req.input);
    const elapsed = performance.now() - start;
    samplesMs.push(elapsed);
    // Долгий прогон повторять незачем: шум мал, а повторы съедают таймаут.
    if (elapsed > 50) break;
  }

  const response: MatchResponse = {
    kind: "result",
    requestId: req.requestId,
    medianMs: median(samplesMs),
    samplesMs,
    matched,
  };
  self.postMessage(response);
};
