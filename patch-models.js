const fs = require('fs');
const path = require('path');
const { DEFAULT_BASELINE_MODELS, FREE_ROUTER_EXTENSIONS, formatModel } = require('./dynamic-router.js');

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

console.log("Applying smart dynamic aggregator across /app...");
const appDir = path.resolve('/app');
const files = walk(appDir);

// Build initial catalog
const initialCatalog = [];
const seen = new Set();
for (const m of DEFAULT_BASELINE_MODELS.kc) {
  const f = formatModel('kc', m);
  if (!seen.has(f.id)) { seen.add(f.id); initialCatalog.push(f); }
}
for (const m of FREE_ROUTER_EXTENSIONS.kc) {
  const f = formatModel('kc', m);
  if (!seen.has(f.id)) { seen.add(f.id); initialCatalog.push(f); }
}
for (const m of FREE_ROUTER_EXTENSIONS.oc) {
  const f = formatModel('oc', m);
  if (!seen.has(f.id)) { seen.add(f.id); initialCatalog.push(f); }
}

const catalogJsonStr = JSON.stringify(initialCatalog);

let patchedCount = 0;

for (const f of files) {
  try {
    let content = fs.readFileSync(f, 'utf8');
    let modified = false;

    // Clean up any double prefixes
    if (content.includes('kc/kc/') || content.includes('kc/oc/')) {
      content = content.replace(/kc\/kc\//g, 'kc/').replace(/kc\/oc\//g, 'oc/');
      modified = true;
    }

    // Patch Next.js v1/models route handler to dynamically aggregate models
    if (f.includes('api/v1/models') || f.includes('api/v1beta/models') || content.includes('INTERNAL_MODELS_FETCH_HEADER')) {
      if (!content.includes('__SMART_DYNAMIC_ENGINE_INJECTED__')) {
        console.log(`Injecting smart dynamic engine into route handler: ${f}`);
        const injectCode = `;const __SMART_BASE__ = ${catalogJsonStr}; const __seen = new Set(data.map(x=>x.id.replace(/^kc\\/kc\\//,'kc/').replace(/^kc\\/oc\\//,'oc/'))); data = data.map(x=>({...x, id: x.id.replace(/^kc\\/kc\\//,'kc/').replace(/^kc\\/oc\\//,'oc/')})).filter(x=>!x.id.startsWith('kc/oc/')); for(const __m of __SMART_BASE__){if(!__seen.has(__m.id)){data.push(__m);}}; /* __SMART_DYNAMIC_ENGINE_INJECTED__ */`;
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

    // Patch provider models registry
    if (content.includes('anthropic/claude-sonnet-4-20250514') || content.includes('deepseek/deepseek-reasoner')) {
      if (!content.includes('stepfun/step-3.7-flash:free')) {
        console.log(`Patching provider model catalog in: ${f}`);
        const extraArrayStr = FREE_ROUTER_EXTENSIONS.kc.map(m => `,{id:"${m.id}",name:"${m.name}",object:"model",owned_by:"kc",tier:"${m.tier}",is_free:${m.tier === 'free'},capabilities:{vision:false,tools:true,reasoning:${!!m.reasoning}},context_length:200000,max_completion_tokens:64000}`).join('');
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

console.log(`Smart dynamic engine patch complete. Patched ${patchedCount} files.`);
