export type ModelMode = "auto" | "best" | "cheapest";
export const BEST_MODEL = "claude-opus-5-5";
export const CHEAP_MODEL = "claude-haiku-5-5";
export type ModelId = typeof BEST_MODEL | typeof CHEAP_MODEL;

/** Auto: a short memo by one speaker goes to the cheap model, anything else to the best one. */
export function pickModel(r: { minutes: number; speakers: number }, mode: ModelMode): ModelId {
  if (mode === "best") return BEST_MODEL;
  if (mode === "cheapest") return CHEAP_MODEL;
  return r.speakers <= 1 && r.minutes <= 10 ? CHEAP_MODEL : BEST_MODEL;
}

/** After a cheap pass in Auto mode, rerun on the best model when it says it was unsure. */
export function shouldEscalate(model: ModelId, mode: ModelMode, out: { confidence: "high" | "low" }): boolean {
  return mode === "auto" && model === CHEAP_MODEL && out.confidence === "low";
}

/** List prices in US dollars per million tokens. */
const PRICES: Record<ModelId, { input: number; output: number; longInput?: number; longOutput?: number }> = {
  [BEST_MODEL]: { input: 4, output: 20 },
  // Haiku 5.5 costs more for prompts over 100K tokens.
  [CHEAP_MODEL]: { input: 0.1, output: 0.5, longInput: 0.5, longOutput: 2.5 },
};

export function llmCostUsd(model: ModelId, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  const long = inputTokens > 100_000 && p.longInput !== undefined;
  const inRate = long ? p.longInput! : p.input;
  const outRate = long ? p.longOutput! : p.output;
  return (inputTokens * inRate + outputTokens * outRate) / 1_000_000;
}

/** AssemblyAI list price used for the estimate: $0.21 per hour plus $0.02 per hour for speaker labels. */
export const STT_USD_PER_HOUR = 0.23;
export function sttCostUsd(durationMs: number): number {
  return (durationMs / 3_600_000) * STT_USD_PER_HOUR;
}
