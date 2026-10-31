import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Test the real Worker source, not a duplicated news parser implementation.
// Removing ESM exports affects only this isolated Node test harness.
const raw=readFileSync(new URL("../main-v188.js",import.meta.url),"utf8");
const code=raw.replace(/^export\s+(default\s+)?/gm,(_,def)=>def?"const defaultExport = ":"");
const {NEWS_SOURCES,newsItem,parseNewsXml,newsContextSummary,NEWS_PARSER_REVISION,parseTreasuryDailyCsv,treasuryDailyUrl}=
  new Function(code+";return {NEWS_SOURCES,newsItem,parseNewsXml,newsContextSummary,NEWS_PARSER_REVISION,parseTreasuryDailyCsv,treasuryDailyUrl};")();
const fetchedAt=new Date().toISOString();
const pubDate=new Date().toUTCString();
const item=(title,url,source)=>newsItem({title,url,pubDate},source,fetchedAt);

test("syntax and expected official-source inventory",()=>{
  assert.equal(NEWS_SOURCES.length,9);
  assert.equal(new Set(NEWS_SOURCES.map(x=>x.id)).size,9);
  assert(NEWS_SOURCES.some(x=>x.id==="BLS_PPI"&&x.url==="https://www.bls.gov/feed/ppi.rss"));
  assert(NEWS_SOURCES.some(x=>x.id==="BEA_RELEASES"&&x.url==="https://apps.bea.gov/rss/rss.xml"));
  assert(NEWS_SOURCES.some(x=>x.id==="BOJ_RELEASES"&&x.url==="https://www.boj.or.jp/en/rss/whatsnew.xml"));
  assert.match(NEWS_PARSER_REVISION,/macro-news/);
});
test("BLS CPI acronym-only headlines are relevant macro events",()=>{
  const record=item("CPI for All Urban Consumers (CPI-U) rises 0.3 percent",
    "https://www.bls.gov/news.release/cpi.htm","BLS_CPI");
  assert(record?.relevant);
  assert(record.riskTags.includes("MACRO_EVENT_REVIEW"));
  assert.equal(record.tradeDirection,null);
});
test("PCE and personal income/outlays are relevant macro events",()=>{
  const record=item("Personal Income and Outlays: Core PCE Price Index rises",
    "https://www.bea.gov/news/2026/personal-income-and-outlays","BEA_RELEASES");
  assert(record?.relevant);
  assert(record.riskTags.includes("MACRO_EVENT_REVIEW"));
  assert.equal(record.tradeDirection,null);
});
test("BOJ official legacy HTTP article links are safely upgraded",()=>{
  const record=item("Bank of Japan monetary policy meeting",
    "http://www.boj.or.jp/en/mopo/outlook/2026.htm","BOJ_RELEASES");
  assert(record?.riskTags.includes("CENTRAL_BANK_POLICY_REVIEW"));
  assert.equal(record.url,"https://www.boj.or.jp/en/mopo/outlook/2026.htm");
});
test("untrusted HTTP links and other hosts remain rejected",()=>{
  assert.equal(item("Personal Income and Outlays","http://attacker.example/news","BEA_RELEASES"),null);
  assert.equal(item("Bank of Japan rate","http://attacker.example/news","BOJ_RELEASES"),null);
});
test("initial claims, DXY and Treasury yields are flagged",()=>{
  assert(item("Initial Jobless Claims", "https://www.federalreserve.gov/new.htm","FED_PRESS")
    .riskTags.includes("MACRO_EVENT_REVIEW"));
  assert(item("DXY dollar index and Treasury yield surge",
    "https://www.coindesk.com/dollar","COINDESK").riskTags.includes("USD_YIELD_RISK_REVIEW"));
});
test("existing exchange-security and geopolitical tags remain",()=>{
  assert(item("Bitcoin exchange hack and withdrawal halt",
    "https://www.coindesk.com/hack","COINDESK").riskTags.includes("EXCHANGE_SECURITY_REVIEW"));
  assert(item("War in Hormuz sparks missile tensions",
    "https://www.coindesk.com/world","COINDESK").riskTags.includes("GEOPOLITICAL_REVIEW"));
});
test("BEA RSS feed parses and produces no fabricated trade signal",()=>{
  const xml="<rss><channel><item><title>Personal Income and Outlays PCE price index</title>"+
    "<link>https://www.bea.gov/news/2026/release</link><pubDate>"+pubDate+
    "</pubDate></item></channel></rss>";
  const records=parseNewsXml(xml,"BEA_RELEASES",fetchedAt);
  assert.equal(records.length,1);
  assert(records[0].riskTags.includes("MACRO_EVENT_REVIEW"));
  assert.equal(records[0].tradeDirection,null);
});
test("source status is independently reported; unavailable BOJ is not success",()=>{
  let records={BEA_RELEASES:{status:"ok",fetchedAt,items:[]},
    BOJ_RELEASES:{status:"unavailable",fetchedAt:null,items:[],reason:"SOURCE_HTTP_ERROR"}};
  let summary=newsContextSummary(records);
  assert.equal(summary.expectedSourceCount,12);
  assert.equal(summary.coverage.BOJ,"OFFICIAL_RSS_UNAVAILABLE");
  records.BOJ_RELEASES={status:"ok",fetchedAt,items:[]};
  summary=newsContextSummary(records);
  assert.equal(summary.coverage.BOJ,"OFFICIAL_RSS_CONNECTED");
  assert.equal(summary.coverage.DXY,"NO_LIVE_QUOTE_CONNECTED");
  assert.equal(summary.openNowAllowed,false);
});

