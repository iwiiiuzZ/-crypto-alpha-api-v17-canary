import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../main-v188.js",import.meta.url),"utf8").replace(/^export\s+(default\s+)?/gm,(_,d)=>d?"const exported = ":"");
const {parseNewsXml}=new Function(source+";return {parseNewsXml};")();
// Read-only official-source probe. Does not access Cloudflare secrets or private state.
// HTTP 200 does NOT imply freshness, parse success, or scanner consumption.
const feeds=[
  {id:"BEA_RELEASES",url:"https://apps.bea.gov/rss/rss.xml"},
  {id:"BOJ_RELEASES",url:"https://www.boj.or.jp/en/rss/whatsnew.xml"},
  {id:"BLS_CPI",url:"https://www.bls.gov/feed/cpi.rss"},
  {id:"BLS_PPI",url:"https://www.bls.gov/feed/ppi.rss"},
  {id:"BLS_EMPLOYMENT",url:"https://www.bls.gov/feed/empsit.rss"}
];
let fail=0;
for(const feed of feeds){
  try{
    const res=await fetch(feed.url,{headers:{"User-Agent":"CryptoAlphaSourceHealth/1.0 (+read-only validation)","Accept":"application/rss+xml, application/xml, text/xml;q=0.9"},redirect:"manual",signal:AbortSignal.timeout(12000)});
    const body=await res.text(),isFeed=/<rss\b|<feed\b/i.test(body.slice(0,1500));
    const itemCount=(body.match(/<item\b|<entry\b/gi)||[]).length;
    const parsed=res.ok&&isFeed?parseNewsXml(body,feed.id,new Date().toISOString()):[];
    const success=res.ok&&isFeed&&itemCount>0&&parsed.length>0;
    console.log(JSON.stringify({source:feed.id,httpStatus:res.status,redirected:res.status>=300&&res.status<400,feedSyntax:isFeed,itemCount,parsedItems:parsed.length,relevantItems:parsed.filter(x=>x.relevant).length,success,contentBytes:body.length}));
    if(!success)fail++;
  }catch(e){fail++;console.log(JSON.stringify({source:feed.id,success:false,error:String(e.message).slice(0,160)}))}
}
// Official daily Treasury 2Y/10Y reference, NOT intraday executable yields.
try{
 const url='https://home.treasury.gov/resource-center/data-chart-center/interest-rates/daily-treasury-rates.csv/2026/all?type=daily_treasury_yield_curve&field_tdr_date_value=2026&page&_format=csv';
 const res=await fetch(url,{headers:{accept:'text/csv'},redirect:'manual',signal:AbortSignal.timeout(12000)});
 const body=await res.text(),rows=body.trim().split(/\\r?\\n/);
 const header=rows[0]||'';
 const success=res.ok&&rows.length>2&&/2\\s*Yr/i.test(header)&&/10\\s*Yr/i.test(header);
 console.log(JSON.stringify({source:'US_TREASURY_YIELD_DAILY',httpStatus:res.status,redirected:res.status>=300&&res.status<400,success,rowCount:rows.length,header:header.slice(0,450),lastRow:rows.at(-1)?.slice(0,240),contentBytes:body.length}));
 if(!success)fail++;
}catch(e){fail++;console.log(JSON.stringify({source:'US_TREASURY_YIELD_DAILY',success:false,error:String(e.message).slice(0,160)}));}
if(fail)process.exitCode=1;
