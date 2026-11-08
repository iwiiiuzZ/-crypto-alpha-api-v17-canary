import {reconcileMacroReferences} from '../ops/macro-reference-consumption-check.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixture} from './v24-fixtures.mjs';
const raw=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
execFileSync(process.execPath,[new URL('../ops/embed-macro-reference.mjs',import.meta.url).pathname,'--check']);
// First reverse the exact, reviewed desk diff and verify the immutable R5i source.
const scratch=fs.mkdtempSync(join(tmpdir(),'alpha-desk-macro-'));
let r5i;
try {
 fs.writeFileSync(join(scratch,'main-v188.js'),raw);
 execFileSync('git',['apply','--reverse',fileURLToPath(new URL('./baselines/desk-dual-r3.patch',import.meta.url))],{cwd:scratch});
 execFileSync('git',['apply','--reverse',fileURLToPath(new URL('./baselines/desk-dual-r2.patch',import.meta.url))],{cwd:scratch});
 r5i=fs.readFileSync(join(scratch,'main-v188.js'),'utf8');
} finally { fs.rmSync(scratch,{recursive:true,force:true}); }
const r5iBytes=Buffer.from(r5i);
assert.equal(createHash('sha1').update(Buffer.from('blob '+r5iBytes.length+'\0')).update(r5iBytes).digest('hex'),'c8ffcd07d8ea4d1a21331f5aa18e7ce08dd77f49');
let restored=r5i.replace(/\/\/ BEGIN GENERATED MACRO REFERENCES[\s\S]*?\/\/ END GENERATED MACRO REFERENCES\n/,'');
const reverse=[
 ['  if(!fits()&&MacroReferences.compactNewsReferenceTransport(out))note("SOURCE_OPERATIONAL_DETAILS_IN_FULL_NEWS_VIEW");\n  if(!fits()&&MacroReferences.compactNewsReferenceTransport(out,{calendarPreview:true}))note("FUTURE_CALENDAR_PREVIEW_FULL_LIST_IN_NEWS_VIEW");\n  if(!fits()&&MacroReferences.compactNewsReferenceTransport(out,{riskHeadersOnly:true}))note("FULL_RISK_HEADLINE_TEXT_IN_NEWS_VIEW");\n',''],
 ["  if(payload?.references!==undefined)return MacroReferences.acceptClaimsReferenceRelay(payload,env,{get:scannerStateGet,put:scannerStatePut});\n",''],
 ['const BUILD = "crypto-alpha-worker-v27.6.3-macro-r5i";','const BUILD = "crypto-alpha-worker-v27.6.3-macro-r5g";'],
 ['const BLS_COLLECTOR_REF = "crypto-alpha-collector-r5i-20261106";','const BLS_COLLECTOR_REF = "crypto-alpha-collector-r5g-20261101";'],
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

const auditNow=Date.now(),stamp=new Date(auditNow-1000).toISOString(),build='crypto-alpha-worker-v27.6.3-macro-r5i';
const context={sources:ids.map(id=>({id,status:'ok',fetchedAt:stamp,transport:'DIRECT'}))};
const status={backendIdentity:{matched:true,frontendBuild:build,stateOwnerBuild:build},diagnostics:{macroReferenceReceipts:{consumedAt:new Date(auditNow).toISOString(),sources:ids.map(source=>({source,status:'ok',fetchedAt:stamp,transport:'DIRECT'}))}}};
assert.equal(reconcileMacroReferences(context,status,{now:auditNow,build}).passed,true);
const unconsumed=structuredClone(status);unconsumed.diagnostics.macroReferenceReceipts.sources[0].fetchedAt=new Date(auditNow-2000).toISOString();assert.equal(reconcileMacroReferences(context,unconsumed,{now:auditNow,build}).passed,false);
const stale=structuredClone(context);stale.sources[4].fetchedAt=new Date(auditNow-180001).toISOString();assert.equal(reconcileMacroReferences(stale,status,{now:auditNow,build}).passed,false);
const wrongBuild=structuredClone(status);wrongBuild.backendIdentity.stateOwnerBuild='old';assert.equal(reconcileMacroReferences(context,wrongBuild,{now:auditNow,build}).passed,false);
