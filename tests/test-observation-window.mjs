import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectObservationWindow} from '../ops/observation-window.mjs';
import {assessSamples} from '../ops/diagnostics.mjs';

async function run(failures={}) {
  let clock=Date.parse('2026-11-12T02:00:00Z'),count=0;
  const calls=[];
  const result=await collectObservationWindow({origin:'https://example.test',scanner:'PRIVATE_TEST_TOKEN',
    now:()=>clock,wait:async ms=>{clock+=ms;},
    fetcher:async (url,options)=>{
      const attempt=Math.floor(count++/2)+1,endpoint=url.includes('view=fast')?'fast':'scanner';
      calls.push({attempt,endpoint,method:options.method,url});
      assert.equal(options.method,'GET');
      assert.equal(options.cache,'no-store');
      if(endpoint==='scanner')assert.equal(options.headers.authorization,'Bearer PRIVATE_TEST_TOKEN');
      if(failures[attempt]?.includes(endpoint))return new Response(JSON.stringify({error:'SECRET_PAYLOAD'}),{status:503});
      if(endpoint==='scanner'&&failures[attempt]?.includes('state'))return Response.json({status:'unavailable',diagnostics:{stateReadSucceeded:false}});
      const time=new Date(clock).toISOString();
      return Response.json(endpoint==='fast'?{build:'r4',fastMonitor:{lastSuccessAt:time,quoteHealthy:true,private:'SECRET_PAYLOAD'}}:
        {build:'r4',diagnostics:{stateReadSucceeded:true,newsConsumption:{consumedAt:time},newsSourceReceipts:{JIN10:{status:'ok',fetchedAt:time}}},private:'SECRET_PAYLOAD'});
    }});
  assert.equal(calls.length,6,'all three paired reads happen even after failure');
  assert.ok(calls.every(c=>c.url==='https://example.test/?view=fast'||c.url==='https://example.test/scanner/status'));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE_TEST_TOKEN|SECRET_PAYLOAD/);
  return result;
}

const healthy=await run();
assert.equal(healthy.samples.length,3);
assert.equal(healthy.errors.length,0);
assert.equal(Date.parse(healthy.samples[2].readAt)-Date.parse(healthy.samples[0].readAt),85000);

const transient=await run({1:['fast']});
assert.equal(transient.samples.length,2);
assert.deepEqual(transient.errors,[{stage:'sample',attempt:1,endpoint:'fast',code:'HTTP_503'}]);
assert.equal(transient.attempts[0].partialEvidence.scanner.stateReadSucceeded,true);
assert.equal(transient.attempts[0].newsCoverage.rows.find(x=>x.source==='JIN10').current,true);
assert.equal(assessSamples(transient.samples,{}).operationalPassed,false,'recovery cannot erase an interrupted window');

const statusDown=await run({1:['scanner'],2:['scanner'],3:['scanner']});
assert.equal(statusDown.samples.length,0);
assert.equal(statusDown.errors.length,3);
assert.equal(statusDown.attempts[2].partialEvidence.health.quote,true);
assert.deepEqual(statusDown.attempts[2].newsCoverage,{passed:false,assessed:false,reason:'SCANNER_STATUS_UNAVAILABLE',rows:[]});

const bothDown=await run({1:['fast','scanner'],2:['fast','scanner'],3:['fast','scanner']});
assert.equal(bothDown.errors.length,6);
assert.equal(bothDown.samples.length,0);

const lastStatusDown=await run({3:['scanner']});
assert.equal(lastStatusDown.samples.length,2);
assert.equal(lastStatusDown.attempts.at(-1).newsCoverage.assessed,false,'old success cannot stand in for final unavailable status');
const unreadableState=await run({3:['state']});
assert.equal(unreadableState.attempts.at(-1).newsCoverage.reason,'SCANNER_STATE_UNAVAILABLE','HTTP 200 is not proof of readable scanner state');
assert.equal(assessSamples(unreadableState.samples,{}).operationalPassed,false);
const script=readFileSync(new URL('../ops/maintenance.mjs',import.meta.url),'utf8');
assert.match(script,/const ok=!failures.length/,'all request failures still fail the audit');
assert.match(script,/report\.sampleAttempts\?\.at\(-1\)\?\.newsCoverage/);
console.log('PASS: independent endpoint evidence, bounded recovery window, honest news gaps and no failure masking');
