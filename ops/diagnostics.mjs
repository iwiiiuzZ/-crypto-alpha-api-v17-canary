import {createHash} from 'node:crypto';

export const WINDOW_MS=85000;
const at=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;
const stamp=v=>Number.isFinite(at(v))?new Date(at(v)).toISOString():null;
const word=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,120}$/.test(v)?v:null;
const number=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
const enumCode=v=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,119}$/.test(v)?v:null;
const age=(v,now)=>Number.isFinite(at(v))?(now-at(v))/1000:null;
const fresh=(v,now,max)=>{const a=age(v,now);return a!==null&&a>=-5&&a<=max;};
const NEWS_IDS=['JIN10','COINDESK','FED_PRESS','FED_SPEECH','BLS_CPI','BLS_EMPLOYMENT','BLS_CALENDAR','NYFED_CALENDAR'];
export class OpsError extends Error {constructor(code){super(code);this.code=code;}}

// Public CI logs contain aggregate stages only: never prices, IDs, messages or secrets.
export function summarizeCandidateChain(status){
  const omitted=status?.diagnostics?.detailsOmitted===true||status?.diagnostics?.historyOmittedForResponseBudget===true;
  const active=Array.isArray(status?.observations)?status.observations:null;
  const history=Array.isArray(status?.observationHistory)?status.observationHistory:null;
  const aggregate=rows=>{
    if(!rows)return null;
    const groups=new Map();
    for(const r of rows){
      const d=r?.notificationDecision,card=r?.preparedTrade;
      const row={model:['A1','A2','B1','B2','C1','C2','D1','D2'].includes(r?.submodel)?r.submodel:null,
        state:enumCode(r?.state),reason:enumCode(d?.reason||r?.reason),progress:enumCode(d?.modelProgress),
        swingReason:enumCode(d?.swingReason),pushStatus:enumCode(d?.currentStagePushStatus),
        technicalCardPresent:card?true:Object.hasOwn(r||{},'preparedTrade')?false:null,
        executionPermission:enumCode(card?.executionPermission),decisionAvailable:!!d,
        structureReady:typeof d?.structureReady==='boolean'?d.structureReady:null,
        technicalCandidatePresent:typeof d?.technicalCandidatePresent==='boolean'?d.technicalCandidatePresent:null,
        triggerConfirmed:typeof d?.triggerAt==='string'&&Number.isFinite(at(d.triggerAt))};
      const key=JSON.stringify(row);groups.set(key,{...row,count:(groups.get(key)?.count||0)+1});
    }
    return [...groups.values()];
  };
  const audit=status?.notificationAudit;
  const attempts=Array.isArray(audit?.recentAttempts)?audit.recentAttempts:[];
  return {stateReadSucceeded:status?.diagnostics?.stateReadSucceeded===true,detailsOmitted:omitted,
    activeCount:active?.length??null,returnedHistoryCount:history?.length??null,
    historyCoverage:'BOUNDED_STATUS_HISTORY_NOT_COMPLETE_HISTORY',active:aggregate(active),history:aggregate(history),
    activePlanPresent:status?.activePlan?true:Object.hasOwn(status||{},'activePlan')?false:null,
    auditFirstRecordedAt:stamp(audit?.firstRecordedAt),auditUpdatedAt:stamp(audit?.updatedAt),retainedAttempts:number(audit?.retainedAttempts),
    recentAttemptStages:attempts.map(a=>({kind:enumCode(a.kind),stage:enumCode(a.stage),outcome:enumCode(a.outcome),attemptedAt:stamp(a.attemptedAt),completedAt:stamp(a.completedAt)})),
    pendingByKind:Object.fromEntries(['Observation','News','Dynamic','Plan','Fast','Progress'].map(k=>[k,number(status?.diagnostics?.['pending'+k+'Pushes'])])),
    preparedNotificationLiveVerified:false,deviceReceiptVerified:false};
}

