import fs from 'node:fs';
import {createHash} from 'node:crypto';
export function validOwnerRelease(env,intent,manifest,event,source){
 if(env.GITHUB_EVENT_NAME!=='push'||env.GITHUB_REF!=='refs/heads/main'||env.GITHUB_REPOSITORY!=='iwiiiuzZ/-crypto-alpha-api-v17-canary')return false;
 if(!event||event.deleted||event.forced||event.ref!=='refs/heads/main'||event.after!==env.GITHUB_SHA||event.head_commit?.id!==env.GITHUB_SHA)return false;
 if(event.head_commit?.message?.split('\n')[0]!==intent.commitSubject)return false;
 const sha=createHash('sha1').update(Buffer.from('blob '+source.length+'\0')).update(source).digest('hex');
 return intent.operation==='deploy'&&intent.releaseId==='owner-repair-2026-11-18'&&intent.sourceGitBlobSha===sha&&manifest.sourceGitBlobSha===sha&&intent.build===manifest.build&&intent.priorLiveBuild===manifest.priorLiveBuild;
}
export function isAuthorizedOwnerRelease(env=process.env){
 try{return validOwnerRelease(env,JSON.parse(fs.readFileSync(new URL('./desk-owner-release.json',import.meta.url))),JSON.parse(fs.readFileSync(new URL('./release-manifest.json',import.meta.url))),JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH)),fs.readFileSync(new URL('../main-v188.js',import.meta.url)));}catch{return false;}
}
