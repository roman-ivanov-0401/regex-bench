// Протокол обмена между main thread и Web Worker, выполняющим матчинг.

export interface MatchRequest {
  kind: "match";
  requestId: number;
  source: string;
  flags: string;
  input: string;
  /** Сколько раз прогнать матчинг (для усреднения/медианы на быстрых входах). */
  repeats: number;
}

export interface MatchResponse {
  kind: "result";
  requestId: number;
  /** Медиана времени одного матчинга, мс. */
  medianMs: number;
  /** Все замеры, мс. */
  samplesMs: number[];
  /** Результат matched для контроля, что движок реально что-то считал. */
  matched: boolean;
}

export type WorkerIn = MatchRequest;
export type WorkerOut = MatchResponse;
