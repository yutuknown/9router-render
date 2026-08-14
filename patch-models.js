const fs = require('fs');
const path = require('path');

const ALL_MODELS = [
  // Standard Kilo Code Models
  { id: "kc/anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
  { id: "kc/anthropic/claude-opus-4-20250514", name: "Claude Opus 4" },
  { id: "kc/google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
  { id: "kc/google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  { id: "kc/openai/gpt-4.1", name: "GPT-4.1" },
  { id: "kc/openai/o3", name: "o3" },
  { id: "kc/deepseek/deepseek-chat", name: "DeepSeek Chat" },
  { id: "kc/deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" },

  // Kilo Code Free Models
  { id: "kc/kilo-auto/free", name: "Auto Free" },
  { id: "kc/openrouter/free", name: "OpenRouter Free Models Router" },
  { id: "kc/stepfun/step-3.7-flash:free", name: "StepFun: Step 3.7 Flash (free)" },
  { id: "kc/poolside/laguna-s-2.1:free", name: "Poolside: Laguna S 2.1 (free)" },
  { id: "kc/tencent/hy3:free", name: "Tencent: Hy3 (free)" },
  { id: "kc/liquid/lfm-2.5-2.6b:free", name: "LiquidAI: LFM2.5-2.6B (free)" },
  { id: "kc/nvidia/nemotron-3.5-lightning:free", name: "NVIDIA: Nemotron 3.5 Lightning (free)" },
  { id: "kc/poolside/laguna-xs-2.1:free", name: "Poolside: Laguna XS 2.1 (free)" },
  { id: "kc/cohere/north-mini-code:free", name: "Cohere: North Mini Code (free)" },
  { id: "kc/nvidia/nemotron-3.5-content-safety:free", name: "NVIDIA: Nemotron 3.5 Content Safety (free)" },
  { id: "kc/nvidia/nemotron-3-ultra-550b-a55b:free", name: "NVIDIA: Nemotron 3 Ultra (free)" },
  { id: "kc/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", name: "NVIDIA: Nemotron 3 Nano Omni (free)" },
  { id: "kc/nvidia/nemotron-3-super-120b-a12b:free", name: "NVIDIA: Nemotron 3 Super (free)" },
  
  // OpenCode Free Models
  { id: "oc/big-pickle", name: "big-pickle" },
  { id: "oc/deepseek-v4-flash-free", name: "deepseek-v4-flash-free" },
  { id: "oc/hy3-free", name: "hy3-free" },
  { id: "oc/mimo-v2.5-free", name: "mimo-v2.5-free" },
  { id: "oc/nemotron-3-ultra-free", name: "nemotron-3-ultra-free" },
  { id: "oc/laguna-s-2.1-free", name: "laguna-s-2.1-free" },
  { id: "oc/nemotron-3.5-lightning-free", name: "nemotron-3.5-lightning-free" }
];

function walk(dir) {
  let results = [];
  try {
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      file = path.join(dir, file);
      const stat = fs.statSync(file);
      if (stat && stat.isDirectory()) {
        results = results.concat(walk(file));
      } else if (file.endsWith('.js') || file.endsWith('.json') || file.endsWith('.mjs')) {
        results.push(file);
      }
    });
  } catch (e) {}
  return results;
}

console.log("Searching and patching model definitions across /app...");
const appDir = path.resolve('/app');
const files = walk(appDir);

let patchedCount = 0;

const modelsJsonStr = JSON.stringify(ALL_MODELS.map(m => ({
  id: m.id,
  object: "model",
  owned_by: m.id.split('/')[0],
  capabilities: { vision: true, tools: true, reasoning: true },
  context_length: 200000,
  max_completion_tokens: 64000
})));

for (const f of files) {
  try {
    let content = fs.readFileSync(f, 'utf8');
    let modified = false;

    // Pattern 1: Patch Next.js v1/models route handler to inject ALL_MODELS before returning
    if (f.includes('api/v1/models') || f.includes('api/v1beta/models') || content.includes('INTERNAL_MODELS_FETCH_HEADER')) {
      if (!content.includes('__ALL_MODELS_INJECTED__')) {
        console.log(`Injecting full model list into route handler: ${f}`);
        const injectCode = `;const __EXTRA_MODELS__ = ${modelsJsonStr}; const __seen = new Set(data.map(x=>x.id)); for(const __m of __EXTRA_MODELS__){if(!__seen.has(__m.id)){data.push(__m);}}; /* __ALL_MODELS_INJECTED__ */`;
        // Inject right before returning json({ object: "list", data: ... })
        if (content.includes('object:"list",data:')) {
          content = content.replace(/(object:\s*["']list["'],\s*data:\s*)([a-zA-Z0-9_$]+)/g, (match, prefix, varName) => {
            return `${prefix}((()=>{ let data = ${varName}; ${injectCode} return data; })())`;
          });
          modified = true;
        } else if (content.includes('object: "list", data:')) {
          content = content.replace(/(object:\s*["']list["'],\s*data:\s*)([a-zA-Z0-9_$]+)/g, (match, prefix, varName) => {
            return `${prefix}((()=>{ let data = ${varName}; ${injectCode} return data; })())`;
          });
          modified = true;
        }
      }
    }

    // Pattern 2: Patch static model arrays in provider registry
    if (content.includes('kc/anthropic/claude-sonnet-4-20250514') || content.includes('deepseek/deepseek-reasoner')) {
      if (!content.includes('oc/laguna-s-2.1-free')) {
        console.log(`Patching provider model catalog in: ${f}`);
        const extraArrayStr = ALL_MODELS.map(m => `,{id:"${m.id}",name:"${m.name}",object:"model",owned_by:"${m.id.split('/')[0]}",capabilities:{vision:true,tools:true,reasoning:true},context_length:200000,max_completion_tokens:64000}`).join('');
        content = content.replace(/\{[^}]*id:["'][^"']*deepseek-reasoner["'][^}]*\}/g, (match) => match + extraArrayStr);
        modified = true;
      }
    }

    if (modified) {
      fs.writeFileSync(f, content, 'utf8');
      patchedCount++;
      console.log(`Successfully patched: ${f}`);
    }
  } catch (err) {
    console.error(`Error processing ${f}:`, err.message);
  }
}

console.log(`Patch complete. Patched ${patchedCount} files.`);
