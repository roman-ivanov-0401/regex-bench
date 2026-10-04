import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Tooltip,
  Legend,
  Title,
  type ChartDataset,
} from "chart.js";
import type { SeriesPoint } from "./bench/runner";

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Tooltip,
  Legend,
  Title,
);

Chart.defaults.font.family = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, monospace';
Chart.defaults.font.size = 11;
Chart.defaults.color = "#55534e";
Chart.defaults.borderColor = "#e3dfd5";

const charts = new Map<HTMLCanvasElement, Chart>();

const UNSAFE_COLOR = "#a8322a";
const SAFE_COLOR = "#2e6b4f";

// Логарифмическая шкала не умеет 0; заменяем совсем маленькие значения полом,
// чтобы точки не пропадали с графика. Ниже 1 мкс таймер всё равно не различает.
const FLOOR_MS = 0.001;

const isPow10 = (v: number): boolean => {
  const l = Math.log10(v);
  return Math.abs(l - Math.round(l)) < 1e-9;
};

const decadeGrid = {
  color: (ctx: { tick?: { value: number } }) =>
    ctx.tick && isPow10(ctx.tick.value) ? "#e3dfd5" : "transparent",
};

function fmtTickMs(v: number): string {
  if (v <= FLOOR_MS) return "≤ 1 мкс";
  if (v >= 1000) return `${v / 1000} с`;
  if (v >= 1) return `${v} мс`;
  return `${Math.round(v * 1000)} мкс`;
}

function toXY(
  points: SeriesPoint[],
  pick: (p: SeriesPoint) => number | null,
): { x: number; y: number }[] {
  return points
    .map((p) => {
      const v = pick(p);
      if (v === null) return null;
      return { x: p.n, y: Math.max(v, FLOOR_MS) };
    })
    .filter((v): v is { x: number; y: number } => v !== null);
}

/** Точки, где unsafe упёрся в таймаут (рисуем крестами на уровне таймаута). */
function timeoutXY(
  points: SeriesPoint[],
  timeoutMs: number,
): { x: number; y: number }[] {
  return points
    .filter((p) => p.unsafe.status === "timeout")
    .map((p) => ({ x: p.n, y: timeoutMs }));
}

export function renderChart(
  canvas: HTMLCanvasElement,
  points: SeriesPoint[],
  timeoutMs: number,
): void {
  const unsafeData = toXY(points, (p) => p.unsafe.medianMs);
  const safeData = toXY(points, (p) => p.safe.medianMs);
  const timeouts = timeoutXY(points, timeoutMs);

  draw(canvas, [
    line("unsafe, медиана", unsafeData, UNSAFE_COLOR, []),
    line("safe, медиана", safeData, SAFE_COLOR, [4, 3]),
    {
      label: "unsafe, таймаут",
      data: timeouts,
      borderColor: "#1d1d1b",
      backgroundColor: "#1d1d1b",
      showLine: false,
      pointStyle: "crossRot",
      pointRadius: 6,
      pointBorderWidth: 1.5,
    },
  ]);
}

const ENV_DASHES: number[][] = [[], [6, 3], [1.5, 2.5]];

/**
 * Одна пара в нескольких средах: цвет — unsafe/safe, штрих — среда.
 * Кривая unsafe обрывается на первом таймауте.
 */
export function renderEnvChart(
  canvas: HTMLCanvasElement,
  envs: { label: string; points: SeriesPoint[] }[],
): void {
  const datasets = envs.flatMap((env, i) => {
    const dash = ENV_DASHES[i % ENV_DASHES.length];
    const radius = dash.length ? 0 : 2;
    return [
      line(`unsafe · ${env.label}`, toXY(env.points, (p) => p.unsafe.medianMs), UNSAFE_COLOR, dash, radius),
      line(`safe · ${env.label}`, toXY(env.points, (p) => p.safe.medianMs), SAFE_COLOR, dash, radius),
    ];
  });
  draw(canvas, datasets);
}

type XYDataset = ChartDataset<"line", { x: number; y: number }[]>;

function line(
  label: string,
  data: { x: number; y: number }[],
  color: string,
  dash: number[],
  pointRadius = 2,
): XYDataset {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color,
    borderWidth: 1.5,
    borderDash: dash,
    tension: 0,
    pointRadius,
  };
}

function draw(canvas: HTMLCanvasElement, datasets: XYDataset[]): void {
  charts.get(canvas)?.destroy();

  charts.set(canvas, new Chart(canvas, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      animation: false,
      scales: {
        // Лог-шкала по X: unsafe живёт на n ≤ 30, safe — до десятков тысяч.
        x: {
          type: "logarithmic",
          title: { display: true, text: "длина входа n, символов" },
          grid: decadeGrid,
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            callback: (value) =>
              isPow10(Number(value)) ? Number(value).toLocaleString("ru-RU") : "",
          },
        },
        y: {
          type: "logarithmic",
          min: FLOOR_MS,
          title: { display: true, text: "время матчинга" },
          grid: decadeGrid,
          ticks: {
            autoSkip: false,
            callback: (value) => (isPow10(Number(value)) ? fmtTickMs(Number(value)) : ""),
          },
        },
      },
      plugins: {
        legend: {
          position: "top",
          align: "start",
          labels: { boxWidth: 14, boxHeight: 1 },
        },
        title: { display: false },
      },
    },
  }));
}