test("BOJ RDF XML and standalone monetary-policy titles are parsed",()=>{
  const xml='<rdf:RDF><item><title>Statement on Monetary Policy</title>'+
    '<link>http://www.boj.or.jp/en/mopo/decision.htm</link><dc:date>'+
    new Date().toISOString()+'</dc:date></item></rdf:RDF>';
  const rows=parseNewsXml(xml,"BOJ_RELEASES",fetchedAt);
  assert.equal(rows.length,1);
  assert(rows[0].riskTags.includes("CENTRAL_BANK_POLICY_REVIEW"));
  assert.equal(rows[0].tradeDirection,null);
});
test("BEA GDP headline is material macro evidence",()=>{
  const row=item("Gross Domestic Product (Advance Estimate), 3rd Quarter 2026",
    "https://www.bea.gov/news/2026/gdp","BEA_RELEASES");
  assert(row?.relevant);
  assert(row.riskTags.includes("MACRO_EVENT_REVIEW"));
});


test("official Treasury daily yields have dates, changes and explicit non-live classification",()=>{
 const now=Date.parse("2026-10-30T08:00:00Z");
 const csv='Date,"2 Yr","10 Yr"\n10/29/2026,4.61,4.98\n10/28/2026,4.67,5.05\n';
 const yields=parseTreasuryDailyCsv(csv,now);
 assert.equal(yields.asOf,'2026-10-29');
 assert.equal(yields.yield2yPct,4.61);
 assert.equal(yields.yield10yPct,4.98);
 assert.equal(yields.change2yBp,-6);
 assert.equal(yields.change10yBp,-7);
 assert.equal(yields.intraday,false);
 assert.equal(yields.tradeDirection,null);
 assert.match(treasuryDailyUrl(Date.parse('2027-01-03T00:00:00Z')),/2027\/all/);
 const context=newsContextSummary({US_TREASURY_YIELD_DAILY:{status:'ok',fetchedAt:new Date(now).toISOString(),yieldCurve:yields}},now);
 assert.equal(context.coverage.US2Y,'OFFICIAL_DAILY_REFERENCE_NOT_LIVE');
 assert.equal(context.coverage.US10Y,'OFFICIAL_DAILY_REFERENCE_NOT_LIVE');
 assert.equal(context.coverage.DXY,'NO_LIVE_QUOTE_CONNECTED');
 assert.equal(context.treasuryDaily.live,false);
 assert.throws(()=>parseTreasuryDailyCsv('Date,"2 Yr","10 Yr"\n10/01/2026,4.6,4.9',now),/STALE/);
});

test("Treasury official daily 2Y/10Y parser labels observations as non-intraday",()=>{
  const now=Date.UTC(2026,9,30,12);
  const csv='Date,"1 Mo","2 Yr","10 Yr"\n10/29/2026,4.06,4.61,4.98\n10/28/2026,4.07,4.67,5.05\n';
  const parsed=parseTreasuryDailyCsv(csv,now);
  assert.equal(parsed.asOf,"2026-10-29");
  assert.equal(parsed.yield2yPct,4.61);
  assert.equal(parsed.yield10yPct,4.98);
  assert.equal(parsed.change2yBp,-6);
  assert.equal(parsed.change10yBp,-7);
  assert.equal(parsed.cadence,"OFFICIAL_DAILY");
  assert.equal(parsed.intraday,false);
  assert.equal(parsed.tradeDirection,null);
  assert.match(treasuryDailyUrl(now),/2026/);
});
test("Treasury daily parser rejects stale, future, invalid and missing observations",()=>{
  const now=Date.UTC(2026,9,30,12);
  assert.throws(()=>parseTreasuryDailyCsv('Date,"2 Yr","10 Yr"\n10/01/2026,4.2,4.3\n',now),/STALE_OR_MISSING/);
  assert.throws(()=>parseTreasuryDailyCsv('Date,"2 Yr","10 Yr"\n11/15/2026,4.2,4.3\n',now),/STALE_OR_MISSING/);
  assert.throws(()=>parseTreasuryDailyCsv('Date,"2 Yr","10 Yr"\n10/29/2026,NaN,4.3\n',now),/STALE_OR_MISSING/);
  assert.throws(()=>parseTreasuryDailyCsv('Date,"2 Yr"\n10/29/2026,4.2\n',now),/COLUMNS_MISSING/);
});
