import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const raw=readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
const code=raw.replace(/^export\s+(default\s+)?/gm,(_,def)=>def?'const defaultExport = ':'');
const {officialBlsRelayUrl,officialBlsRelayRecord,acceptOfficialBlsRelay,newsContextSummary,parseNewsXml,scannerAuthorized}=
  new Function(code+';return {officialBlsRelayUrl,officialBlsRelayRecord,acceptOfficialBlsRelay,newsContextSummary,parseNewsXml,scannerAuthorized};')();
const now=Date.now(),fetchedAt=new Date(now-60000).toISOString(),receivedAt=new Date(now-30000).toISOString();
const origin='https://www.bls.gov/feed/cpi.rss',xml='<rss><channel><item><title>Consumer Price Index CPI</title><link>https://www.bls.gov/news.release/cpi.htm</link><pubDate>'+new Date(now-120000).toUTCString()+'</pubDate></item></channel></rss>';
const sha256=createHash('sha256').update(xml).digest('hex');
const input={sources:[{id:'BLS_CPI',sourceUrl:origin,body:xml,fetchedAt,sha256}]};
const kv=new Map(),env={ALERT_STATE:{get:async(key)=>kv.get(key)||null,put:async(key,json)=>kv.set(key,JSON.parse(json))}};
const req=obj=>new Request('https://worker.test/scanner/official-macro-relay',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(obj)});
assert.equal(scannerAuthorized(new Request('https://worker.test',{headers:{authorization:'Bearer accepted'}}),{SCANNER_TOKEN:'accepted'}),true);
assert.equal(scannerAuthorized(new Request('https://worker.test',{headers:{authorization:'Bearer invalid'}}),{SCANNER_TOKEN:'accepted'}),false);
assert.equal(officialBlsRelayUrl('BLS_CPI'),origin);
assert.equal(officialBlsRelayUrl('OTHER_FAKE'),null);
const good=await acceptOfficialBlsRelay(req(input),env);
assert.equal(good.status,'OFFICIAL_BLS_RELAY_ACCEPTED');
assert.deepEqual(good.accepted,['BLS_CPI']);
assert.equal(good.tradeSignalGenerated,false);
const stored=kv.get('news:bls-official-relay:v1').records.BLS_CPI;
assert(officialBlsRelayRecord(stored,'BLS_CPI',Date.now()));
assert(!officialBlsRelayRecord(stored,'BLS_CPI',now+21*60000));
const rows=parseNewsXml(stored.body,stored.id,stored.fetchedAt);
assert.equal(rows.length,1);
assert.equal(rows[0].tradeDirection,null);
const context=newsContextSummary({BLS_CPI:{status:'ok',fetchedAt,sourceProvenance:'AUTHORIZED_GITHUB_ACTIONS_BLS_RELAY_DELAYED',items:rows}});
assert.equal(context.recentRiskHeadlines.length,0,'delayed relay may not synthesize seconds-level trade news');
assert.equal(context.sources.BLS_CPI.sourceProvenance,'AUTHORIZED_GITHUB_ACTIONS_BLS_RELAY_DELAYED');
const invalid=[
 {sources:[{...input.sources[0],sha256:'a'.repeat(64)}]},
 {sources:[{...input.sources[0],sourceUrl:'https://attacker.example/news'}]},
 {sources:[{...input.sources[0],id:'UNLISTED_SOURCE'}]},
 {sources:[{...input.sources[0],fetchedAt:new Date(now-3600000).toISOString()}]},
 {sources:[input.sources[0],input.sources[0]]},
 {sources:[{...input.sources[0],body:'not xml',sha256:createHash('sha256').update('not xml').digest('hex')}]}
];
for(const payload of invalid){const r=await acceptOfficialBlsRelay(req(payload),env);assert(r.error,JSON.stringify(r));}
assert.equal(kv.get('news:bls-official-relay:v1').records.BLS_CPI.sha256,sha256,'invalid relay cannot alter persisted official feed');
console.log('PASS official BLS authenticated relay integrity, origin, TTL, no fake signals and fail-closed invalid payloads');
