// Пары "небезопасный / безопасный" паттерн и генераторы атакующих строк.
//
// Небезопасные паттерны содержат вложенные квантификаторы или перекрывающиеся
// альтернации, из-за чего на специально подобранном входе движок уходит в
// catastrophic backtracking. Безопасный паттерн из пары принимает ровно те же
// строки, но без экспоненциального (или полиномиального) перебора.
//
// Длины подобраны по замерам V8 на Apple M1 Pro: blockN — примерно секунда
// работы unsafe-паттерна на прогретой регулярке в Chromium (Node бывает медленнее).

export interface PatternPair {
  id: string;
  title: string;
  /** Небезопасное выражение (source для RegExp, без слэшей). */
  unsafeSource: string;
  /** Безопасный эквивалент. */
  safeSource: string;
  flags: string;
  growth: "exponential" | "polynomial";
  /** Короткое пояснение, почему unsafe-вариант уязвим. */
  note: string;
  /**
   * Строит атакующий вход длины n: такой, на котором unsafe-паттерн
   * максимально долго перебирает варианты (обычно совпадение почти проходит,
   * но ломается на последнем символе).
   */
  attack: (n: number) => string;
  /** Длина по умолчанию и максимум слайдера в песочнице. */
  sandbox: { n: number; max: number };
  /** Максимальные длины по умолчанию для серии замеров. */
  bench: { unsafe: number; safe: number };
  /** Длина для демо блокировки main thread. */
  blockN: number;
}

const tailBang = (ch: string) => (n: number) => ch.repeat(Math.max(0, n - 1)) + "!";

