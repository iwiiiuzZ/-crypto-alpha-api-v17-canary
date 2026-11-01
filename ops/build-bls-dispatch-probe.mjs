// Extract the exact candidate functions for a temporary stateless egress check.
export async function buildDispatchProbe(source){
 const functions=['compactBlsRelayDispatch','requestOfficialBlsCollection','maintainOfficialBlsRelay','officialBlsRelayUrl','officialBlsRelayRecord'];
 const constants=['BLS_DISPATCH_STATE_KEY','BLS_DISPATCH_REFRESH_MS','BLS_DISPATCH_IDS','BLS_RELAY_STATE_KEY','BLS_RELAY_MAX_AGE_MS','NEWS_SOURCES'];
 const implementation=await import('data:text/javascript;base64,'+Buffer.from(source+'\nexport {'+[...functions,...constants].join(',')+'};').toString('base64'));
 const code=constants.map(k=>'const '+k+'='+JSON.stringify(implementation[k])+';').join('\n')+'\n'+functions.map(k=>implementation[k].toString()).join('\n');
 return code+`
 export default {async fetch(request,env){
  if(request.method!=='POST'||request.headers.get('x-probe-token')!==env.PROBE_TOKEN)return new Response(null,{status:401});
  const records=new Map();
  const owner={env:{GITHUB_ACTIONS_DISPATCH_TOKEN:env.DISPATCH_TOKEN},ctx:{storage:{get:async key=>structuredClone(records.get(key)),put:async(key,value)=>records.set(key,structuredClone(value))}}};
  const first=await maintainOfficialBlsRelay(owner),second=await maintainOfficialBlsRelay(owner);
  return Response.json({scope:'EXACT_CANDIDATE_DISPATCH_FUNCTIONS_EPHEMERAL_TEST_TOKEN_NOT_PRODUCTION_INSTALLATION',first,second,
   requestAcknowledged:first.status==='AWAITING_SOURCE_RECEIPT',deduplicated:first.attemptCount===1&&second.attemptCount===1,
   sourceReceiptVerified:false,deviceNotificationSent:false,tradeSignalGenerated:false},{headers:{'cache-control':'no-store'}});
 }};`;
}
