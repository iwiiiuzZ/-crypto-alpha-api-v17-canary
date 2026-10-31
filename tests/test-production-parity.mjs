import assert from 'node:assert/strict';
import {assessSourceParity,DEPLOYED_R4} from '../ops/production-parity.mjs';
const base={candidateCommit:DEPLOYED_R4.sourceCommit+'abc',actualBuild:DEPLOYED_R4.build,actualDeploymentId:DEPLOYED_R4.deploymentId,manifest:{build:DEPLOYED_R4.build}};
assert.equal(assessSourceParity(base).passed,true);
assert.equal(assessSourceParity({...base,candidateCommit:'8dadb93ce844d92bb34a86261fbb0777a0ce3849'}).passed,false);
assert.equal(assessSourceParity({...base,actualDeploymentId:'another'}).passed,false);
assert.equal(assessSourceParity({...base,actualBuild:'older'}).passed,false);
console.log('PASS production source mismatch cannot be certified as deployed');
