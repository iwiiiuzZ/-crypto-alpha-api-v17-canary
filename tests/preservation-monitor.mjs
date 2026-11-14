// Strip only reviewed additive monitoring handlers. Original storage/auth remains byte-for-byte compared.
export const deskReviewedFunctions = [
  'fastMaterialEvent',
  'orderflowPaths', 'coordinatedOrderflowEndpoint', 'publicMarketPersistable',
  'liquidityFeedDefinitions', 'liquidityFeed', 'normalizeLiquidityVenue', 'aggregateVenueLiquidity',
  'collectCrossVenueLiquidity', 'localScannerOperation', 'openApi',
];
// Remove the exact new routing branch and additive alarm wrapper before comparing legacy storage methods.
export function stripMonitorExtensions(text){return text
  .replace('runFastMonitorAlarm(this), deskPaperTick(this).catch(()=>{}), deskFlushAlerts(this).catch(()=>{}), DeskBridge.check(this)', 'runFastMonitorAlarm(this), DeskBridge.check(this)')
  .replace('["deskAnalysis","deskStatus","deskChange","deskOperations","deskAi"]', '["deskAnalysis","deskStatus","deskChange"]')
  .replace(/  async alarm\(\) \{\n    await Promise\.all\(\[runFastMonitorAlarm\(this\), DeskBridge\.check\(this\)\.catch\(error => \{\n      console\.error\("desk alarm failed", String\(error\?\.message \|\| error\)\.slice\(0, 120\)\);\n    \}\)\]\);\n  \}\n\n/,'')
  .replace('    if(["deskAnalysis","deskStatus","deskChange"].includes(input?.op))return Response.json(await localScannerOperation(this,input));\n','')
  .replace(/  async alarm\(\) \{\n    await runFastMonitorAlarm\(this\);\n  \}\n\n/,'').replace(/    if\(input\?\.op==="fastMonitorEnsure"\).*?\n/,'').replace(/    if\(input\?\.op==="fastMonitorStatus"\).*?\n/,'').replace(/    if\(input\?\.op==="pushAuditAppend"\).*?\n/,'').replace(/    if\(input\?\.op==="stateIdentity"\|\|input\?\.op==="scannerCycle"\).*?\n/,'').replace('    if(input?.op==="officialBlsRelayMaintenance")return Response.json(await maintainOfficialBlsRelay(this));\n','');}
