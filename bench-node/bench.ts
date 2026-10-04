import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { Bench } from "tinybench";
import { PATTERN_PAIRS, type PatternPair } from "../src/patterns.ts";
import { seriesLengths } from "../src/lengths.ts";

const WORKER_URL = new URL("./regex-worker.mjs", import.meta.url);
const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
// Снимок, который лендинг показывает до первого живого прогона.
const BASELINE_PATH = fileURLToPath(new URL("../src/data/baseline.json", import.meta.url));
const TIMEOUT_MS = 2000;

interface Outcome {
  status: "completed" | "timeout";
  medianMs: number | null;
  matched: boolean | null;
}

/** Один матчинг в worker_threads с принудительным завершением по таймауту. */
function runMatchNode(
  source: string,
  flags: string,
  input: string,
  timeoutMs: number,
  repeats: number,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_URL);
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ status: "timeout", medianMs: null, matched: null });
    }, timeoutMs);

    worker.once("message", (res: { medianMs: number; matched: boolean }) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve({ status: "completed", medianMs: res.medianMs, matched: res.matched });
    });
    worker.on("error", () => {
      clearTimeout(timer);
      resolve({ status: "timeout", medianMs: null, matched: null });
    });

    worker.postMessage({ source, flags, input, repeats });
  });
}

interface SeriesRow {
  pair: string;
  n: number;
  kind: "unsafe" | "safe";
  status: string;
  medianMs: number | null;
}

async function measureSeries(pair: PatternPair): Promise<SeriesRow[]> {
  const timeoutMs = TIMEOUT_MS;
  const lengths = seriesLengths(pair, pair.bench.unsafe, pair.bench.safe);
  const unsafeLengths = lengths.unsafe;
  // safe меряем и на длинах unsafe (чтобы сравнивать в тех же точках), и на длинных.
  const safeLengths = [...unsafeLengths, ...lengths.safe];
  const rows: SeriesRow[] = [];

  let unsafeTimedOut = false;
  for (const n of unsafeLengths) {
    const input = pair.attack(n);
    const o = unsafeTimedOut
      ? { status: "timeout" as const, medianMs: null }
      : await runMatchNode(pair.unsafeSource, pair.flags, input, timeoutMs, 3);
    if (o.status === "timeout") unsafeTimedOut = true;
    rows.push({ pair: pair.id, n, kind: "unsafe", status: o.status, medianMs: o.medianMs });
  }

  for (const n of safeLengths) {
    const input = pair.attack(n);
    const o = await runMatchNode(pair.safeSource, pair.flags, input, timeoutMs, 3);
    rows.push({ pair: pair.id, n, kind: "safe", status: o.status, medianMs: o.medianMs });
  }

  return rows;
}

async function throughputBench(): Promise<Record<string, number>> {
  // tinybench меряет пропускную способность безопасных паттернов на большом
  // (но безопасном для них) входе. Unsafe-паттерны сюда не включаем — они бы
  // повесили процесс.
  const bench = new Bench({ time: 300, warmupTime: 50 });
  for (const pair of PATTERN_PAIRS) {
    const re = new RegExp(pair.safeSource, pair.flags);
    const input = pair.attack(5000);
    bench.add(`${pair.id} (safe, n=5000)`, () => {
      re.test(input);
    });
  }
  await bench.run();

  const out: Record<string, number> = {};
  for (const task of bench.tasks) {
    const r = task.result;
    out[task.name] = r && "throughput" in r ? r.throughput.mean : 0;
  }
  return out;
}

function toCsv(rows: SeriesRow[]): string {
  const header = "pair,n,kind,status,medianMs";
  const lines = rows.map(
    (r) => `${r.pair},${r.n},${r.kind},${r.status},${r.medianMs ?? ""}`,
  );
  return [header, ...lines].join("\n") + "\n";
}

async function main(): Promise<void> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const startedAt = performance.now();

  const allRows: SeriesRow[] = [];
  for (const pair of PATTERN_PAIRS) {
    console.log(`Серия: ${pair.title}`);
    const rows = await measureSeries(pair);
    allRows.push(...rows);
    for (const r of rows) {
      const t = r.medianMs === null ? "TIMEOUT" : `${r.medianMs.toFixed(3)} мс`;
      console.log(`  ${r.kind.padEnd(6)} n=${String(r.n).padStart(6)}  ${t}`);
    }
  }

  console.log("\nПропускная способность (tinybench):");
  const throughput = await throughputBench();
  for (const [name, ops] of Object.entries(throughput)) {
    console.log(`  ${name}: ${ops.toFixed(0)} ops/sec`);
  }

  const timestamp = new Date().toISOString();
  // resourceUsage учитывает и потоки воркеров: они живут в том же процессе.
  const usage = process.resourceUsage();
  const report = {
    env: "node",
    timestamp,
    durationMs: Math.round(performance.now() - startedAt),
    timeoutMs: TIMEOUT_MS,
    system: {
      node: process.version,
      v8: process.versions.v8,
      platform: `${os.platform()}-${os.arch()}`,
      cpu: os.cpus()[0]?.model.trim() || null,
      cores: os.cpus().length,
    },
    process: {
      cpuSec: (usage.userCPUTime + usage.systemCPUTime) / 1e6,
      maxRssBytes: usage.maxRSS * 1024,
    },
    series: allRows,
    throughput,
  };
  await writeFile(`${RESULTS_DIR}bench-node.json`, JSON.stringify(report, null, 2));
  await writeFile(`${RESULTS_DIR}series.csv`, toCsv(allRows));
  console.log(`\nРезультаты записаны в ${RESULTS_DIR}`);

  const baseline = {
    timestamp,
    timeoutMs: TIMEOUT_MS,
    env: {
      cpu: os.cpus()[0]?.model.trim() ?? "unknown",
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
    },
    series: allRows,
  };
  await mkdir(fileURLToPath(new URL("../src/data/", import.meta.url)), { recursive: true });
  await writeFile(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  console.log(`Снимок для лендинга: ${BASELINE_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