export function summarizeReadContext(market,news){
 const sources=news?.newsContext?.sources||{};
 return {marketGeneratedAt:stamp(market?.generatedAt),decisionState:word(market?.decisionState),
  structure:['ETHUSDT','BTCUSDT'].flatMap(symbol=>['15m','1h','4h'].map(tf=>{
   const t=market?.assets?.[symbol]?.timeframes?.[tf],q=t?.quality||{};
   return {symbol,timeframe:tf,status:word(t?.status),source:word(t?.source),qualityPassed:q.passed===true,
    count:number(t?.candleCount),newestClosedAt:stamp(q.newestClosedCandleAt),expectedClosedAt:stamp(q.expectedLastClosedStart),continuityRatio:number(q.continuityRatio),nonZeroVolumeRatio:number(q.nonZeroVolumeRatio),collectionAgeSeconds:number(t?.coordinator?.collectionAgeSeconds)};
  })),
  models:(market?.assets?.ETHUSDT?.opportunityEngine?.models||[]).map(m=>({model:word(m.submodel),state:word(m.state),failedGate:enumCode(m.failedGate),swingState:word(m.swingAssessment?.state),swingReason:enumCode(m.swingAssessment?.reason)})),
  newsCheckedAt:stamp(news?.newsContext?.checkedAt),newsSources:Object.entries(sources).filter(([k])=>NEWS_IDS.includes(k)).map(([source,v])=>({source,status:word(v.status),httpStatus:number(v.httpStatus),fetchedAt:stamp(v.fetchedAt),publishedAt:stamp(v.latestPublishedAt),retryAt:stamp(v.nextAttemptAt),lastAttemptAt:stamp(v.lastAttemptAt),cacheState:word(v.cacheState)})),
  evidenceScope:'FOREGROUND_READ_AFTER_AUTONOMOUS_WINDOW_NOT_BACKGROUND_PROOF'};
}

