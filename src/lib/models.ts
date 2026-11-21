export type ModelProvider = "anthropic" | "openai" | "openrouter" | "demo";

export type ModelDef = {
  id: string;
  label: string;
  provider: ModelProvider;
  description: string;
  /** No app-side caps — usage limited only by the provider key you attach. */
  unlimited: true;
};

export const MODELS: ModelDef[] = [
  {
    id: "claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    provider: "anthropic",
    description: "Default coding model — strong and fast",
    unlimited: true,
  },
  {
    id: "claude-opus-4-5",
    label: "Claude Opus 4.5",
    provider: "anthropic",
    description: "Heavier reasoning for hard refactors",
    unlimited: true,
  },
  {
    id: "claude-haiku-4-5",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    description: "Fast and cheap for quick edits",
    unlimited: true,
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o (OpenRouter)",
    provider: "openrouter",
    description: "OpenAI via OpenRouter",
    unlimited: true,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    description: "OpenAI direct — light tasks",
    unlimited: true,
  },
  {
    id: "helix-demo",
    label: "Helix demo (offline)",
    provider: "demo",
    description: "Deterministic sandbox agent — no API key",
    unlimited: true,
  },
];

export function getModel(id: string): ModelDef {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function providerReady(provider: ModelProvider): boolean {
  switch (provider) {
    case "anthropic":
      return Boolean(process.env.ANTHROPIC_API_KEY);
    case "openai":
      return Boolean(process.env.OPENAI_API_KEY);
    case "openrouter":
      return Boolean(process.env.OPENROUTER_API_KEY);
    case "demo":
      return true;
  }
}

export function resolveModelForRuntime(requestedId?: string): ModelDef {
  const wanted = getModel(requestedId || "claude-sonnet-4-5");
  if (providerReady(wanted.provider)) return wanted;
  // Fall back to first ready Claude, then any ready, then demo.
  const ready =
    MODELS.find((m) => m.provider === "anthropic" && providerReady("anthropic")) ||
    MODELS.find((m) => providerReady(m.provider) && m.provider !== "demo") ||
    MODELS.find((m) => m.id === "helix-demo")!;
  return ready;
}
