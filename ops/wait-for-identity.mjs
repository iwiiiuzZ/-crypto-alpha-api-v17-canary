import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {requestJson,summarizeSample,safeOutput,OpsError} from './diagnostics.mjs';

// Propagation is recorded separately. This gate never certifies quote health.
export function identityConverged(samples,expected){
 if(samples.length<2)return false;
 return samples.slice(-2).every(s=>{
  const i=s.identity||{},scan=s.scanner||{},now=Date.parse(s.readAt);
  const fresh=t=>Number.isFinite(Date.parse(t))&&now-Date.parse(t)>=-5000&&now-Date.parse(t)<=180000;
  return s.build===expected.build&&s.apiVersion===expected.apiVersion&&i.matched===true
   &&i.frontendBuild===expected.build&&i.stateOwnerBuild===expected.build&&i.stateOwnerContract===expected.stateContract
   &&scan.build===expected.build&&scan.identityMatched===true&&scan.stateReadSucceeded===true
   &&scan.producerBuild===expected.build&&fresh(scan.lastSuccessfulCycleAt)
   &&s.receipts?.some(r=>r.producerBuild===expected.build&&r.status==='completed'&&r.inspectedModels===8&&r.modelDataReady===true&&fresh(r.completedAt));
 });
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
 const expected={...config,build:source.match(/const BUILD\s*=\s*"([^"]+)"/)[1]};
 const scanner=process.env.SCANNER_TOKEN;
 if(!scanner)throw new OpsError('MISSING_SCANNER_TOKEN');
 const samples=[],start=Date.now();let passed=false;
 while(Date.now()-start<600000){
  try{
   const [fast,status]=await Promise.all([requestJson(fetch,config.origin+'/?view=fast'),requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scanner})]);
   const sample=summarizeSample(fast,status);samples.push(sample);
   console.log(safeOutput({phase:'DEPLOYMENT_PROPAGATION_NOT_ACCEPTANCE',readAt:sample.readAt,identity:sample.identity,scanner:sample.scanner,receipts:sample.receipts,health:sample.health},[scanner]));
   if(identityConverged(samples,expected)){passed=true;break;}
  }catch(e){samples.length=0;console.log(safeOutput({phase:'DEPLOYMENT_PROPAGATION_NOT_ACCEPTANCE',readAt:new Date().toISOString(),error:e instanceof OpsError?e.code:'IDENTITY_READ_FAILED'},[scanner]));}
  await delay(Math.min(15000,Math.max(0,600000-(Date.now()-start))));
 }
 console.log(JSON.stringify({phase:'DEPLOYMENT_PROPAGATION_NOT_ACCEPTANCE',identityConverged:passed,expectedBuild:expected.build,elapsedSeconds:(Date.now()-start)/1000,healthAccepted:false}));
 if(!passed)process.exitCode=1;
}
