// Проверка паттерна языковой моделью через внешний API (Gemini с fallback на Groq).
// API отвечает в формате «ReDoS: да/нет\nПричина: …», ответ разбираем на вердикт и причину.

const API_URL = "https://iorkss.online:9204/generate";
const TIMEOUT_MS = 60_000;

export interface LlmResult {
  /** true — уязвим, false — безопасен, null — модель ответила не по формату. */
  vulnerable: boolean | null;
  reason: string;
  raw: string;
}

export async function llmCheck(source: string): Promise<LlmResult> {
  const url = `${API_URL}?${new URLSearchParams({ text: source })}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`сервер не ответил за ${TIMEOUT_MS / 1000} с`);
    }
    throw new Error("не удалось связаться с сервером (сеть или CORS)");
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => ({}))) as {
    answer?: string;
    error?: string;
    message?: string;
  };
  if (res.status === 429) {
    throw new Error("превышен лимит: не больше 5 запросов в минуту, попробуйте чуть позже");
  }
  if (!res.ok || typeof body.answer !== "string") {
    throw new Error(`HTTP ${res.status}: ${body.error ?? body.message ?? res.statusText}`);
  }

  const raw = body.answer.trim();
  const verdict = raw.match(/ReDoS\s*:\s*(да|нет)/i);
  const reason = raw.match(/Причина\s*:\s*([\s\S]*)/i);
  return {
    vulnerable: verdict ? verdict[1].toLowerCase() === "да" : null,
    reason: reason ? reason[1].trim().replace(/:$/, "") : raw,
    raw,
  };
}
