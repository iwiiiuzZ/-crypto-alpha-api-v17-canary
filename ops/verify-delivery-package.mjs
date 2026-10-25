// Private delivery files stay outside the public repository. Never print their content.
// Usage: node ops/verify-delivery-package.mjs /absolute/extracted/package expected-build
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const [dir,expectedBuild]=process.argv.slice(2);
assert.ok(dir&&path.isAbsolute(dir)&&expectedBuild,'Provide package directory and expected source build');
const read=p=>fs.readFileSync(path.join(dir,p),'utf8');
const hash=s=>createHash('sha256').update(s).digest('hex');
const instructions=read('02_INSTRUCTIONS/CRYPTO_ALPHA_V27_INSTRUCTIONS.txt');
assert.ok([...instructions].length<=8000);
assert.match(instructions,/V27/);
assert.match(instructions,/市场候选、当前执行条件与监控状态分开/);
const knowledge=read('03_KNOWLEDGE/CRYPTO_ALPHA_V27_KNOWLEDGE_FULL.md');
const start=knowledge.indexOf('本文件是现有Crypto Alpha系统');
assert.ok(start>=0);
assert.equal(hash(knowledge.slice(start)),'269e7b798f76a3d2fba84c7a4b6481121f1d51fefe99155386abb3f929d59bd5');
const code=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
assert.equal(code.match(/const BUILD = "([^"]+)"/)?.[1],expectedBuild);
assert.match(code,/minimumNetRR: \{\s*SHORT: \{ B: 2, A: 2, "A\+": 2 \}/);
assert.match(code,/management: "USER_MANAGED"/);
assert.match(code,/STRUCTURE_MAX_COLLECTION_AGE_SECONDS = \{ "15m": 180, "1h": 420, "4h": 660 \}/);
const schema=JSON.parse(read('06_ACTION/openapi.json'));
const worker=await import('data:text/javascript;base64,'+Buffer.from(code+'\nexport {openApi};').toString('base64'));
assert.deepEqual(worker.openApi(schema.servers[0].url),schema);
const operations=Object.values(schema.paths).flatMap(p=>Object.values(p)).filter(op=>op?.operationId);
assert.equal(operations.length,4);
for(const op of operations)assert.ok((op.description||'').length<=300);
console.log(JSON.stringify({passed:true,scope:'DELIVERED_FILES_AND_CANDIDATE_SOURCE_NOT_INSTALLED_GPT',
  build:expectedBuild,instructionCharacters:[...instructions].length,originalKnowledgePreserved:true,
  instructionsSha256:hash(instructions),knowledgeSha256:hash(knowledge),schemaSha256:hash(read('06_ACTION/openapi.json')),
  sourceSha256:hash(code),generatedSchemaMatches:true,operations:operations.length}));
