# Воспроизводимый прогон e2e-бенча в изолированном Chromium.
# Базовый образ Playwright уже содержит браузеры и системные зависимости.
FROM mcr.microsoft.com/playwright:v1.63.0-jammy

WORKDIR /app

# Сначала манифесты — чтобы слой с зависимостями кэшировался.
COPY package.json package-lock.json* ./
RUN npm install

# Затем исходники (node_modules с хоста исключён через .dockerignore,
# т.к. содержит бинарники под macOS).
COPY . .

# Прогон бенчмарка: Playwright сам поднимет Vite dev-сервер (webServer).
CMD ["npm", "run", "bench:e2e"]
