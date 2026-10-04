import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import os from "node:os";

const RESULTS_DIR = fileURLToPath(new URL("../results/", import.meta.url));
// Метка среды: "local" для запуска на хосте, "docker" задаёт docker-compose.
const BENCH_ENV = process.env.BENCH_ENV ?? "local";
const TIMEOUT_MS = 2000;

interface Outcome {
  status: "completed" | "timeout";
  medianMs: number | null;
}
interface SeriesPoint {
  n: number;
  unsafe: Outcome;
  safe: Outcome;
}

/** Читает файл cgroup v2; вне контейнера (или на macOS) файлов нет — null. */
async function cgroup(name: string): Promise<string | null> {
  try {
    return (await readFile(`/sys/fs/cgroup/${name}`, "utf8")).trim();
  } catch {
    return null;
  }
}

async function cpuUsageSec(): Promise<number | null> {
  const stat = await cgroup("cpu.stat");
  const usec = stat?.match(/^usage_usec (\d+)/m)?.[1];
  return usec ? Number(usec) / 1e6 : null;
}

async function containerLimits() {
  const cpuMax = await cgroup("cpu.max"); // "100000 100000" = 1 CPU, "max 100000" = без лимита
  const [quota, period] = cpuMax?.split(" ") ?? [];
  const memMax = await cgroup("memory.max");
  const pidsMax = await cgroup("pids.max");
  return {
    cpus: quota && quota !== "max" ? Number(quota) / Number(period) : null,
    memoryBytes: memMax && memMax !== "max" ? Number(memMax) : null,
    pids: pidsMax && pidsMax !== "max" ? Number(pidsMax) : null,
  };
}

test("ReDoS bench в изолированном Chromium", async ({ page, browser }) => {
  await mkdir(RESULTS_DIR, { recursive: true });
  const startedAt = Date.now();
  const cpuBefore = await cpuUsageSec();

  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as unknown as { regexBench?: unknown }).regexBench));

  // CDP-метрики процесса рендерера до прогона.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const metricsBefore = await cdp.send("Performance.getMetrics");

  // Прогоняем серию для каждой пары тем же worker-раннером, что и UI.
  const { results, crossOriginIsolated } = await page.evaluate(async (timeoutMs) => {
    type Pair = { id: string; bench: { unsafe: number; safe: number } };
    const api = (window as unknown as {
      regexBench: {
        PATTERN_PAIRS: Pair[];
        runSeries: (pair: Pair, opts: unknown) => Promise<SeriesPoint[]>;
        seriesLengths: (pair: Pair, maxUnsafe: number, maxSafe: number) => { unsafe: number[]; safe: number[] };
      };
    }).regexBench;

    const out: Record<string, SeriesPoint[]> = {};
    for (const pair of api.PATTERN_PAIRS) {
      const lengths = api.seriesLengths(pair, pair.bench.unsafe, pair.bench.safe);
      out[pair.id] = await api.runSeries(pair, {
        unsafeLengths: lengths.unsafe,
        safeLengths: lengths.safe,
        timeoutMs,
        repeats: 3,
      });
    }
    return { results: out, crossOriginIsolated: window.crossOriginIsolated };
  }, TIMEOUT_MS);

  const metricsAfter = await cdp.send("Performance.getMetrics");
  const cpuAfter = await cpuUsageSec();

  const pick = (metrics: { name: string; value: number }[], name: string): number =>
    metrics.find((m) => m.name === name)?.value ?? 0;

  const report = {
    env: BENCH_ENV,
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    timeoutMs: TIMEOUT_MS,
    system: {
      browser: `Chromium ${browser.version()}`,
      node: process.version,
      platform: `${os.platform()}-${os.arch()}`,
      cpu: os.cpus()[0]?.model.trim() || null,
      cores: os.cpus().length,
      crossOriginIsolated,
    },
    // Для docker: лимиты из cgroup, затраченное CPU-время и пик памяти контейнера.
    container: {
      limits: await containerLimits(),
      cpuSec: cpuBefore !== null && cpuAfter !== null ? cpuAfter - cpuBefore : null,
      memoryPeakBytes: Number(await cgroup("memory.peak")) || null,
    },
    cdp: {
      mainThreadTaskSec:
        pick(metricsAfter.metrics, "TaskDuration") - pick(metricsBefore.metrics, "TaskDuration"),
      jsHeapUsedBytes: pick(metricsAfter.metrics, "JSHeapUsedSize"),
    },
    series: results,
  };

  await writeFile(`${RESULTS_DIR}e2e-${BENCH_ENV}.json`, JSON.stringify(report, null, 2));

  // Проверяем суть демонстрации: у unsafe есть хотя бы один таймаут,
  // либо его худшее время кратно больше безопасного.
  for (const [id, points] of Object.entries(results)) {
    const unsafeTimedOut = points.some((p) => p.unsafe.status === "timeout");
    const unsafeMax = Math.max(0, ...points.map((p) => p.unsafe.medianMs ?? 0));
    const safeMax = Math.max(0.0001, ...points.map((p) => p.safe.medianMs ?? 0));
    expect(
      unsafeTimedOut || unsafeMax > safeMax * 10,
      `Пара ${id}: ожидали таймаут или сильное замедление unsafe`,
    ).toBeTruthy();
  }
});
