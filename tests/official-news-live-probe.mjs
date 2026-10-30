// Read-only official-source probe. Does not access Cloudflare secrets or private state.
// HTTP 200 does NOT imply freshness, parse success, or scanner consumption.
const feeds=[
  {id:"BEA_RELEASES",url:"https://apps.bea.gov/rss/rss.xml"},
  {id:"BOJ_RELEASES",url:"https://www.boj.or.jp/en/rss/whatsnew.xml"},
  {id:"BLS_CPI",url:"https://www.bls.gov/feed/cpi.rss"},
  {id:"BLS_EMPLOYMENT",url:"https://www.bls.gov/feed/empsit.rss"}
];
let fail=0;
for(const feed of feeds){
  try{
    const res=await fetch(feed.url,{headers:{"User-Agent":"CryptoAlphaSourceHealth/1.0 (+read-only validation)","Accept":"application/rss+xml, application/xml, text/xml;q=0.9"},redirect:"manual",signal:AbortSignal.timeout(12000)});
    const body=await res.text(),isFeed=/<rss\b|<feed\b/i.test(body.slice(0,1500));
    const itemCount=(body.match(/<item\b|<entry\b/gi)||[]).length;
    const success=res.ok&&isFeed&&itemCount>0;
    console.log(JSON.stringify({source:feed.id,httpStatus:res.status,redirected:res.status>=300&&res.status<400,feedSyntax:isFeed,itemCount,success,contentBytes:body.length}));
    if(!success)fail++;
  }catch(e){fail++;console.log(JSON.stringify({source:feed.id,success:false,error:String(e.message).slice(0,160)}))}
}
if(fail)process.exitCode=1;
