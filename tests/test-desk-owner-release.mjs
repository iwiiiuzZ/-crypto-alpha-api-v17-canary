import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validOwnerRelease} from '../ops/desk-owner-release.mjs';
const source=Buffer.from('reviewed worker'),sha=createHash('sha1').update(Buffer.from('blob '+source.length+'\0')).update(source).digest('hex');
const env={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'iwiiiuzZ/-crypto-alpha-api-v17-canary',GITHUB_SHA:'commit'};
const intent={operation:'deploy',releaseId:'owner-repair-2026-11-25',commitSubject:'reviewed release',sourceGitBlobSha:sha,build:'r5',priorLiveBuild:'r4'},manifest={...intent},event={ref:env.GITHUB_REF,after:'commit',head_commit:{id:'commit',message:'reviewed release'}};
assert(validOwnerRelease(env,intent,manifest,event,source));
for(const modify of [v=>v.env.GITHUB_EVENT_NAME='pull_request',v=>v.env.GITHUB_REF='refs/heads/other',v=>v.env.GITHUB_REPOSITORY='foreign/repo',v=>v.event.after='other',v=>v.event.forced=true,v=>v.event.head_commit.message='ordinary push',v=>v.intent.sourceGitBlobSha='other',v=>v.manifest.sourceGitBlobSha='other',v=>v.source=Buffer.from('modified')]){const v=structuredClone({env,intent,manifest,event,source});v.source=Buffer.from(v.source);modify(v);assert.equal(validOwnerRelease(v.env,v.intent,v.manifest,v.event,v.source),false);}
console.log('PASS one exact owner-requested release; ordinary pushes, foreign refs, changed source and forced updates rejected');
