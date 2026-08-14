const https = require('https');
const http = require('http');

// In-memory cache for live fetched models
let modelCache = {
  timestamp: 0,
  ttl: 5 * 60 * 1000, // 5 minutes
  models: []
};

// Known provider endpoints & base model registries
const PROVIDERS = {
  kc: {
    name: "Kilo Code",
    prefix: "kc",
    baseUrl: "https://api.kilo.ai/v1",
    fallbackModels: [
      { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "paid" },
      { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4", tier: "paid" },
      { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "paid", context: 1048576 },
      { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "paid", context: 1048576 },
      { id: "openai/gpt-4.1", name: "GPT-4.1", tier: "paid", context: 1000000 },
      { id: "openai/o3", name: "o3", tier: "paid", reasoning: true },
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
    ]
  },
  oc: {
    name: "OpenCode",
    prefix: "oc",
    baseUrl: "https://opencode.ai/v1",
    fallbackModels: [
      { id: "big-pickle", name: "big-pickle", tier: "free" },
      { id: "deepseek-v4-flash-free", name: "deepseek-v4-flash-free", tier: "free", reasoning: true, context: 1000000 },
      { id: "hy3-free", name: "hy3-free", tier: "free", reasoning: true, context: 262144 },
      { id: "mimo-v2.5-free", name: "mimo-v2.5-free", tier: "free", vision: true, context: 1048576 },
      { id: "nemotron-3-ultra-free", name: "nemotron-3-ultra-free", tier: "free", reasoning: true },
      { id: "laguna-s-2.1-free", name: "laguna-s-2.1-free", tier: "free", reasoning: true },
      { id: "nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning-free", tier: "free", reasoning: true }
    ]
  }
};

// Algorithmic capability inferencing
function inferCapabilities(rawId) {
  const id = rawId.toLowerCase();
  const isVision = id.includes("vision") || id.includes("mimo") || id.includes("claude") || id.includes("gemini") || id.includes("gpt-4") || id.includes("o3") || id.includes("omni");
  const isReasoning = id.includes("reason") || id.includes("o3") || id.includes("think") || id.includes("nemotron") || id.includes("step") || id.includes("laguna") || id.includes("hy3") || id.includes("ultra");
  const isTools = true;
  
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
    tools: isTools,
    reasoning: isReasoning,
    thinkingFormat: isReasoning ? (id.includes("deepseek") ? "deepseek" : (id.includes("step") ? "step" : (id.includes("hunyuan") || id.includes("hy3") ? "hunyuan" : "openai"))) : null,
    thinkingCanDisable: isReasoning,
    contextWindow: contextWindow,
    maxOutput: maxOutput
  };
}

// Algorithmic tier detection
function detectTier(rawId, pricing) {
  const id = rawId.toLowerCase();
  if (pricing && parseFloat(pricing.prompt || "1") === 0 && parseFloat(pricing.completion || "1") === 0) {
    return "free";
  }
  if (id.includes(":free") || id.includes("-free") || id.includes("/free") || id.endsWith("free") || id.includes("big-pickle") || id.startsWith("oc/")) {
    return "free";
  }
  return "paid";
}

// Transform raw model into standard OpenAI format
function formatModel(providerKey, rawModel) {
  const rawId = typeof rawModel === 'string' ? rawModel : (rawModel.id || "");
  const fullId = rawId.startsWith(`${providerKey}/`) ? rawId : `${providerKey}/${rawId}`;
  const tier = detectTier(rawId, rawModel.pricing);
  const isFree = tier === "free";
  const caps = inferCapabilities(rawId);

  return {
    id: fullId,
    object: "model",
    owned_by: providerKey,
    tier: tier,
    is_free: isFree,
    pricing: isFree ? { prompt: 0, completion: 0 } : (rawModel.pricing || { prompt: "metered", completion: "metered" }),
    capabilities: {
      ...caps,
      is_free: isFree
    },
    context_length: rawModel.context_length || caps.contextWindow,
    max_completion_tokens: rawModel.max_completion_tokens || caps.maxOutput
  };
}

// Retrieve dynamic model catalog
function getDynamicCatalog() {
  const results = [];
  const seenIds = new Set();

  for (const [providerKey, provider] of Object.entries(PROVIDERS)) {
    for (const m of provider.fallbackModels) {
      const formatted = formatModel(providerKey, m);
      if (!seenIds.has(formatted.id)) {
        seenIds.add(formatted.id);
        results.push(formatted);
      }
    }
  }

  return results;
}

module.exports = {
  getDynamicCatalog,
  formatModel,
  detectTier,
  inferCapabilities
};