export const PATTERN_PAIRS: PatternPair[] = [
  {
    id: "nested-plus",
    title: "Вложенный квантификатор (a+)+",
    unsafeSource: "^(a+)+$",
    safeSource: "^a+$",
    flags: "",
    growth: "exponential",
    note: "Строку из n букв 'a' можно разбить на группы 2^(n-1) способами, и при неудаче движок перебирает их все.",
    attack: tailBang("a"),
    sandbox: { n: 25, max: 60 },
    bench: { unsafe: 34, safe: 50000 },
    blockN: 28,
  },
  {
    id: "overlap-alt",
    title: "Перекрывающаяся альтернация (a|a)*",
    unsafeSource: "^(a|a)*$",
    safeSource: "^a*$",
    flags: "",
    growth: "exponential",
    note: "Обе ветки a|a совпадают с одним и тем же символом, поэтому на каждом символе путь раздваивается: 2^n вариантов.",
    attack: tailBang("a"),
    sandbox: { n: 25, max: 60 },
    bench: { unsafe: 34, safe: 50000 },
    blockN: 28,
  },
  {
    id: "star-star",
    title: "Звезда под звездой (.*)*",
    unsafeSource: "^(.*)*$",
    safeSource: "^.*$",
    flags: "",
    growth: "exponential",
    note: "(.*)* перебирает все способы разрезать строку; '\\n' в конце не совпадает с '.', и это запускает полный откат.",
    attack: (n) => "a".repeat(Math.max(0, n - 1)) + "\n",
    sandbox: { n: 25, max: 60 },
    bench: { unsafe: 34, safe: 50000 },
    blockN: 27,
  },
  {
    id: "digits-group",
    title: "Группа цифр (\\d+)+",
    unsafeSource: "^(\\d+)+$",
    safeSource: "^\\d+$",
    flags: "",
    growth: "exponential",
    note: "То же вложение квантификаторов, что и (a+)+, только на цифрах; хвостовой '!' ломает финальное совпадение.",
    attack: tailBang("1"),
    sandbox: { n: 25, max: 60 },
    bench: { unsafe: 34, safe: 50000 },
    blockN: 28,
  },
  {
    id: "word-or-digit",
    title: "Пересекающиеся классы (\\w|\\d)+",
    unsafeSource: "^(\\w|\\d)+$",
    safeSource: "^\\w+$",
    flags: "",
    growth: "exponential",
    note: "Каждая цифра подходит и под \\w, и под \\d. Альтернатива с пересекающимися ветками — та же ловушка, что a|a, только менее заметная.",
    attack: tailBang("1"),
    sandbox: { n: 24, max: 60 },
    bench: { unsafe: 34, safe: 50000 },
    blockN: 27,
  },
  {
    id: "fibonacci",
    title: "Разная длина веток (a|aa)+",
    unsafeSource: "^(a|aa)+$",
    safeSource: "^a+$",
    flags: "",
    growth: "exponential",
    note: "Число способов составить n из единиц и двоек — это числа Фибоначчи, растут как 1,618^n. Медленнее, чем 2^n, но всё равно экспонента.",
    attack: tailBang("a"),
    sandbox: { n: 34, max: 80 },
    bench: { unsafe: 46, safe: 50000 },
    blockN: 40,
  },
  {
    id: "words",
    title: "Слова через пробел (\\w+\\s?)*",
    unsafeSource: "^(\\w+\\s?)*$",
    safeSource: "^(?:\\w+\\s)*\\w*$",
    flags: "",
    growth: "exponential",
    note: "Пробел необязателен, поэтому 'abc' — это и одно слово, и три слова подряд. В безопасной версии пробел после каждого слова, кроме последнего, обязателен — разбиение однозначно.",
    attack: tailBang("a"),
    sandbox: { n: 24, max: 60 },
    bench: { unsafe: 34, safe: 50000 },
    blockN: 28,
  },
  {
    id: "email",
    title: "Email из примеров OWASP",
    unsafeSource:
      "^([a-zA-Z0-9])(([\\-.]|[_]+)?([a-zA-Z0-9]+))*(@){1}[a-z0-9]+[.]{1}(([a-z]{2,3})|([a-z]{2,3}[.]{1}[a-z]{2,3}))$",
    safeSource:
      "^[a-zA-Z0-9]+(?:(?:[-.]|_+)[a-zA-Z0-9]+)*@[a-z0-9]+\\.[a-z]{2,3}(?:\\.[a-z]{2,3})?$",
    flags: "",
    growth: "exponential",
    note: "Разделитель в ([\\-.]|[_]+)? необязателен, и цепочка букв до '@' режется на блоки ([a-zA-Z0-9]+) экспоненциальным числом способов. В безопасной версии разделитель между блоками обязателен.",
    attack: tailBang("a"),
    sandbox: { n: 26, max: 60 },
    bench: { unsafe: 36, safe: 50000 },
    blockN: 31,
  },
  {
    id: "java-class",
    title: "Имя Java-класса из примеров OWASP",
    unsafeSource: "^(([a-z])+.)+[A-Z]([a-z])+$",
    safeSource: "^(?:[a-z]+\\.)+[A-Z][a-z]+$",
    flags: "",
    growth: "exponential",
    note: "Точка не экранирована и совпадает с любым символом, в том числе с 'a', — пакеты можно нарезать множеством способов. В безопасной версии точка экранирована, и это заодно исправляет баг.",
    attack: tailBang("a"),
    sandbox: { n: 34, max: 80 },
    bench: { unsafe: 46, safe: 50000 },
    blockN: 40,
  },
  {
    id: "trailing-space",
    title: "Обрезка пробелов (Stack Overflow, 2016)",
    unsafeSource: "^[\\s\\u200c]+|[\\s\\u200c]+$",
    safeSource: "^[\\s\\u200c]+|(?<![\\s\\u200c])[\\s\\u200c]+$",
    flags: "",
    growth: "polynomial",
    note: "Вторая ветка пробует начать совпадение с каждого пробела серии и каждый раз пробегает её до 'x': O(n²). Lookbehind разрешает старт только с первого пробела серии. Упрощённый /\\s+$/ свежий V8 уже оптимизирует, а этот, с альтернацией, — нет.",
    attack: (n) => "x" + " ".repeat(Math.max(0, n - 2)) + "x",
    sandbox: { n: 30000, max: 200000 },
    bench: { unsafe: 100000, safe: 200000 },
    blockN: 50000,
  },
  {
    id: "cloudflare",
    title: "Фрагмент WAF .*(?:.*=.*) (Cloudflare, 2019)",
    unsafeSource: ".*(?:.*=.*)",
    safeSource: "=",
    flags: "",
    growth: "polynomial",
    note: "Три .* подряд делят строку на части O(n²) способами, и всё это повторяется с каждой стартовой позиции: O(n³). По сути выражение спрашивает «есть ли в строке '='» — это и есть безопасная версия.",
    attack: (n) => "x".repeat(n),
    sandbox: { n: 800, max: 5000 },
    bench: { unsafe: 3000, safe: 100000 },
    blockN: 1200,
  },
];

export function getPair(id: string): PatternPair {
  const pair = PATTERN_PAIRS.find((p) => p.id === id);
  if (!pair) throw new Error(`Неизвестная пара паттернов: ${id}`);
  return pair;
}
