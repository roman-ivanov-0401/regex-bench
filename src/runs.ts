import raw from "./data/runs.json";
import { PATTERN_PAIRS, getPair } from "./patterns";
import { rowsToPoints, type ResultRow } from "./baseline";
import { renderEnvChart } from "./chart";

// Раздел «Прогоны в трёх средах»: снимок `npm run bench:all`, собранный
// scripts/collect-runs.ts в src/data/runs.json.

interface Run {
  id: "node" | "local" | "docker";
  title: string;
  runner: string;
  isolation: string;
  engine: string;
  platform: string;
  cpu: string | null;
  cores: number;
  limits: { cpus: number | null; memoryBytes: number | null; pids: number | null } | null;
  timestamp: string;
  durationMs: number;
  timeoutMs: number;
  cpuSec: number | null;
  memoryPeakBytes: number | null;
  mainThreadTaskSec?: number;
  jsHeapUsedBytes?: number;
  crossOriginIsolated?: boolean;
  throughput?: Record<string, number>;
  series: ResultRow[];
}

const runs = (raw as unknown as { runs: Run[] }).runs;
const byId = (id: Run["id"]): Run | undefined => runs.find((r) => r.id === id);

const SHORT: Record<Run["id"], string> = { node: "Node", local: "Chromium", docker: "Docker" };

const fmtMs = (ms: number): string => {
  if (ms >= 1000) return `${Number((ms / 1000).toFixed(2))} с`;
  if (ms >= 1) return `${ms.toFixed(ms >= 100 ? 0 : 1)} мс`;
  const us = ms * 1000;
  return `${us.toFixed(us >= 10 ? 0 : 1)} мкс`;
};
const fmtMb = (bytes: number): string =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(bytes % 1024 ** 3 ? 1 : 0)} ГБ` : `${Math.round(bytes / 1024 ** 2)} МБ`;
const fmtDuration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)} мин ${s % 60} с` : `${s} с`;
};
const fmtInt = (v: number): string => Math.round(v).toLocaleString("ru-RU");
/** Кратность: safe здесь у предела таймера, поэтому важен только порядок. */
const fmtTimes = (k: number): string =>
  k >= 1e6 ? `×${(k / 1e6).toFixed(1)} млн` : k >= 1e3 ? `×${(k / 1e3).toFixed(1)} тыс.` : `×${Math.round(k)}`;
const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function unsafeAt(run: Run, pair: string, n: number): number | null {
  return run.series.find((r) => r.pair === pair && r.kind === "unsafe" && r.n === n)?.medianMs ?? null;
}
function safeAt(run: Run, pair: string, n: number): number | null {
  return run.series.find((r) => r.pair === pair && r.kind === "safe" && r.n === n)?.medianMs ?? null;
}

/** Наибольшая длина, на которой unsafe уложился в таймаут во всех средах. */
function referenceN(pair: string, among: Run[] = runs): number | null {
  const sets = among.map(
    (run) => new Set(run.series.filter((r) => r.pair === pair && r.kind === "unsafe" && r.medianMs !== null).map((r) => r.n)),
  );
  const common = [...sets[0]].filter((n) => sets.every((s) => s.has(n)));
  return common.length ? Math.max(...common) : null;
}

