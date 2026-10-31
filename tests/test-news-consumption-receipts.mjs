import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeSample,compareNewsBatches} from '../ops/diagnostics.mjs';
const raw=readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
const code=raw.replace(/^export\s+(default\s+)?/gm,(_,def)=>def?'const defaultExport = ':'');
const {compactNewsSourceReceipts,boundedScannerStatus}=
  new Function(code+';return {compactNewsSourceReceipts,boundedScannerStatus};')();
const fetchedAt='2026-10-31T01:49:55.271Z';
const newsStatus={sources:{
 JIN10:{status:'ok',fetchedAt,items:[{title:'MUST_NOT_LEAK',url:'https://secret.example'}],parserRevision:'r5'},
 BEA_RELEASES:{status:'ok',fetchedAt:'2026-10-31T01:49:54Z',privateApiKey:'must-not-leak'},
 BLS_CPI:{status:'unavailable',fetchedAt:null,lastError:'sensitive upstream detail'},
 UNKNOWN_SOURCE:{status:'ok',fetchedAt}
}};
const receipts=compactNewsSourceReceipts(newsStatus);
assert.deepEqual(Object.keys(receipts).sort(),['BEA_RELEASES','BLS_CPI','JIN10']);
assert.equal(receipts.JIN10.fetchedAt,fetchedAt);
assert.equal(receipts.BLS_CPI.fetchedAt,null);
assert(!JSON.stringify(receipts).includes('MUST_NOT_LEAK'));
assert(!JSON.stringify(receipts).includes('must-not-leak'));
const bulky={
 build:'crypto-alpha-worker-v27.6.3-macro-r5',apiVersion:'7.6.0',
 heartbeat:{status:'completed',producerBuild:'crypto-alpha-worker-v27.6.3-macro-r5',
  lastSuccessfulCycleAt:'2026-10-31T01:50:00Z'},
 backendIdentity:{matched:true},configuration:{},activePlan:null,observationHistory:[],
 observations:Array.from({length:180},(_,i)=>({observationId:'OBS-'+i,revision:'r1',state:'APPROACHING',submodel:'A1',direction:'LONG',notificationDecision:{reason:'WAIT_FOR_CONFIRMATION',explanation:'x'.repeat(320)}})),failureHistory:[],runtime:null,notificationAudit:{recentAttempts:[]},
 discovery:{newsStatus:{sources:newsStatus.sources,huge:'x'.repeat(45000)}},
 diagnostics:{stateReadSucceeded:true,newsConsumption:{consumedAt:'2026-10-31T01:50:00Z'},
  newsSourceReceipts:receipts}
};
const compact=boundedScannerStatus(bulky);
assert(compact.diagnostics.detailsOmitted===true);
assert.equal(compact.discovery?.newsStatus?.sources,undefined);
assert.deepEqual(compact.diagnostics.newsSourceReceipts,receipts);
const status={build:'crypto-alpha-worker-v27.6.3-macro-r5',diagnostics:compact.diagnostics,
 backendIdentity:{matched:true},heartbeat:compact.heartbeat};
const sample=summarizeSample({},status,Date.parse('2026-10-31T01:50:10Z'));
assert.equal(sample.consumedNewsSources.length,3);
const comparisons=compareNewsBatches(sample,{newsSources:[
 {source:'JIN10',status:'ok',fetchedAt},
 {source:'BLS_CPI',status:'unavailable',fetchedAt:null}
]});
assert.equal(comparisons[0].verified,true);
assert.equal(comparisons[1].verified,false);
console.log('PASS compact status retains truthful per-source receipts while omitting large discovery body');
