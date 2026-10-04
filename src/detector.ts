import { check } from "recheck";

// Обёртка над recheck. В браузере check() использует вшитый worker-бэкенд
// (Scala.js), поэтому анализ не блокирует main thread и не требует настройки.

export interface DetectResult {
  status: "safe" | "vulnerable" | "unknown";
  /** Человекочитаемое описание сложности (recheck summary). */
  complexity: string | null;
  /** Атакующая строка (человекочитаемая), если паттерн уязвим. */
  attackString: string | null;
  /** Сообщение об ошибке разбора/анализа, если есть. */
  error: string | null;
}

export async function detect(source: string, flags: string): Promise<DetectResult> {
  try {
    // recheck принимает source и flags как у RegExp (без слэшей).
    const diagnostics = await check(source, flags);

    if (diagnostics.status === "safe") {
      return {
        status: "safe",
        complexity: diagnostics.complexity.summary,
        attackString: null,
        error: null,
      };
    }

    if (diagnostics.status === "vulnerable") {
      return {
        status: "vulnerable",
        complexity: diagnostics.complexity.summary,
        attackString: diagnostics.attack.pattern,
        error: null,
      };
    }

    // status === "unknown"
    const kind = diagnostics.error.kind;
    const message =
      "message" in diagnostics.error ? diagnostics.error.message : kind;
    return {
      status: "unknown",
      complexity: null,
      attackString: null,
      error: `${kind}: ${message}`,
    };
  } catch (e) {
    return {
      status: "unknown",
      complexity: null,
      attackString: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