export async function requestJson(fetcher,url,headers={}){
  let r;
  try{r=await fetcher(url,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/json',...headers},signal:AbortSignal.timeout(15000)});}catch{throw new OpsError('REQUEST_FAILED');}
  if(!r.ok)throw new OpsError('HTTP_'+r.status);
  const reader=r.body?.getReader();let size=0,parts=[];
  if(!reader)throw new OpsError('EMPTY_RESPONSE');
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1048576){await reader.cancel();throw new OpsError('RESPONSE_TOO_LARGE');}parts.push(Buffer.from(value));}
  try{return JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{throw new OpsError('INVALID_JSON');}
}

export function summarizeSample(fast,status,now=Date.now()){
  const f=fast?.fastMonitor||{},d=status?.diagnostics||{},identity=fast?.backendIdentity||{},review=f.fullReview||{};
  const receipts=[review,review.lastSharedCycle,review.lastCompletedReview].filter(Boolean).map(r=>({producerBuild:word(r.producerBuild),status:word(r.status),inspectedModels:number(r.inspectedModels),modelDataReady:r.modelDataReady===true,checkedAt:stamp(r.checkedAt),completedAt:stamp(r.completedAt||r.lastCompletedAt)}));
  const kinds=new Set(['OBSERVATION','NEWS','DYNAMIC_PRICE','PLAN','FAST_FLOW','OPPORTUNITY_PROGRESS','CONTROL']);
  return {readAt:new Date(now).toISOString(),build:word(fast?.build),apiVersion:word(fast?.apiVersion),
    identity:{frontendBuild:word(identity.frontendBuild),stateOwnerBuild:word(identity.stateOwnerBuild),stateOwnerContract:word(identity.stateOwnerContract),matched:identity.matched===true},
    health:{sampling:f.samplingHealthy===true,quote:f.quoteHealthy===true,flow:f.flowHealthy===true,lastSuccessAt:stamp(f.lastSuccessAt),lastTradeAt:stamp(f.executionQuote?.lastTradeTimestamp),bookAt:stamp(f.executionQuote?.bookTimestamp),dataAgeSeconds:number(f.dataAgeSeconds),gapSeconds:number(f.actualLastGapSeconds)},
    receipts,
    scanner:{build:word(status?.build),stateReadSucceeded:d.stateReadSucceeded===true,identityMatched:status?.backendIdentity?.matched===true,status:word(status?.heartbeat?.status),producerBuild:word(status?.heartbeat?.producerBuild),lastCompletedAt:stamp(status?.heartbeat?.lastCompletedAt),lastSuccessfulCycleAt:stamp(status?.heartbeat?.lastSuccessfulCycleAt),newsConsumedAt:stamp(d.newsConsumption?.consumedAt),pendingPushes:number(d.pendingPushes)},
    notifications:{auditStatus:word(status?.notificationAudit?.status),channels:(status?.notificationAudit?.channels||[]).filter(c=>kinds.has(c.kind)).map(c=>({kind:c.kind,attempts:number(c.attempts),accepted:number(c.accepted),failures:number(c.failures)})),deviceReceiptVerified:false},
    consumedNewsSources:NEWS_IDS.filter(k=>status?.discovery?.newsStatus?.sources?.[k]).map(source=>({source,status:word(status.discovery.newsStatus.sources[source].status),fetchedAt:stamp(status.discovery.newsStatus.sources[source].fetchedAt)})),
    candidateChain:summarizeCandidateChain(status)};
}

export function compareNewsBatches(sample,context){
  return (context?.newsSources||[]).map(s=>{
    const consumed=sample?.consumedNewsSources?.find(c=>c.source===s.source);
    return {source:s.source,observedBatchAt:s.fetchedAt,consumedBatchAt:consumed?.fetchedAt??null,
      verified:s.status==='ok'&&consumed?.status==='ok'&&!!s.fetchedAt&&consumed.fetchedAt===s.fetchedAt&&at(sample.scanner.newsConsumedAt)>=at(s.fetchedAt),
      meaning:consumed?'EXACT_SOURCE_BATCH_TIMESTAMP_COMPARISON':'SOURCE_DETAILS_NOT_RETURNED'};
  });
}

// Read build configuration without exposing commands, environment variables,
// build tokens, other Workers, or repository connection credentials in logs.
export async function cloudflareBuildSnapshot(fetcher,config,token){
  if(!token)throw new OpsError('MISSING_CLOUDFLARE_API_TOKEN');
  const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(config.accountId);
  const headers={authorization:'Bearer '+token};
  const scripts=await requestJson(fetcher,base+'/workers/scripts',headers);
  if(scripts.success!==true||!Array.isArray(scripts.result))throw new OpsError('WORKER_LIST_NOT_RETURNED');
  const target=scripts.result.find(s=>s.id===config.worker);
  if(!target?.tag)throw new OpsError('TARGET_WORKER_TAG_NOT_RETURNED');
  const response=await requestJson(fetcher,base+'/builds/workers/'+encodeURIComponent(target.tag)+'/triggers',headers);
  if(response.success!==true||!Array.isArray(response.result))throw new OpsError('BUILD_TRIGGERS_NOT_RETURNED');
  return {worker:config.worker,triggers:response.result.map(t=>({id:word(t.trigger_uuid),
    includesMain:Array.isArray(t.branch_includes)&&t.branch_includes.includes('main'),
    excludesMain:Array.isArray(t.branch_excludes)&&t.branch_excludes.includes('main'),
    exactMainOnly:Array.isArray(t.branch_includes)&&t.branch_includes.length===1&&t.branch_includes[0]==='main'&&!(t.branch_excludes||[]).length,
    rootDirectoryMatches:['','/','.'].includes(t.root_directory),
    checkedDeployCommand:t.deploy_command?.trim()==='npm run deploy:checked',
    standardWranglerDeploy:['npx wrangler deploy','npx wrangler deploy --keep-vars'].includes(t.deploy_command?.trim()),
    buildCommandPresent:!!t.build_command?.trim()}))};
}

export function assessSamples(samples,expected){
  const first=samples[0],last=samples.at(-1),start=at(first?.readAt),end=at(last?.readAt);
  const advanced=k=>Number.isFinite(at(first?.health[k]))&&at(last?.health[k])>at(first.health[k]);
  const newestReceipt=last?.receipts.filter(r=>r.producerBuild===expected.build&&r.inspectedModels===8&&r.modelDataReady&&r.status==='completed').sort((a,b)=>at(b.completedAt)-at(a.completedAt))[0];
  const gates={
    observationWindow:samples.length>=3&&end-start>=WINDOW_MS,
    versionIdentity:samples.length>=3&&samples.every(s=>s.build===expected.build&&s.apiVersion===expected.apiVersion&&s.identity.matched&&s.identity.frontendBuild===expected.build&&s.identity.stateOwnerBuild===expected.build&&s.identity.stateOwnerContract===expected.stateContract),
    independentHealth:samples.length>=3&&samples.every(s=>s.health.sampling&&s.health.quote&&s.health.flow&&fresh(s.health.lastSuccessAt,at(s.readAt),25)&&fresh(s.health.lastTradeAt,at(s.readAt),10)&&fresh(s.health.bookAt,at(s.readAt),10)),
    autonomousSamples:advanced('lastSuccessAt')&&advanced('lastTradeAt')&&advanced('bookAt'),
    // A new cycle may already be running; require a new successful completion,
    // rather than an instantaneous idle/completed phase or a mere new attempt.
    minuteScanner:!!last&&last.scanner.stateReadSucceeded&&last.scanner.identityMatched&&last.scanner.build===expected.build&&last.scanner.producerBuild===expected.build&&['completed','running'].includes(last.scanner.status)&&fresh(last.scanner.lastSuccessfulCycleAt,end,180)&&at(last.scanner.lastSuccessfulCycleAt)>start&&at(last.scanner.lastSuccessfulCycleAt)>at(first.scanner.lastSuccessfulCycleAt),
    newEightModelReview:!!newestReceipt&&at(newestReceipt.checkedAt)>=start&&at(newestReceipt.completedAt)>=start&&fresh(newestReceipt.completedAt,end,180),
    newsConsumer:!!last&&fresh(last.scanner.newsConsumedAt,end,180)&&at(last.scanner.newsConsumedAt)>start&&at(last.scanner.newsConsumedAt)>at(first.scanner.newsConsumedAt)
  };
  return {gates,operationalPassed:Object.values(gates).every(Boolean),failedGates:Object.keys(gates).filter(k=>!gates[k]),
    limits:{coverage:'SAMPLED_WINDOW_NOT_LONG_TERM_STABILITY',latestNewsBatchConsumed:'NOT_INDEPENDENTLY_VERIFIED',pushRetryRecovery:'NOT_PROVEN_BY_EMPTY_QUEUES',deviceReceipt:'NOT_VERIFIED',tradingOpportunity:'NOT_INFERRED_FROM_SYSTEM_HEALTH'}};
}

export async function cloudflareSnapshot(fetcher,config,token){
  if(!token)throw new OpsError('MISSING_CLOUDFLARE_API_TOKEN');
  const base='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(config.accountId)+'/workers/scripts/'+encodeURIComponent(config.worker);
  const headers={authorization:'Bearer '+token};
  const [settings,deployments]=await Promise.all([requestJson(fetcher,base+'/settings',headers),requestJson(fetcher,base+'/deployments',headers)]);
  if(settings.success!==true||deployments.success!==true)throw new OpsError('CLOUDFLARE_API_REJECTED');
  const binding=settings.result?.bindings?.find(b=>b.name===config.stateBinding);
  const rows=Array.isArray(deployments.result)?deployments.result:deployments.result?.deployments;
  if(!Array.isArray(rows)||!rows.length)throw new OpsError('NO_DEPLOYMENT_RETURNED');
  const active=[...rows].sort((a,b)=>at(b.created_on)-at(a.created_on))[0];
  const versions=(active.versions||[]).map(v=>({id:word(v.version_id),percentage:number(v.percentage)}));
  return {deploymentId:word(active.id),deployedAt:stamp(active.created_on),versions,
    binding:{present:!!binding,className:word(binding?.class_name),scriptName:word(binding?.script_name)||null,namespaceFingerprint:binding?.namespace_id?createHash('sha256').update(String(binding.namespace_id)).digest('hex').slice(0,12):null},
    bindingMatches:!!binding&&binding.class_name===config.stateClass&&(!binding.script_name||binding.script_name===config.worker),
    singleVersion:versions.length===1&&versions[0].percentage===100};
}

export function safeOutput(value,secrets=[]){
  let text=JSON.stringify(value,null,2);
  for(const s of secrets.filter(s=>typeof s==='string'&&s.length>=4))text=text.split(s).join('[REDACTED]');
  return text;
}
