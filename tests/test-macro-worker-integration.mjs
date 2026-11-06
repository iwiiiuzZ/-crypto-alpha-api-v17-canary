import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fixture} from './v24-fixtures.mjs';
const raw=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
execFileSync(process.execPath,[new URL('../ops/embed-macro-reference.mjs',import.meta.url).pathname,'--check']);
let restored=raw.replace(/\/\/ BEGIN GENERATED MACRO REFERENCES[\s\S]*?\/\/ END GENERATED MACRO REFERENCES\n/,'');
const reverse=[
 ['const BUILD = "crypto-alpha-worker-v27.6.3-macro-r5h";','const BUILD = "crypto-alpha-worker-v27.6.3-macro-r5g";'],
 ['const BLS_COLLECTOR_REF = "crypto-alpha-collector-r5h-20261106";','const BLS_COLLECTOR_REF = "crypto-alpha-collector-r5g-20261101";'],
 ['function newsContextSummary(records,now=Date.now(),macroReferences=null) {','function newsContextSummary(records,now=Date.now()) {'],
 ['    treasuryDaily,macroReferences,headlines,recentRiskHeadlines:recent.filter(i=>i.riskTags.length),','    treasuryDaily,headlines,recentRiskHeadlines:recent.filter(i=>i.riskTags.length),'],
 ['    await owner.ctx.storage.put(NEWS_STATE_KEY,{records});\n    const macroReferences=await MacroReferences.cachedMacroReferences(owner);\n    return newsContextSummary(records,Date.now(),macroReferences);','    await owner.ctx.storage.put(NEWS_STATE_KEY,{records});return newsContextSummary(records);'],
 ['  const macroReferences=await MacroReferences.cachedMacroReferences(owner,{schedule:false});\n  const summary=newsContextSummary(records,Date.now(),macroReferences);','  const summary=newsContextSummary(records);'],
 ['    macroReferences:MacroReferences.macroReferenceReceipts(full.newsContext.macroReferences,new Date().toISOString()),\n',''],
 ['        macroReferenceReceipts:state[DISCOVERY_STATE_KEY]?.newsStatus?.macroReferences||null,\n','']
];
for(const [a,b] of reverse){assert.equal(restored.split(a).length-1,1,'expected one reviewed integration change');restored=restored.replace(a,()=>b);}
const bytes=Buffer.from(restored),blob=createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
assert.equal(blob,'75cd9af6323b90fcf411a1ff661a3bb3c7c2e81e','every original trading and notification rule must remain byte-identical outside reviewed reference plumbing');
const ids=['US_INITIAL_CLAIMS','US_CONTINUED_CLAIMS','IBIT_HOLDINGS','ETHA_HOLDINGS','OKX_ETH_OPTIONS','OKX_BTC_OPTIONS'];
for(const available of [true,false]){
 const f=fixture(),m=f.market(),at=new Date(f.now()-1000).toISOString();
 m.newsContext={status:'PARTIAL_VERIFIED_FEEDS',checkedAt:at,sources:{JIN10:{status:'ok',fetchedAt:at}},recentRiskHeadlines:[],upcomingEvents:[],macroReferences:{revision:'27.6.3-macro-reference-h1',sources:ids.map(id=>({id,status:available?'ok':'unavailable',fetchedAt:available?at:null,reason:available?null:'UPSTREAM_HTTP_429',data:available?{weekEnding:'2026-09-26'}:null}))}};
 f.setMarket(m);await f.t.runDiscovery(f.env);const status=await f.t.scannerStatus(f.env),receipts=status.diagnostics.macroReferenceReceipts;
 assert.equal(receipts.sources.length,6);assert.ok(Date.parse(receipts.consumedAt)>=Date.parse(at));
 assert.ok(receipts.sources.every(s=>s.status===(available?'ok':'unavailable')));
 assert.equal(status.diagnostics.newsSourceReceipts.JIN10.status,'ok');
 assert.ok(JSON.stringify(status).length<=24000);assert.equal(status.backendIdentity.matched,true);
}
console.log(JSON.stringify({passed:true,scope:'REAL_WORKER_FUNCTIONS_ISOLATED_MARKET_FIXTURES',originalGCoreReconstructionBlob:blob,sourceEmbeddingMatches:true,consumptionAndFailuresVerified:true,responseBudgetVerified:true}));
