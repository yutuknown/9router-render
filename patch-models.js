const fs = require('fs');
const path = require('path');

const modelsToAdd = [
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
  { id: "kc/nvidia/nemotron-3-super-120b-a12b:free", name: "NVIDIA: Nemotron 3 Super (free)" }
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

console.log("Searching files in /app to patch model definitions...");
const appDir = path.resolve('/app');
const files = walk(appDir);

let patchedCount = 0;

for (const f of files) {
  try {
    let content = fs.readFileSync(f, 'utf8');
    let modified = false;

    // Pattern 1: Files with kc/deepseek/deepseek-reasoner in model arrays
    if (content.includes('kc/deepseek/deepseek-reasoner') && !content.includes('kc/openrouter/free')) {
      console.log(`Patching model array in ${f}`);
      const extraArrayStr = modelsToAdd.map(m => `,{id:"${m.id}",name:"${m.name}",object:"model",owned_by:"kc",capabilities:{vision:true,tools:true,reasoning:true},context_length:200000,max_completion_tokens:64000}`).join('');
      content = content.replace(/\{[^}]*id:["']kc\/deepseek\/deepseek-reasoner["'][^}]*\}/g, (match) => match + extraArrayStr);
      modified = true;
    }

    // Pattern 2: Files without kc/ prefix
    if (content.includes('deepseek/deepseek-reasoner') && !content.includes('openrouter/free')) {
      const extraArrayStrRaw = modelsToAdd.map(m => {
        const rawId = m.id.replace(/^kc\//, '');
        return `,{id:"${rawId}",name:"${m.name}",object:"model",owned_by:"kc",capabilities:{vision:true,tools:true,reasoning:true},context_length:200000,max_completion_tokens:64000}`;
      }).join('');
      content = content.replace(/\{[^}]*id:["']deepseek\/deepseek-reasoner["'][^}]*\}/g, (match) => match + extraArrayStrRaw);
      modified = true;
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