function findings(): string[] {
  const out: string[] = [];
  const node = byId("node");
  const local = byId("local");
  const docker = byId("docker");

  const measured = runs.reduce((acc, r) => acc + r.series.filter((x) => x.medianMs !== null).length, 0);
  const timeouts = runs.reduce((acc, r) => acc + r.series.filter((x) => x.status === "timeout").length, 0);
  const total = runs.reduce((acc, r) => acc + r.durationMs, 0);
  const allTimedOut = runs.every((r) =>
    PATTERN_PAIRS.every((p) => r.series.some((x) => x.pair === p.id && x.kind === "unsafe" && x.status === "timeout")),
  );
  const slowestSafe = Math.max(
    ...runs.flatMap((r) => r.series.filter((x) => x.kind === "safe" && x.medianMs !== null).map((x) => x.medianMs!)),
  );
  out.push(
    `${runs.length} среды, ${PATTERN_PAIRS.length} пар паттернов: ${fmtInt(measured)} замеров и ${timeouts} таймаутов, ` +
      `общее время прогонов — ${fmtDuration(total)}. ` +
      (allTimedOut ? `Каждый unsafe-паттерн в каждой среде дошёл до таймаута ${fmtMs(runs[0].timeoutMs)}, ` : "") +
      `а самый медленный замер safe — ${fmtMs(slowestSafe)}.`,
  );

  if (local && docker) {
    const ratios = PATTERN_PAIRS.map((p) => {
      const n = referenceN(p.id, [local, docker]);
      const a = n === null ? null : unsafeAt(local, p.id, n);
      const b = n === null ? null : unsafeAt(docker, p.id, n);
      return a && b ? b / a : null;
    }).filter((x): x is number => x !== null);
    const pct = Math.round((median(ratios) - 1) * 100);
    const cpus = docker.limits?.cpus;
    out.push(
      `Docker ${pct >= 0 ? `медленнее локального Chromium на ${pct}% (медиана по парам)` : `быстрее локального Chromium на ${-pct}%`}` +
        (cpus ? `: контейнеру выделено ${cpus} CPU, и на нём же работают Vite, Playwright и сам браузер.` : "."),
    );
    if (docker.memoryPeakBytes && docker.limits?.memoryBytes) {
      const share = Math.round((docker.memoryPeakBytes / docker.limits.memoryBytes) * 100);
      out.push(
        `Пик памяти контейнера — ${fmtMb(docker.memoryPeakBytes)} из ${fmtMb(docker.limits.memoryBytes)} (${share}% лимита). ` +
          (docker.jsHeapUsedBytes
            ? `Это не регулярки: JS-куча страницы после прогона — ${fmtMb(docker.jsHeapUsedBytes)}, остальное занимают браузер, Vite и Playwright.`
            : `Почти всё это — браузер, Vite и Playwright.`),
      );
    }
    if (local.mainThreadTaskSec && docker.mainThreadTaskSec) {
      const k = docker.mainThreadTaskSec / local.mainThreadTaskSec;
      out.push(
        `Главный поток страницы в контейнере был занят в ${k.toFixed(1)} раза дольше (` +
          `${docker.mainThreadTaskSec.toFixed(1)} с против ${local.mainThreadTaskSec.toFixed(1)} с по CDP TaskDuration): ` +
          `скорее всего, потому что на одном ядре он делит процессор с воркерами, которые крутят регулярки.`,
      );
    }
  }

  if (node && local) {
    const diverged = PATTERN_PAIRS.filter((p) => {
      const n = referenceN(p.id, [node, local]);
      const a = n === null ? null : unsafeAt(node, p.id, n);
      const b = n === null ? null : unsafeAt(local, p.id, n);
      return a && b && (a / b > 1.5 || b / a > 1.5);
    });
    out.push(
      `Node и Chromium дают близкие цифры — в обоих V8` +
        (diverged.length
          ? `, кроме ${diverged.length === 1 ? "пары" : "пар"} «${diverged.map((p) => p.title).join("», «")}»: версии V8 разные (${node.engine.split(", ")[1]} в Node и та, что в ${local.engine}), и оптимизации регулярок у них отличаются.`
          : "."),
    );
  }
  return out;
}

