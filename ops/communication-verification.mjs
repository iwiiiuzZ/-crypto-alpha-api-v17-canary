import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export async function verifyCommunication(fetcher,origin,token,authorized){
 if(authorized!==true)throw Error('EXPLICIT_SINGLE_TEST_AUTHORIZATION_REQUIRED');
 if(!token)throw Error('MISSING_SCANNER_TOKEN');
 const headers={authorization:'Bearer '+token};
 const request=async(path,method='GET')=>{const r=await fetcher(origin+path,{method,headers,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('COMMUNICATION_HTTP_'+r.status);return r.json();};
 const before=await request('/scanner/status'),expected='crypto-alpha-worker-v27.6.3-acceptance-candidate-r3';
 if(before.build!==expected||before.backendIdentity?.matched!==true||before.backendIdentity?.stateOwnerBuild!==expected)throw Error('TEST_IDENTITY_NOT_CONFIRMED');
 // Exactly one POST. A timeout/unknown outcome is never automatically retried.
 const sent=await request('/scanner/test','POST');
 const n=sent.notification;
 if(n?.sent!==true||n.auditPersisted!==true||!n.auditAttemptId)throw Error('PROVIDER_ACCEPTANCE_OR_AUDIT_NOT_CONFIRMED');
 const after=await request('/scanner/status');
 const attempt=after.notificationAudit?.recentAttempts?.find(a=>a.attemptId===n.auditAttemptId);
 if(attempt?.kind!=='CONTROL'||attempt.outcome!=='PROVIDER_ACCEPTED')throw Error('PERSISTED_ATTEMPT_NOT_MATCHED');
 return {scope:'ONE_EXPLICITLY_AUTHORIZED_COMMUNICATION_TEST_NOT_TRADING_SIGNAL',providerAccepted:true,auditMatched:true,acceptedAt:n.providerAcceptedAt,deviceReceiptVerified:false,preparedTradeChainVerified:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const config=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
 try{console.log(JSON.stringify(await verifyCommunication(fetch,config.origin,process.env.SCANNER_TOKEN,process.env.AUTHORIZED_SINGLE_TEST==='yes')));}
 catch(e){console.error(JSON.stringify({error:/^[A-Z_0-9]+$/.test(e.message)?e.message:'COMMUNICATION_CHECK_FAILED',automaticRetry:false,deviceReceiptVerified:false}));process.exitCode=1;}
}
