import fs from 'node:fs';
import {collectMacroReferences} from './macro-reference.mjs';
const report=await collectMacroReferences();
fs.writeFileSync('macro-reference-live.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.requiredSourcesAvailable)process.exitCode=1;