function envTable(): string {
  const cell = (fn: (r: Run) => string) => runs.map((r) => `<td>${fn(r)}</td>`).join("");
  const rows: [string, (r: Run) => string][] = [
    ["Команда", (r) => `<code>${r.runner}</code>`],
    ["Изоляция", (r) => r.isolation],
    ["Движок", (r) => r.engine],
    ["Платформа", (r) => [r.platform, r.cpu !== "unknown" && r.cpu].filter(Boolean).join(", ")],
    [
      "Ограничения",
      (r) =>
        r.limits
          ? [r.limits.cpus && `${r.limits.cpus} CPU`, r.limits.memoryBytes && `${fmtMb(r.limits.memoryBytes)} RAM`, r.limits.pids && `${r.limits.pids} процессов`]
              .filter(Boolean)
              .join(", ")
          : "нет",
    ],
    ["Таймаут", (r) => fmtMs(r.timeoutMs)],
    [
      "Точность таймера",
      (r) => (r.id === "node" ? "доли мкс" : r.crossOriginIsolated ? "5 мкс (cross-origin isolated)" : "100 мкс"),
    ],
    ["Длительность", (r) => fmtDuration(r.durationMs)],
    [
      "CPU-время",
      (r) => {
        if (r.cpuSec === null) return `<span class="muted">— (cgroup есть только в контейнере)</span>`;
        const sec = r.durationMs / 1000;
        const note = r.limits?.cpus
          ? `${Math.round((r.cpuSec / (sec * r.limits.cpus)) * 100)}% лимита`
          : `≈ ${(r.cpuSec / sec).toFixed(1)} ядра в среднем`;
        return `${r.cpuSec.toFixed(0)} с (${note})`;
      },
    ],
    [
      "Пик памяти",
      (r) =>
        r.memoryPeakBytes === null
          ? `<span class="muted">—</span>`
          : `${fmtMb(r.memoryPeakBytes)} ${r.id === "node" ? "(RSS процесса)" : "(cgroup контейнера)"}`,
    ],
    [
      "Main thread, CDP",
      (r) => (r.mainThreadTaskSec === undefined ? `<span class="muted">—</span>` : `${r.mainThreadTaskSec.toFixed(1)} с`),
    ],
    [
      "Замеров / таймаутов",
      (r) => `${r.series.filter((x) => x.medianMs !== null).length} / ${r.series.filter((x) => x.status === "timeout").length}`,
    ],
    ["Когда", (r) => fmtDate(r.timestamp)],
  ];
  return (
    `<thead><tr><th></th>${runs.map((r) => `<th>${r.title}</th>`).join("")}</tr></thead>` +
    `<tbody>${rows.map(([label, fn]) => `<tr><th>${label}</th>${cell(fn)}</tr>`).join("")}</tbody>`
  );
}

function pairsTable(): string {
  const node = byId("node");
  const head =
    `<thead><tr><th>Пара</th><th class="num">n</th>` +
    runs.map((r) => `<th class="num">${SHORT[r.id]}</th>`).join("") +
    `<th class="num">safe</th><th class="num">разница</th>` +
    (node?.throughput ? `<th class="num">safe, оп/с</th>` : "") +
    `</tr></thead>`;

  const body = PATTERN_PAIRS.map((p) => {
    const n = referenceN(p.id);
    if (n === null) return "";
    const unsafeCells = runs.map((r) => {
      const v = unsafeAt(r, p.id, n);
      return `<td class="num unsafe">${v === null ? "—" : fmtMs(v)}</td>`;
    });
    const ref = node ?? runs[0];
    const s = safeAt(ref, p.id, n);
    const u = unsafeAt(ref, p.id, n);
    const ratio = s && u ? fmtTimes(u / Math.max(s, 0.001)) : "—";
    const ops = node?.throughput?.[`${p.id} (safe, n=5000)`];
    return (
      `<tr><td>${p.title}</td><td class="num">${fmtInt(n)}</td>${unsafeCells.join("")}` +
      `<td class="num safe">${s === null ? "—" : fmtMs(s)}</td><td class="num">${ratio}</td>` +
      (node?.throughput ? `<td class="num">${ops ? fmtInt(ops) : "—"}</td>` : "") +
      `</tr>`
    );
  }).join("");
  return head + `<tbody>${body}</tbody>`;
}

export function initRuns(): void {
  const section = document.querySelector<HTMLElement>("#runs");
  if (!section) return;
  if (!runs.length) {
    section.querySelector("#runs-findings")!.innerHTML =
      `<li>Снимок пуст: запустите <code>npm run bench:all</code>.</li>`;
    return;
  }
  section.querySelector("#runs-findings")!.innerHTML = findings().map((f) => `<li>${f}</li>`).join("");
  section.querySelector("#runs-envs")!.innerHTML = envTable();
  section.querySelector("#runs-pairs")!.innerHTML = pairsTable();
}

export function showRunsChart(pairId: string): void {
  const canvas = document.querySelector<HTMLCanvasElement>("#runs-chart");
  const caption = document.querySelector<HTMLElement>("#runs-caption");
  if (!canvas || !caption || !runs.length) return;
  renderEnvChart(
    canvas,
    runs.map((r) => ({ label: SHORT[r.id], points: rowsToPoints(r.series, pairId) })),
  );
  caption.textContent =
    `Пара «${getPair(pairId).title}» — выбирается в песочнице выше. ` +
    `Сплошная линия — Node, штрих — Chromium, точки — Docker; кривая unsafe обрывается на первом таймауте.`;
}
