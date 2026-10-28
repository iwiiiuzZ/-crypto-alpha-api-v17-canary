import fs from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {requestJson,summarizeSample,summarizeReadContext,compareNewsBatches,observeNewsConsumption,assessSamples,cloudflareSnapshot,cloudflareBuildSnapshot,safeOutput,OpsError} from './diagnostics.mjs';

const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
const source=fs.readFileSync(new URL('../main-v188.js',import.meta.url),'utf8');
const sourceBuild=source.match(/const BUILD\s*=\s*"([^"]+)"/)?.[1];
if(!sourceBuild)throw new Error('LOCAL_BUILD_MISSING');
// An unmerged maintenance candidate can audit the explicitly pinned old deployment.
const build=process.env.EXPECTED_DEPLOYED_BUILD||sourceBuild;
const token=process.env.CLOUDFLARE_API_TOKEN,scanner=process.env.SCANNER_TOKEN;
const failures=[],samples=[],report={generatedAt:new Date().toISOString(),sourceBuild,expectedBuild:build,sourceIsDeploymentCandidate:sourceBuild!==build,mode:'READ_ONLY',errors:failures};
const code=e=>e instanceof OpsError?e.code:'INTERNAL_DIAGNOSTIC_ERROR';
try{report.cloudflare=await cloudflareSnapshot(fetch,config,token);}catch(e){failures.push({stage:'cloudflare',code:code(e)});}
if(!scanner)failures.push({stage:'scanner',code:'MISSING_SCANNER_TOKEN'});
// Deliberately never call scanner/run, scanner/test, plan, cancel, or force-refresh.
// The autonomous observation window uses only these two GETs.
if(token&&scanner){
  let began=Date.now();
  for(const offset of [0,25000,85000]){
    await delay(Math.max(0,began+offset-Date.now()));
    try{
      const [fast,status]=await Promise.all([requestJson(fetch,config.origin+'/?view=fast'),requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scanner})]);
      samples.push(summarizeSample(fast,status));
      if(samples.length===1)began=Date.parse(samples[0].readAt);
    }catch(e){failures.push({stage:'sample',code:code(e)});break;}
  }
}
if(token&&scanner&&!failures.length){
  try{
    report.cloudflareAfter=await cloudflareSnapshot(fetch,config,token);
    if(report.cloudflareAfter.deploymentId!==report.cloudflare?.deploymentId)failures.push({stage:'cloudflare',code:'DEPLOYMENT_CHANGED_DURING_OBSERVATION'});
  }catch(e){failures.push({stage:'cloudflare-after',code:code(e)});}
}
report.samples=samples;
report.assessment=assessSamples(samples,{...config,build});
// Maintenance-branch audit only: foreground market/news context is read AFTER
// the autonomous window and never counted as its successful background work.
if(process.env.INCLUDE_READ_CONTEXT==='1'&&samples.length===3){
  const context=await Promise.allSettled([requestJson(fetch,config.origin+'/'),requestJson(fetch,config.origin+'/?view=news')]);
  report.foregroundContext=summarizeReadContext(context[0].value,context[1].value);
  report.foregroundContext.errors=context.flatMap((r,i)=>r.status==='rejected'?[{endpoint:i===0?'market':'news',code:code(r.reason),reason:r.reason.reason||null,responseBudget:r.reason.responseBudget||null}]:[]);
  // A requested market/news read that failed must fail this audit, even when
  // the independent background observation window passed.
  failures.push(...report.foregroundContext.errors.map(e=>({stage:'foreground-'+e.endpoint,code:e.code,reason:e.reason})));
  report.newsBatchComparison=compareNewsBatches(samples.at(-1),report.foregroundContext);
  if(context[1].status==='fulfilled'){
    try{
      report.newsConsumptionFollowup=await observeNewsConsumption(()=>requestJson(fetch,config.origin+'/scanner/status',{authorization:'Bearer '+scanner}),report.foregroundContext,build);
      if(!report.newsConsumptionFollowup.passed)failures.push({stage:'news-consumption-followup',code:'NEW_SOURCE_BATCH_NOT_VERIFIED'});
    }catch(e){failures.push({stage:'news-consumption-followup',code:code(e)});}
  }
  try{report.buildConfiguration=await cloudflareBuildSnapshot(fetch,config,token);}
  catch(e){report.buildConfiguration={error:code(e)};}
}
const ok=!failures.length&&report.cloudflare?.bindingMatches&&report.cloudflare?.singleVersion&&report.assessment.operationalPassed;
report.result=ok?'OPERATIONAL_WINDOW_PASSED_WITH_LIMITS':failures.some(e=>e.code.startsWith('MISSING_'))?'AUTHORIZATION_REQUIRED':'DEGRADED';
const output=safeOutput(report,[token,scanner]);
fs.writeFileSync('ops-report.json',output);
const summary=['## 运行复核报告','',`结果：${report.result}`,'',...Object.entries(report.assessment.gates).map(([k,v])=>`- ${k}: ${v?'PASS':'FAIL'}`),'',...failures.map(e=>`- ${e.stage}: ${e.code}`),'','以上仅为观察窗口证据；不证明手机实收、长期稳定或存在交易机会。','报告只保留版本、时间、健康标志及聚合计数。'].join('\n');
fs.writeFileSync('ops-report.md',summary);
if(process.env.GITHUB_STEP_SUMMARY)fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,summary+'\n');
console.log(output);
if(!ok)process.exitCode=1;
