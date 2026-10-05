import { PATTERN_PAIRS, getPair } from "./patterns";
import { runMatch, runSeries, type SeriesPoint } from "./bench/runner";
import { seriesLengths } from "./lengths";
import { detect } from "./detector";
import { llmCheck } from "./llm";
import { renderChart } from "./chart";
import { baseline, baselinePoints } from "./baseline";
import { initRuns, showRunsChart } from "./runs";

// Программный хук для воспроизводимого прогона из Playwright (e2e-бенч).
// Даёт доступ к тому же worker-based раннеру, что и UI.
declare global {
  interface Window {
    regexBench: {
      PATTERN_PAIRS: typeof PATTERN_PAIRS;
      getPair: typeof getPair;
      runSeries: typeof runSeries;
      seriesLengths: typeof seriesLengths;
      detect: typeof detect;
    };
  }
}
window.regexBench = { PATTERN_PAIRS, getPair, runSeries, seriesLengths, detect };

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Не найден элемент ${sel}`);
  return el;
};

const fmtMs = (ms: number | null): string =>
  ms === null ? "—" : ms < 1 ? `${(ms * 1000).toFixed(1)} мкс` : `${ms.toFixed(2)} мс`;

// --- Общий индикатор «живости» main thread (крутим спиннеры через rAF) ---
let angle = 0;
const spinnerMain = $<HTMLDivElement>("#spinner-main");
const spinnerWorker = $<HTMLDivElement>("#spinner-worker");
function tick(): void {
  angle = (angle + 6) % 360;
  const t = `rotate(${angle}deg)`;
  spinnerMain.style.transform = t;
  spinnerWorker.style.transform = t;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// --- Песочница ---
const patternSelect = $<HTMLSelectElement>("#pattern-select");
const lenRange = $<HTMLInputElement>("#len-range");
const lenValue = $<HTMLOutputElement>("#len-value");
const timeoutInput = $<HTMLInputElement>("#timeout-input");
const unsafeSrc = $<HTMLElement>("#unsafe-src");
const safeSrc = $<HTMLElement>("#safe-src");
const attackPreview = $<HTMLElement>("#attack-preview");
const singleResult = $<HTMLDivElement>("#single-result");
const benchMaxUnsafe = $<HTMLInputElement>("#bench-max-unsafe");
const benchMaxSafe = $<HTMLInputElement>("#bench-max-safe");

const GROUPS: { growth: "exponential" | "polynomial"; label: string }[] = [
  { growth: "exponential", label: "Экспоненциальный рост" },
  { growth: "polynomial", label: "Полиномиальный рост (реальные инциденты)" },
];
for (const group of GROUPS) {
  const optgroup = document.createElement("optgroup");
  optgroup.label = group.label;
  for (const pair of PATTERN_PAIRS.filter((p) => p.growth === group.growth)) {
    const opt = document.createElement("option");
    opt.value = pair.id;
    opt.textContent = pair.title;
    optgroup.append(opt);
  }
  patternSelect.append(optgroup);
}

function currentPair() {
  return getPair(patternSelect.value);
}

/** Подставляет длины, на которых у выбранной пары виден эффект. */
function applyPairDefaults(): void {
  const pair = currentPair();
  lenRange.max = String(pair.sandbox.max);
  lenRange.value = String(pair.sandbox.n);
  benchMaxUnsafe.value = String(pair.bench.unsafe);
  benchMaxSafe.value = String(pair.bench.safe);
}

function refreshPatternPreview(): void {
  const pair = currentPair();
  const n = Number(lenRange.value);
  lenValue.textContent = String(n);
  unsafeSrc.textContent = `/${pair.unsafeSource}/${pair.flags}`;
  safeSrc.textContent = `/${pair.safeSource}/${pair.flags}`;
  const atk = pair.attack(n);
  attackPreview.textContent =
    atk.length > 48 ? `${JSON.stringify(atk.slice(0, 48))}… (${atk.length} симв.)` : JSON.stringify(atk);
}

patternSelect.addEventListener("change", () => {
  applyPairDefaults();
  refreshPatternPreview();
  singleResult.innerHTML = "";
  showChart();
  showRunsChart(patternSelect.value);
});
lenRange.addEventListener("input", refreshPatternPreview);
applyPairDefaults();
refreshPatternPreview();

$<HTMLButtonElement>("#run-single").addEventListener("click", async () => {
  const pair = currentPair();
  const n = Number(lenRange.value);
  const timeoutMs = Number(timeoutInput.value);
  const input = pair.attack(n);
  singleResult.innerHTML = `<div class="muted">Выполняется (n=${n})…</div>`;

  const [unsafe, safe] = await Promise.all([
    runMatch(pair.unsafeSource, pair.flags, input, { timeoutMs, repeats: 1 }),
    runMatch(pair.safeSource, pair.flags, input, { timeoutMs, repeats: 1 }),
  ]);

  const cell = (label: string, o: typeof unsafe, cls: string) => `
    <div class="result ${cls}">
      <div class="result-label">${label}</div>
      <div class="result-time">${o.status === "timeout" ? `> ${timeoutMs} мс (таймаут)` : fmtMs(o.medianMs)}</div>
      <div class="muted small">${o.status === "timeout" ? "поток был бы заблокирован" : `matched: ${o.matched}`}</div>
    </div>`;
  singleResult.innerHTML = cell(`unsafe /${pair.unsafeSource}/`, unsafe, "unsafe") +
    cell(`safe /${pair.safeSource}/`, safe, "safe") +
    `<div class="result note"><div class="muted small">${pair.note}</div></div>`;
});

// --- Бенчмарк ---
const benchProgress = $<HTMLDivElement>("#bench-progress");
const benchChart = $<HTMLCanvasElement>("#bench-chart");
const benchSource = $<HTMLParagraphElement>("#bench-source");
const liveRuns = new Map<string, { points: SeriesPoint[]; timeoutMs: number; at: Date }>();

const fmtDate = (d: Date): string =>
  d.toLocaleString("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

function showChart(): void {
  const pair = currentPair();
  const live = liveRuns.get(pair.id);
  if (live) {
    renderChart(benchChart, live.points, live.timeoutMs);
    benchSource.textContent =
      `Живой прогон в этом браузере, ${fmtDate(live.at)}. Таймаут ${live.timeoutMs} мс.`;
    return;
  }
  renderChart(benchChart, baselinePoints(pair.id), baseline.timeoutMs);
  const { cpu, node, platform } = baseline.env;
  benchSource.textContent =
    `Снимок из npm run bench:node: ${cpu}, Node ${node} (${platform}), ` +
    `${fmtDate(new Date(baseline.timestamp))}. Таймаут ${baseline.timeoutMs} мс. ` +
    `Кнопка выше перемерит то же самое в вашем браузере.`;
}

$<HTMLButtonElement>("#run-bench").addEventListener("click", async () => {
  const pair = currentPair();
  const timeoutMs = Number(timeoutInput.value);
  const repeats = Number($<HTMLInputElement>("#bench-repeats").value);
  const maxUnsafe = Number(benchMaxUnsafe.value);
  const maxSafe = Number(benchMaxSafe.value);
  const lengths = seriesLengths(pair, maxUnsafe, maxSafe);

  benchProgress.textContent = "Запуск…";
  const points = await runSeries(pair, {
    unsafeLengths: lengths.unsafe,
    safeLengths: lengths.safe,
    timeoutMs,
    repeats,
    onProgress: (done, total, label) => {
      benchProgress.textContent = `Прогресс: ${done}/${total} (${label})`;
    },
  });
  benchProgress.textContent = `Готово. Точек: ${points.length}. Таймаутов unsafe: ${points.filter((p) => p.unsafe.status === "timeout").length}.`;
  liveRuns.set(pair.id, { points, timeoutMs, at: new Date() });
  showChart();
});

showChart();

// --- Прогоны в трёх средах ---
initRuns();
showRunsChart(patternSelect.value);

// --- Демо блокировки UI ---
const blockMainStatus = $<HTMLParagraphElement>("#block-main-status");
const blockWorkerStatus = $<HTMLParagraphElement>("#block-worker-status");

$<HTMLButtonElement>("#block-main").addEventListener("click", () => {
  const pair = currentPair();
  const input = pair.attack(pair.blockN);
  blockMainStatus.textContent = `Запуск в main thread (n=${pair.blockN})… спиннер замрёт.`;
  // Даём браузеру отрисовать статус перед блокирующим вызовом.
  setTimeout(() => {
    const re = new RegExp(pair.unsafeSource, pair.flags);
    // Без прогрева V8 исполняет регулярку интерпретатором, и зависание длится в разы дольше.
    re.test(input.slice(0, 4));
    re.test(input.slice(0, 4));
    const start = performance.now();
    re.test(input); // синхронно блокирует main thread
    const elapsed = performance.now() - start;
    blockMainStatus.textContent = `Main thread был заблокирован ${elapsed.toFixed(0)} мс — всё это время страница не отвечала.`;
  }, 50);
});

$<HTMLButtonElement>("#block-worker").addEventListener("click", async () => {
  const pair = currentPair();
  const input = pair.attack(pair.blockN);
  blockWorkerStatus.textContent = `Запуск в воркере (n=${pair.blockN})… спиннер продолжает крутиться.`;
  const outcome = await runMatch(pair.unsafeSource, pair.flags, input, {
    timeoutMs: 10000,
    repeats: 1,
  });
  blockWorkerStatus.textContent =
    outcome.status === "timeout"
      ? "Воркер превысил таймаут и был завершён — UI всё это время оставался живым."
      : `Готово за ${fmtMs(outcome.medianMs)}; UI ни на миг не замирал.`;
});

// --- Детектор ---
const detectResult = $<HTMLDivElement>("#detect-result");
$<HTMLButtonElement>("#run-detect").addEventListener("click", async () => {
  const source = $<HTMLInputElement>("#detect-source").value;
  const flags = $<HTMLInputElement>("#detect-flags").value;
  detectResult.innerHTML = `<div class="muted">Анализ recheck…</div>`;
  const r = await detect(source, flags);
  const badge =
    r.status === "vulnerable" ? "unsafe" : r.status === "safe" ? "safe" : "note";
  detectResult.innerHTML = `
    <div class="result ${badge}">
      <div class="result-label">вердикт</div>
      <div class="result-time">${r.status.toUpperCase()}</div>
    </div>
    <div class="result note">
      <div class="muted small">сложность: ${r.complexity ?? "—"}</div>
      <div class="muted small">атака: ${r.attackString ? JSON.stringify(r.attackString) : "—"}</div>
      ${r.error ? `<div class="muted small">ошибка: ${r.error}</div>` : ""}
    </div>`;
});

// --- Проверка языковой моделью ---
const llmForm = $<HTMLFormElement>("#llm-form");
const llmSource = $<HTMLInputElement>("#llm-source");
const llmButton = $<HTMLButtonElement>("#run-llm");
const llmResult = $<HTMLDivElement>("#llm-result");

const el = (tag: string, cls: string, text = ""): HTMLElement => {
  const node = document.createElement(tag);
  node.className = cls;
  node.textContent = text; // ответ модели вставляем только как текст
  return node;
};

/** Текст ответа модели: `код` превращаем в <code>, формулы $…$ — в обычный текст. */
const richText = (cls: string, text: string): HTMLElement => {
  const node = el("div", cls);
  text.replace(/\$([^$]+)\$/g, "$1").split(/`([^`]+)`/).forEach((part, i) => {
    node.append(i % 2 ? el("code", "", part) : document.createTextNode(part));
  });
  return node;
};

llmForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const source = llmSource.value;
  llmButton.disabled = true;
  llmSource.disabled = true;
  llmResult.hidden = false;

  const loader = el("div", "llm-loading");
  const bar = el("div", "llm-bar");
  const status = el("div", "llm-status muted", "Модель анализирует паттерн… 0 с");
  loader.append(bar, status);
  llmResult.replaceChildren(loader);
  const started = performance.now();
  const ticker = setInterval(() => {
    const s = Math.floor((performance.now() - started) / 1000);
    status.textContent = `Модель анализирует паттерн… ${s} с`;
  }, 250);

  try {
    const r = await llmCheck(source);
    const cls = r.vulnerable === true ? "unsafe" : r.vulnerable === false ? "safe" : "note";
    const verdict = r.vulnerable === true ? "УЯЗВИМ" : r.vulnerable === false ? "БЕЗОПАСЕН" : "НЕЯСНО";
    const head = el("div", `result ${cls}`);
    head.append(el("div", "result-label", `вердикт для /${source}/`), el("div", "result-time", verdict));
    const note = el("div", "result note");
    note.append(richText("llm-reason", r.reason));
    llmResult.replaceChildren(head, note);
  } catch (e) {
    const err = el("div", "result llm-error");
    err.append(
      el("div", "result-label", "ошибка"),
      el("div", "llm-reason", e instanceof Error ? e.message : String(e)),
    );
    llmResult.replaceChildren(err);
  } finally {
    clearInterval(ticker);
    llmButton.disabled = false;
    llmSource.disabled = false;
  }
});
