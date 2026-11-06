import fs from 'node:fs';
const root=new URL('../',import.meta.url);
const files=['ops/macro-reference.mjs','ops/macro-reference-cache.mjs'];
const body=files.map(p=>fs.readFileSync(new URL(p,root),'utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,'')).join('\n');
const block='// BEGIN GENERATED MACRO REFERENCES\nconst MacroReferences=(()=>{\n'+body+'\nreturn {acceptClaimsReferenceRelay,cachedMacroReferences,macroReferenceReceipts,summarizeMacroReferences};\n})();\n// END GENERATED MACRO REFERENCES';
const path=new URL('main-v188.js',root),source=fs.readFileSync(path,'utf8');
const next=source.includes('// BEGIN GENERATED MACRO REFERENCES')?source.replace(/\/\/ BEGIN GENERATED MACRO REFERENCES[\s\S]*?\/\/ END GENERATED MACRO REFERENCES/,()=>block):source.replace('const NEWS_TRANSPORT_REVISION',()=>block+'\nconst NEWS_TRANSPORT_REVISION');
if(process.argv.includes('--check')){if(next!==source)throw Error('EMBEDDED_REFERENCE_SOURCE_DIFFERS_FROM_REVIEWED_MODULES');}else fs.writeFileSync(path,next);
