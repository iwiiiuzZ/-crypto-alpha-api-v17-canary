import assert from 'node:assert/strict';
import {summarizeR5NewsAudit} from '../ops/r5-news-consumption-check.mjs';
const goodSources=['JIN10','COINDESK','FED_PRESS','FED_SPEECH','BEA_RELEASES','BOJ_RELEASES','NYFED_CALENDAR'];
const context={newsSources:[
 ...goodSources.map(source=>({source,status:'ok',fetchedAt:'2026-10-31T01:40:00Z'})),
 {source:'BLS_CPI',status:'unavailable',httpStatus:403,fetchedAt:'2026-10-21T01:40:00Z',cacheState:'stale-on-error'}
]};
const observed={passed:true,observations:[{newsConsumedAt:'2026-10-31T01:40:15Z',comparisons:goodSources.map(source=>({source,verified:true,meaning:'SOURCE_BATCH_MATCH'}))}]};
const yes=summarizeR5NewsAudit(observed,context);
assert.equal(yes.passed,true);
assert.equal(yes.verifiedSources.length,7);
assert.deepEqual(yes.unavailableSources.map(x=>x.source),['BLS_CPI']);
assert.equal(yes.unavailableSources[0].httpStatus,403);
assert.equal(summarizeR5NewsAudit({...observed,passed:false},context).passed,false);
assert.equal(summarizeR5NewsAudit(observed,{newsSources:context.newsSources.slice(0,3)}).passed,false);
console.log('PASS news audit distinguishes verified consumption from stale BLS 403 limitations');
