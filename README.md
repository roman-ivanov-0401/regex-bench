# regex-bench — демонстрация влияния ReDoS на производительность

Наглядное сравнение **небезопасного** и **безопасного** регулярных выражений:
как уязвимый паттерн на специально подобранном входе уходит в *catastrophic
backtracking* и блокирует поток, а безопасный аналог обрабатывает тот же вход
мгновенно. Проект включает интерактивный лендинг, живой бенчмарк, детектор
уязвимостей и воспроизводимый прогон в изолированном Chromium внутри Docker.

## Что внутри

- **Лендинг** (Vite + TypeScript): песочница, график «время vs длина входа»,
  демонстрация блокировки UI, детектор уязвимостей, выводы по защите.
- **Детектор** на [`recheck`](https://makenowjust-labs.github.io/recheck/) —
  статический анализ ReDoS прямо в браузере (вшитый worker-бэкенд).
- **Визуализация** на [`chart.js`](https://www.chartjs.org/) с логарифмической
  осью Y (экспонента видна как прямая).
- **Node-бенчмарк** на [`tinybench`](https://github.com/tinylibs/tinybench) +
  `worker_threads` с принудительным завершением по таймауту.
- **E2E-бенчмарк** на [`@playwright/test`](https://playwright.dev/) — прогон в
  собственном Chromium с метриками через CDP (`Performance.getMetrics`).
- **Docker** — тот же e2e-бенч в контейнере с лимитами ресурсов.

## Почему именно так

Синхронный `RegExp.prototype.test()` **блокирует весь поток** и не прерывается
по таймауту в том же потоке. Поэтому уязвимую регулярку всегда исполняем в
изолированном контексте (Web Worker в браузере, `worker_threads` в Node) и
прерываем через `terminate()` — это единственный надёжный способ остановить
catastrophic backtracking.

Dev- и preview-сервер Vite отдают заголовки COOP/COEP: без cross-origin
isolation браузер огрубляет `performance.now()` до 100 мкс, с ней — до 5 мкс.

## Установка

```bash
cd regex-bench
npm install
```

> Для e2e-прогона один раз установите браузер Playwright:
> ```bash
> npm run bench:e2e:install   # playwright install --with-deps chromium
> ```

## Запуск

| Команда | Что делает |
| --- | --- |
| `npm run dev` | Лендинг локально (http://localhost:5173) |
| `npm run build` | Проверка типов + production-сборка в `dist/` |
| `npm run bench:node` | Node-бенчмарк (tinybench), результаты в `results/`; заодно обновляет снимок `src/data/baseline.json`, который лендинг показывает до первого живого прогона |
| `npm run bench:e2e` | Playwright-бенч в своём Chromium, метрики в `results/e2e-local.json` |
| `npm run bench:docker` | Тот же Playwright-бенч внутри Docker с лимитами, `results/e2e-docker.json` |
| `npm run bench:collect` | Сводит три отчёта из `results/` в `src/data/runs.json` для лендинга |
| `npm run bench:all` | Все три прогона подряд + `bench:collect` (около 3 минут) |
| `npm run typecheck` | Только проверка типов |

### Docker (изолированный прогон с лимитами)

Контейнер ограничен `cpus: 1.0`, `mem_limit: 1g`, `pids_limit: 256`
(см. [docker/docker-compose.yml](docker/docker-compose.yml)); результаты
монтируются обратно в `results/`. Лимиты и потребление (CPU-время, пик памяти)
спека читает из cgroup v2 внутри контейнера.

### Результаты прогонов на лендинге

Раздел «Прогоны в трёх средах» строится из `src/data/runs.json`: таблица сред
(движок, лимиты, точность таймера, длительность, CPU, память, CDP), таблица
сравнения по парам и график выбранной пары во всех трёх средах. Выводы над
таблицами вычисляются из данных в [src/runs.ts](src/runs.ts), поэтому после
нового `npm run bench:all` страница обновится сама.

## Размещение

`npm run build` собирает в `dist/` полностью статический сайт с
относительными путями, поэтому его можно выложить и в корень домена, и в
подпапку. Для точного таймера (5 мкс вместо 100 мкс) хостинг должен отдавать
заголовки COOP/COEP: для Netlify и Cloudflare Pages их задаёт `public/_headers`
(копируется в `dist/`), для Vercel — `vercel.json`. На GitHub Pages заголовки
задать нельзя: страница работает, но живые замеры safe будут грубыми.

## Снимаемые метрики

- **Время матчинга** (мс), медиана из N прогонов — по каждой длине входа
  (основная метрика, ось Y лог-шкалы).
- **Длина входа n** — ось X.
- **Статус**: `completed` / `timeout` (отдельная категория «зависаний»).
- **Блокировка main thread** — наглядно через анимацию спиннера; в e2e — через
  CDP `Performance.getMetrics` (`TaskDuration`, `JSHeapUsedSize`).
- **Throughput** (ops/sec) из tinybench на безопасных входах.

## Структура

```
regex-bench/
├── index.html              # разметка лендинга
├── src/
│   ├── patterns.ts         # 11 пар unsafe/safe + атакующие строки и длины для каждой
│   ├── lengths.ts          # длины серий (общие для лендинга, bench-node и e2e)
│   ├── bench/
│   │   ├── protocol.ts     # протокол main <-> worker
│   │   ├── worker.ts       # Web Worker: матчинг в изоляции
│   │   └── runner.ts       # серия замеров с таймаутом/terminate, warm-up, медиана
│   ├── data/baseline.json  # снимок замеров для графика по умолчанию
│   ├── data/runs.json      # сводка прогонов node / local / docker
│   ├── baseline.ts         # превращает снимок в точки графика
│   ├── runs.ts             # раздел «Прогоны в трёх средах»
│   ├── detector.ts         # обёртка над recheck
│   ├── chart.ts            # графики Chart.js (лог-шкала)
│   ├── main.ts             # логика лендинга + хук для e2e
│   └── style.css
├── bench-node/
│   ├── regex-worker.mjs    # worker_threads воркер
│   └── bench.ts            # tinybench + серия, экспорт json/csv
├── e2e/
│   └── bench.spec.ts       # прогон в Chromium + CDP-метрики
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml  # лимиты ресурсов
├── scripts/
│   └── collect-runs.ts     # results/*.json -> src/data/runs.json
└── results/                # результаты прогонов (json/csv)
```

## Как защищаться от ReDoS

- Избегать вложенных квантификаторов и перекрывающихся альтернаций:
  `(a+)+`, `(a|a)*`, `(.*)*`.
- Использовать атомарные группы / possessive-квантификаторы (где движок их
  поддерживает).
- Выполнять матчинг недоверенного ввода с таймаутом в изолированном потоке.
- Прогонять паттерны через линтер (`recheck` и его ESLint-плагин).
- Для недоверенного ввода использовать движок без backtracking — `RE2`.
