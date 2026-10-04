import { defineConfig, devices } from "@playwright/test";

// Воспроизводимый прогон бенчмарка в изолированном Chromium (собственный
// браузер Playwright). webServer поднимает Vite dev-сервер на время тестов.
export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Отключаем троттлинг фоновых вкладок/таймеров, чтобы замеры были честными.
        launchOptions: {
          args: ["--disable-background-timer-throttling", "--no-sandbox"],
        },
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
