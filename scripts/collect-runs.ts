// Собирает результаты трёх сред (bench:node, bench:e2e локально и в Docker)
// в один снимок src/data/runs.json, который показывает лендинг.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
const OUT_PATH = fileURLToPath(new URL("../src/data/runs.json", import.meta.url));

interface Row {
  pair: string;
  n: number;
  kind: "unsafe" | "safe";
  status: "completed" | "timeout";
  medianMs: number | null;
}

interface Outcome {
  status: "completed" | "timeout";
  medianMs: number | null;
}

async function readJson<T>(name: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(`${RESULTS_DIR}${name}`, "utf8")) as T;
  } catch {
    console.warn(`  нет ${name} — среда пропущена`);
    return null;
  }
}

const round = (ms: number | null): number | null =>
  ms === null ? null : Number(ms.toPrecision(4));

function compactRows(rows: Row[]): Row[] {
  return rows.map((r) => ({ ...r, medianMs: round(r.medianMs) }));
}

/** e2e хранит серию как точки {n, unsafe, safe}; приводим к строкам как у bench-node. */
function e2eRows(series: Record<string, { n: number; unsafe: Outcome; safe: Outcome }[]>): Row[] {
  const rows: Row[] = [];
  for (const [pair, points] of Object.entries(series)) {
    for (const p of points) {
      if (p.unsafe.status === "timeout" || p.unsafe.medianMs !== null) {
        rows.push({ pair, n: p.n, kind: "unsafe", status: p.unsafe.status, medianMs: p.unsafe.medianMs });
      }
      if (p.safe.medianMs !== null) {
        rows.push({ pair, n: p.n, kind: "safe", status: p.safe.status, medianMs: p.safe.medianMs });
      }
    }
  }
  return compactRows(rows);
}

interface NodeReport {
  timestamp: string;
  durationMs: number;
  timeoutMs: number;
  system: { node: string; v8: string; platform: string; cpu: string | null; cores: number };
  process: { cpuSec: number; maxRssBytes: number };
  series: Row[];
  throughput: Record<string, number>;
}

interface E2eReport {
  timestamp: string;
  durationMs: number;
  timeoutMs: number;
  system: {
    browser: string;
    node: string;
    platform: string;
    cpu: string | null;
    cores: number;
    crossOriginIsolated: boolean;
  };
  container: {
    limits: { cpus: number | null; memoryBytes: number | null; pids: number | null };
    cpuSec: number | null;
    memoryPeakBytes: number | null;
  };
  cdp: { mainThreadTaskSec: number; jsHeapUsedBytes: number };
  series: Record<string, { n: number; unsafe: Outcome; safe: Outcome }[]>;
}

async function main(): Promise<void> {
  const runs = [];

  const node = await readJson<NodeReport>("bench-node.json");
  if (node) {
    runs.push({
      id: "node",
      title: "Node.js",
      runner: "npm run bench:node",
      isolation: "worker_threads + terminate()",
      engine: `Node ${node.system.node}, V8 ${node.system.v8}`,
      platform: node.system.platform,
      cpu: node.system.cpu,
      cores: node.system.cores,
      limits: null,
      timestamp: node.timestamp,
      durationMs: node.durationMs,
      timeoutMs: node.timeoutMs,
      cpuSec: node.process.cpuSec,
      memoryPeakBytes: node.process.maxRssBytes,
      throughput: node.throughput,
      series: compactRows(node.series),
    });
  }

  for (const [env, title, runner] of [
    ["local", "Chromium (Playwright)", "npm run bench:e2e"],
    ["docker", "Chromium в Docker", "docker compose up"],
  ] as const) {
    const r = await readJson<E2eReport>(`e2e-${env}.json`);
    if (!r) continue;
    const limits = r.container.limits;
    runs.push({
      id: env,
      title,
      runner,
      isolation: "headless Chromium, Web Worker + terminate()",
      engine: r.system.browser,
      platform: r.system.platform,
      cpu: r.system.cpu,
      cores: r.system.cores,
      limits: limits.cpus || limits.memoryBytes || limits.pids ? limits : null,
      timestamp: r.timestamp,
      durationMs: r.durationMs,
      timeoutMs: r.timeoutMs,
      cpuSec: r.container.cpuSec,
      memoryPeakBytes: r.container.memoryPeakBytes,
      mainThreadTaskSec: r.cdp.mainThreadTaskSec,
      jsHeapUsedBytes: r.cdp.jsHeapUsedBytes,
      crossOriginIsolated: r.system.crossOriginIsolated,
      series: e2eRows(r.series),
    });
  }

  await writeFile(OUT_PATH, JSON.stringify({ collectedAt: new Date().toISOString(), runs }) + "\n");
  console.log(`Собрано сред: ${runs.length} → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
