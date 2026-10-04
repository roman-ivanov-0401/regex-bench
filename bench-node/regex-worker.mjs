import { parentPort } from "node:worker_threads";

// Worker для worker_threads: исполняет регулярку в отдельном потоке, чтобы
// catastrophic backtracking можно было прервать через worker.terminate().
// Намеренно на чистом JS (.mjs), чтобы запускаться без компиляции TS.

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

parentPort.on("message", (req) => {
  const re = new RegExp(req.source, req.flags);
  // V8 сначала исполняет регулярку интерпретатором и компилирует её в машинный
  // код только после первых вызовов; прогреваем на коротком входе.
  const warm = req.input.slice(0, 4);
  re.test(warm);
  re.test(warm);
  const samples = [];
  let matched = false;
  for (let i = 0; i < req.repeats; i++) {
    const start = performance.now();
    matched = re.test(req.input);
    const elapsed = performance.now() - start;
    samples.push(elapsed);
    // Долгий прогон повторять незачем: шум мал, а повторы съедают таймаут.
    if (elapsed > 50) break;
  }
  parentPort.postMessage({
    medianMs: median(samples),
    samplesMs: samples,
    matched,
  });
});
