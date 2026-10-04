import { defineConfig } from "vite";

// recheck ships an inline-bundled worker backend and relies on its `browser`
// field in package.json; Vite resolves that automatically. We only need to make
// sure the worker format is ES modules so Vite can bundle our own worker too.
// Без cross-origin isolation браузер огрубляет performance.now() до 100 мкс
// (защита от Spectre); с этими заголовками точность — 5 мкс.
const isolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  root: ".",
  // Относительные пути: dist можно выложить и в корень домена, и в подпапку.
  base: "./",
  server: { headers: isolationHeaders },
  preview: { headers: isolationHeaders },
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
