const KILO_MODELS = [
  { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "paid", vision: true, reasoning: true },
  { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4", tier: "paid", vision: true, reasoning: true },
  { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "paid", vision: true, reasoning: true, context: 1048576 },
  { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "paid", vision: true, reasoning: true, context: 1048576 },
  { id: "openai/gpt-4.1", name: "GPT-4.1", tier: "paid", vision: true, context: 1000000 },
  { id: "openai/o3", name: "o3", tier: "paid", vision: true, reasoning: true },
  { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", tier: "paid" },
  { id: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner", tier: "paid", reasoning: true },
  { id: "kilo-auto/free", name: "Auto Free", tier: "free" },
  { id: "openrouter/free", name: "OpenRouter Free Models Router", tier: "free" },
  { id: "stepfun/step-3.7-flash:free", name: "StepFun: Step 3.7 Flash (free)", tier: "free", reasoning: true },
  { id: "poolside/laguna-s-2.1:free", name: "Poolside: Laguna S 2.1 (free)", tier: "free", reasoning: true },
  { id: "tencent/hy3:free", name: "Tencent: Hy3 (free)", tier: "free", reasoning: true, context: 262144 },
  { id: "liquid/lfm-2.5-2.6b:free", name: "LiquidAI: LFM2.5-2.6B (free)", tier: "free" },
  { id: "nvidia/nemotron-3.5-lightning:free", name: "NVIDIA: Nemotron 3.5 Lightning (free)", tier: "free", reasoning: true },
  { id: "poolside/laguna-xs-2.1:free", name: "Poolside: Laguna XS 2.1 (free)", tier: "free", reasoning: true },
  { id: "cohere/north-mini-code:free", name: "Cohere: North Mini Code (free)", tier: "free" },
  { id: "nvidia/nemotron-3.5-content-safety:free", name: "NVIDIA: Nemotron 3.5 Content Safety (free)", tier: "free", reasoning: true },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA: Nemotron 3 Ultra (free)", tier: "free", reasoning: true },
  { id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "NVIDIA: Nemotron 3 Nano Omni (free)", tier: "free", reasoning: true },
  { id: "nvidia/nemotron-3-super-120b-a12b:free", name: "NVIDIA: Nemotron 3 Super (free)", tier: "free", reasoning: true }
];

const OPENCODE_MODELS = [
  { id: "big-pickle", name: "big-pickle", tier: "free" },
  { id: "deepseek-v4-flash-free", name: "deepseek-v4-flash-free", tier: "free", reasoning: true, context: 1000000 },
  { id: "hy3-free", name: "hy3-free", tier: "free", reasoning: true, context: 262144 },
  { id: "mimo-v2.5-free", name: "mimo-v2.5-free", tier: "free", vision: true, context: 1048576 },
  { id: "nemotron-3-ultra-free", name: "nemotron-3-ultra-free", tier: "free", reasoning: true },
  { id: "laguna-s-2.1-free", name: "laguna-s-2.1-free", tier: "free", reasoning: true },
  { id: "nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning-free", tier: "free", reasoning: true }
];

function normalizeModelId(rawId) {
  // Strip duplicate prefixes like kc/kc/ or kc/oc/
  return rawId.replace(/^(kc|oc)\//i, '').replace(/^(kc|oc)\//i, '');
}

function inferCapabilities(rawId) {
  const id = rawId.toLowerCase();
  const isVision = id.includes("vision") || id.includes("mimo") || id.includes("claude") || id.includes("gemini") || id.includes("gpt-4") || id.includes("o3") || id.includes("omni");
  const isReasoning = id.includes("reason") || id.includes("o3") || id.includes("think") || id.includes("nemotron") || id.includes("step") || id.includes("laguna") || id.includes("hy3") || id.includes("ultra");
  
  let contextWindow = 200000;
  if (id.includes("gemini") || id.includes("gpt-4.1") || id.includes("deepseek-v4") || id.includes("mimo")) {
    contextWindow = 1000000;
  } else if (id.includes("hy3")) {
    contextWindow = 262144;
  } else if (id.includes("deepseek") || id.includes("nemotron") || id.includes("step")) {
    contextWindow = 128000;
  }

  let maxOutput = 64000;
  if (id.includes("o3")) maxOutput = 100000;
  if (id.includes("gemini")) maxOutput = 65536;
  if (id.includes("laguna")) maxOutput = 32000;
  if (id.includes("hy3")) maxOutput = 262144;

  return {
    vision: isVision,
    pdf: isVision,
    audioInput: false,
    videoInput: false,
    imageOutput: false,
    audioOutput: false,
    search: false,
    tools: true,
    reasoning: isReasoning,
    thinkingFormat: isReasoning ? (id.includes("deepseek") ? "deepseek" : (id.includes("step") ? "step" : (id.includes("hunyuan") || id.includes("hy3") ? "hunyuan" : "openai"))) : null,
    thinkingCanDisable: isReasoning,
    contextWindow: contextWindow,
    maxOutput: maxOutput
  };
}

function detectTier(rawId, pricing) {
  const id = rawId.toLowerCase();
  if (pricing && parseFloat(pricing.prompt || "1") === 0 && parseFloat(pricing.completion || "1") === 0) {
    return "free";
  }
  if (id.includes(":free") || id.includes("-free") || id.includes("/free") || id.endsWith("free") || id.includes("big-pickle")) {
    return "free";
  }
  return "paid";
}

function formatModel(providerPrefix, rawModel) {
  const cleanId = normalizeModelId(typeof rawModel === 'string' ? rawModel : (rawModel.id || ""));
  const fullId = `${providerPrefix}/${cleanId}`;
  const tier = typeof rawModel === 'object' && rawModel.tier ? rawModel.tier : detectTier(cleanId, rawModel.pricing);
  const isFree = tier === "free";
  const caps = inferCapabilities(cleanId);

  return {
    id: fullId,
    clean_id: cleanId,
    object: "model",
    owned_by: providerPrefix,
    tier: tier,
    is_free: isFree,
    pricing: isFree ? { prompt: 0, completion: 0 } : (rawModel.pricing || { prompt: "metered", completion: "metered" }),
    capabilities: {
      ...caps,
      is_free: isFree
    },
    context_length: rawModel.context || caps.contextWindow,
    max_completion_tokens: rawModel.maxOutput || caps.maxOutput
  };
}

function getDynamicCatalog() {
  const results = [];
  const seen = new Set();

  for (const m of KILO_MODELS) {
    const formatted = formatModel('kc', m);
    if (!seen.has(formatted.id)) {
      seen.add(formatted.id);
      results.push(formatted);
    }
  }

  for (const m of OPENCODE_MODELS) {
    const formatted = formatModel('oc', m);
    if (!seen.has(formatted.id)) {
      seen.add(formatted.id);
      results.push(formatted);
    }
  }

  return results;
}

module.exports = {
  getDynamicCatalog,
  formatModel,
  normalizeModelId,
  detectTier,
  inferCapabilities,
  KILO_MODELS,
  OPENCODE_MODELS
};
