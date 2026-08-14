const fs = require('fs');
const path = require('path');
const { getDynamicCatalog } = require('./dynamic-router.js');

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

console.log("Applying algorithmic model mapping and routing engine across /app...");
const appDir = path.resolve('/app');
const files = walk(appDir);

let patchedCount = 0;

for (const f of files) {
  try {
    let content = fs.readFileSync(f, 'utf8');
    let modified = false;

    // Pattern 1: Patch Next.js v1/models route handler
    if (f.includes('api/v1/models') || f.includes('api/v1beta/models') || content.includes('INTERNAL_MODELS_FETCH_HEADER')) {
      if (!content.includes('__ALGORITHMIC_CATALOG_INJECTED__')) {
        console.log(`Injecting algorithmic catalog into route handler: ${f}`);
        const injectCode = `;const __ALGO_CATALOG__ = ${catalogJsonStr}; const __seen = new Set(data.map(x=>x.id)); for(const __m of __ALGO_CATALOG__){if(!__seen.has(__m.id)){data.push(__m);}}; /* __ALGORITHMIC_CATALOG_INJECTED__ */`;
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
        const extraArrayStr = fullCatalog.map(m => `,{id:"${m.id}",name:"${m.id}",object:"model",owned_by:"${m.owned_by}",tier:"${m.tier}",is_free:${m.is_free},pricing:${JSON.stringify(m.pricing)},capabilities:${JSON.stringify(m.capabilities)},context_length:${m.context_length},max_completion_tokens:${m.max_completion_tokens}}`).join('');
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

console.log(`Algorithmic catalog patch complete. Patched ${patchedCount} files.`);
