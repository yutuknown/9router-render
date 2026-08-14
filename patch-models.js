const fs = require('fs');
const path = require('path');
const { getDynamicCatalog, KILO_MODELS, OPENCODE_MODELS } = require('./dynamic-router.js');

const fullCatalog = getDynamicCatalog();
const catalogJsonStr = JSON.stringify(fullCatalog);

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

console.log("Applying clean single-prefix model mapping across /app...");
const appDir = path.resolve('/app');
const files = walk(appDir);

let patchedCount = 0;

for (const f of files) {
  try {
    let content = fs.readFileSync(f, 'utf8');
    let modified = false;

    // Pattern 1: Clean up any existing double-prefixed strings like "kc/kc/" or "kc/oc/"
    if (content.includes('kc/kc/') || content.includes('kc/oc/')) {
      console.log(`Cleaning double prefixes in ${f}`);
      content = content.replace(/kc\/kc\//g, 'kc/').replace(/kc\/oc\//g, 'oc/');
      modified = true;
    }

    // Pattern 2: Patch Next.js v1/models route handler with clean catalog
    if (f.includes('api/v1/models') || f.includes('api/v1beta/models') || content.includes('INTERNAL_MODELS_FETCH_HEADER')) {
      if (!content.includes('__CLEAN_ALGO_CATALOG__')) {
        console.log(`Injecting clean catalog into route handler: ${f}`);
        const injectCode = `;const __CLEAN_CATALOG__ = ${catalogJsonStr}; const __seen = new Set(data.map(x=>x.id.replace(/^kc\\/kc\\//,'kc/').replace(/^kc\\/oc\\//,'oc/'))); data = data.map(x=>({...x, id: x.id.replace(/^kc\\/kc\\//,'kc/').replace(/^kc\\/oc\\//,'oc/')})).filter(x=>!x.id.startsWith('kc/oc/')); for(const __m of __CLEAN_CATALOG__){if(!__seen.has(__m.id)){data.push(__m);}}; /* __CLEAN_ALGO_CATALOG__ */`;
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

    // Pattern 3: Clean providerModels.js or registry files
    if (content.includes('anthropic/claude-sonnet-4-20250514') || content.includes('deepseek/deepseek-reasoner')) {
      if (!content.includes('stepfun/step-3.7-flash:free')) {
        console.log(`Patching provider model catalog in: ${f}`);
        const extraArrayStr = KILO_MODELS.map(m => `,{id:"${m.id}",name:"${m.name}",object:"model",owned_by:"kc",tier:"${m.tier}",is_free:${m.tier === 'free'},capabilities:{vision:${!!m.vision},tools:true,reasoning:${!!m.reasoning}},context_length:${m.context || 200000},max_completion_tokens:64000}`).join('');
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

console.log(`Clean patch complete. Patched ${patchedCount} files.`);
