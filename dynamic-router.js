const https = require('https');
const http = require('http');
const path = require('path');
const fs = require('fs');

// In-memory cache for live fetched models
let modelCache = {
  timestamp: 0,
  ttl: 5 * 60 * 1000, // 5 minutes
  models: []
};

// Known core free tier models for providers (since upstream often omits :free aliases from /models)
const FREE_ROUTER_EXTENSIONS = {
  kc: [
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
  ],
  oc: [
    { id: "big-pickle", name: "big-pickle", tier: "free" },
    { id: "deepseek-v4-flash-free", name: "deepseek-v4-flash-free", tier: "free", reasoning: true, context: 1000000 },
    { id: "hy3-free", name: "hy3-free", tier: "free", reasoning: true, context: 262144 },
    { id: "mimo-v2.5-free", name: "mimo-v2.5-free", tier: "free", vision: true, context: 1048576 },
    { id: "nemotron-3-ultra-free", name: "nemotron-3-ultra-free", tier: "free", reasoning: true },
    { id: "laguna-s-2.1-free", name: "laguna-s-2.1-free", tier: "free", reasoning: true },
    { id: "nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning-free", tier: "free", reasoning: true }
  ]
};

// Default fallback baseline if network is down
const DEFAULT_BASELINE_MODELS = {
  kc: [
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4", tier: "paid", vision: true, reasoning: true },
    { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4", tier: "paid", vision: true, reasoning: true },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro", tier: "paid", vision: true, reasoning: true, context: 1048576 },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash", tier: "paid", vision: true, reasoning: true, context: 1048576 },
    { id: "openai/gpt-4.1", name: "GPT-4.1", tier: "paid", vision: true, context: 1000000 },
    { id: "openai/o3", name: "o3", tier: "paid", vision: true, reasoning: true },
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat", tier: "paid" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner", tier: "paid", reasoning: true }
  ]
};

function normalizeModelId(rawId) {
  if (!rawId) return "";
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
    object: "model",
    owned_by: providerPrefix,
    tier: tier,
    is_free: isFree,
    pricing: isFree ? { prompt: 0, completion: 0 } : (rawModel.pricing || { prompt: "metered", completion: "metered" }),
    capabilities: {
      ...caps,
      is_free: isFree
    },
    context_length: rawModel.context || rawModel.context_length || caps.contextWindow,
    max_completion_tokens: rawModel.maxOutput || rawModel.max_completion_tokens || caps.maxOutput
  };
}

function fetchHttp(url, headers = {}, timeout = 4000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const req = https.request({
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: 'GET',
        headers: headers,
        timeout: timeout
      }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve(JSON.parse(body));
            } else {
              resolve(null);
            }
          } catch (e) {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    } catch (e) {
      resolve(null);
    }
  });
}

function getActiveTokens() {
  const tokens = {};
  const dbPaths = ['/app/data/db/data.sqlite', path.resolve(__dirname, 'data.sqlite')];
  for (const dbPath of dbPaths) {
    if (fs.existsSync(dbPath)) {
      try {
        const Database = require('better-sqlite3');
        const db = new Database(dbPath, { readonly: true });
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
        const tableNames = tables.map(t => t.name);
        
        if (tableNames.includes('providerConnections') || tableNames.includes('connections')) {
          const tName = tableNames.includes('providerConnections') ? 'providerConnections' : 'connections';
          const rows = db.prepare(`SELECT * FROM ${tName}`).all();
          for (const row of rows) {
            const provider = (row.provider || row.providerId || '').toLowerCase();
            const token = row.apiKey || row.accessToken || row.token;
            if (token) {
              if (provider.includes('kilo')) tokens.kc = token;
              if (provider.includes('open')) tokens.oc = token;
            }
          }
        }
        db.close();
      } catch (e) {}
    }
  }
  return tokens;
}

async function getSmartDynamicCatalog() {
  const now = Date.now();
  if (modelCache.models.length > 0 && (now - modelCache.timestamp) < modelCache.ttl) {
    return modelCache.models;
  }

  const results = [];
  const seenIds = new Set();
  const tokens = getActiveTokens();

  // 1. Live Fetch Kilo Code
  let kcLiveModels = null;
  if (tokens.kc) {
    const kcResp = await fetchHttp('https://api.kilo.ai/v1/models', { 'Authorization': `Bearer ${tokens.kc}` });
    if (kcResp && (kcResp.data || Array.isArray(kcResp))) {
      kcLiveModels = Array.isArray(kcResp) ? kcResp : kcResp.data;
    }
  }

  const kcSource = (kcLiveModels && kcLiveModels.length > 0) ? kcLiveModels : DEFAULT_BASELINE_MODELS.kc;
  for (const m of kcSource) {
    const formatted = formatModel('kc', m);
    if (!seenIds.has(formatted.id)) {
      seenIds.add(formatted.id);
      results.push(formatted);
    }
  }

  // Add Free Kilo router models
  for (const m of FREE_ROUTER_EXTENSIONS.kc) {
    const formatted = formatModel('kc', m);
    if (!seenIds.has(formatted.id)) {
      seenIds.add(formatted.id);
      results.push(formatted);
    }
  }

  // 2. OpenCode Free Models
  for (const m of FREE_ROUTER_EXTENSIONS.oc) {
    const formatted = formatModel('oc', m);
    if (!seenIds.has(formatted.id)) {
      seenIds.add(formatted.id);
      results.push(formatted);
    }
  }

  modelCache.models = results;
  modelCache.timestamp = now;
  return results;
}

module.exports = {
  getSmartDynamicCatalog,
  formatModel,
  normalizeModelId,
  detectTier,
  inferCapabilities,
  DEFAULT_BASELINE_MODELS,
  FREE_ROUTER_EXTENSIONS
};
