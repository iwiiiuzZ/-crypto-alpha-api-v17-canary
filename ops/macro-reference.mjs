// Candidate reference-data adapters. Never place orders or change strategy gates.
const DAY=86400000;
function fail(code){throw Error(code);}
function number(value){if(typeof value!=='number'&&typeof value!=='string')fail('INVALID_NUMBER');if(String(value).trim()==='')fail('INVALID_NUMBER');const n=Number(value);if(!Number.isFinite(n)||n<0)fail('INVALID_NUMBER');return n;}
function issuerNumber(v){if(typeof v!=='string'||!/^\d{1,3}(?:,\d{3})*(?:\.\d+)?$|^\d+(?:\.\d+)?$/.test(v))fail('INVALID_ISSUER_NUMBER');return number(v.replaceAll(',',''));}
function dateOnly(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail('INVALID_DATE');const n=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(n)||new Date(n).toISOString().slice(0,10)!==value)fail('INVALID_DATE');return n;}
function datePolicy(asOf,now,maxDays){const t=dateOnly(asOf);if(t>now)fail('FUTURE_DATE');if(now-t>maxDays*DAY)fail('STALE_REFERENCE');return t;}
export function csvRows(text){
 if(typeof text!=='string'||text.length>600000)fail('INVALID_CSV_SIZE');
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(quoted)quoted=false;else if(cell==='')quoted=true;else fail('INVALID_CSV_QUOTE');}
 else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push(row);row=[];cell='';}else cell+=c;}
 if(quoted)fail('UNTERMINATED_CSV');if(cell!==''||row.length){row.push(cell);rows.push(row);}return rows;
}
const MONTHS={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
function issuerDate(s){const m=String(s).match(/^([A-Z][a-z]{2}) (\d{2}), (\d{4})$/);if(!m||!MONTHS[m[1]])fail('INVALID_ISSUER_DATE');return m[3]+'-'+String(MONTHS[m[1]]).padStart(2,'0')+'-'+m[2];}
export function parseIssuerHoldings(text,{fund,now=Date.now()}={}){
 if(!['IBIT','ETHA'].includes(fund))fail('UNSUPPORTED_FUND');
 const rows=csvRows(text),expected=fund==='IBIT'?'iShares Bitcoin Trust ETF':'iShares Ethereum Trust ETF',ccy=fund==='IBIT'?'BTC':'ETH';
 if(rows[0]?.[0]!==expected)fail('FUND_MISMATCH');
 const dates=rows.filter(r=>r[0]==='Fund Holdings as of');if(dates.length!==1)fail('HOLDINGS_DATE_MISSING_OR_DUPLICATE');const asOf=issuerDate(dates[0][1]);datePolicy(asOf,now,7);
 const shares=rows.filter(r=>r[0]==='Shares Outstanding');if(shares.length!==1)fail('SHARES_MISSING_OR_DUPLICATE');
 const header=rows.findIndex(r=>r[0]==='Ticker'&&r.includes('Quantity'));
 if(header<0)fail('HOLDINGS_COLUMNS_MISSING');const h=rows[header],matches=rows.slice(header+1).filter(r=>r[0]===ccy);if(matches.length!==1)fail('ASSET_MISSING_OR_DUPLICATE');
 const r=matches[0],q=issuerNumber(r[h.indexOf('Quantity')]),s=issuerNumber(shares[0][1]);if(q<=0||s<=0)fail('EMPTY_HOLDINGS');
 return{source:'ISHARES_ISSUER_HOLDINGS_CSV',fund,asset:ccy,asOf,sharesOutstanding:s,assetQuantity:q,cadence:'DAILY_REFERENCE',live:false,publicationTimeKnown:false,netFlowUsd:null,allMarketCoverage:false,tradeDirection:null};
}
function optionExpiry(id,ccy){const m=id.match(new RegExp('^'+ccy+'-USD-(\\d{2})(\\d{2})(\\d{2})-([0-9]+(?:\\.[0-9]+)?)-(C|P)$'));if(!m)return null;const date='20'+m[1]+'-'+m[2]+'-'+m[3];return{at:dateOnly(date)+8*3600000,side:m[5]};}
export function parseOkxOptionInterest(payload,{asset,now=Date.now(),maxAgeMs=120000}={}){
 if(!['BTC','ETH'].includes(asset))fail('UNSUPPORTED_ASSET');if(payload?.code!=='0'||!Array.isArray(payload.data)||!payload.data.length||payload.data.length>10000)fail('OPTIONS_RESPONSE_INVALID');
 const seen=new Set();let calls=0,puts=0,callUsd=0,putUsd=0,instruments=0,excludedExpired=0,minTs=Infinity,maxTs=0;
 for(const r of payload.data){if(r?.instType!=='OPTION')fail('INSTRUMENT_TYPE_MISMATCH');const e=optionExpiry(r.instId||'',asset);if(!e)fail('OPTION_INSTRUMENT_MISMATCH');if(seen.has(r.instId))fail('DUPLICATE_INSTRUMENT');seen.add(r.instId);const ts=number(r.ts);if(ts>now+5000||now-ts>maxAgeMs)fail('OPTION_TIMESTAMP_STALE_OR_FUTURE');const oi=number(r.oiCcy),usd=number(r.oiUsd);if(e.at<=now){excludedExpired++;continue;}instruments++;minTs=Math.min(minTs,ts);maxTs=Math.max(maxTs,ts);if(e.side==='C'){calls+=oi;callUsd+=usd;}else{puts+=oi;putUsd+=usd;}}
 if(!instruments)fail('NO_UNEXPIRED_OPTIONS');return{source:'OKX_PUBLIC_OPTIONS_OPEN_INTEREST',asset,asOf:new Date(minTs).toISOString(),newestAt:new Date(maxTs).toISOString(),instruments,excludedExpired,callOpenInterestCoin:calls,putOpenInterestCoin:puts,callOpenInterestUsd:callUsd,putOpenInterestUsd:putUsd,putCallOpenInterestRatio:calls>0?puts/calls:null,ratioMeaning:'OPEN_INTEREST_NOT_TRADE_DIRECTION',snapshotCurrent:true,economicReportingDelayVerified:false,allMarketCoverage:false,tradeDirection:null};
}
export function parseClaimsCsv(text,{series,now=Date.now()}={}){
 if(!['ICSA','CCSA'].includes(series))fail('UNSUPPORTED_CLAIMS_SERIES');const rows=csvRows(text),h=rows.shift();if(h?.length!==2||!['DATE','observation_date'].includes(h[0])||h[1]!==series)fail('CLAIMS_COLUMNS_INVALID');const seen=new Set(),data=[];
 for(const r of rows){if(r.length===1&&!r[0])continue;if(r.length!==2)fail('CLAIMS_ROW_INVALID');const t=dateOnly(r[0]);if(seen.has(t))fail('DUPLICATE_WEEK');seen.add(t);if(r[1]==='.'||r[1]==='')continue;const count=number(r[1]);if(!Number.isInteger(count)||count>100000000)fail('CLAIMS_VALUE_INVALID');data.push({weekEnding:r[0],count,t});}
 data.sort((a,b)=>b.t-a.t);if(!data.length)fail('NO_CLAIMS_OBSERVATIONS');datePolicy(data[0].weekEnding,now,series==='ICSA'?16:23);if(data.some(r=>r.t>now))fail('FUTURE_DATE');return{source:'DOL_ETA_VIA_FRED',series,weekEnding:data[0].weekEnding,count:data[0].count,previousWeekEnding:data[1]?.weekEnding||null,previousCount:data[1]?.count??null,change:data[1]?data[0].count-data[1].count:null,seasonallyAdjusted:true,cadence:'WEEKLY_REFERENCE',publicationTimeKnown:false,actualVsConsensus:null,tradeDirection:null};
}
export function parseClaimsHtml(text,{series,now=Date.now()}={}){
 if(!['ICSA','CCSA'].includes(series)||typeof text!=='string'||text.length>300000)fail('CLAIMS_HTML_INVALID');
 const title=text.match(/<title>([^<]+)<\/title>/i)?.[1]||'';
 if(!title.includes('('+series+')')||!title.includes('FRED')||!text.includes('Seasonally Adjusted'))fail('CLAIMS_HTML_IDENTITY_MISMATCH');
 const data=[];
 for(const tr of text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
  if(!tr[1].includes('series-obs'))continue;
  const cells=[...tr[1].matchAll(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map(x=>x[2].replace(/<[^>]*>/g,'').replace(/&nbsp;|&#160;/g,' ').trim());
  if(cells.length!==2||!/^\d{4}-\d{2}-\d{2}$/.test(cells[0]))continue;
  const n=issuerNumber(cells[1]);data.push(cells[0]+','+n);
 }
 if(!data.length)fail('CLAIMS_HTML_OBSERVATIONS_MISSING');
 return {...parseClaimsCsv('observation_date,'+series+'\n'+data.join('\n'),{series,now}),source:'DOL_ETA_VIA_FRED_HTML'};
}
export const MACRO_REFERENCE_SOURCES=Object.freeze([
 {id:'US_INITIAL_CLAIMS',url:'https://fred.stlouisfed.org/series/ICSA',type:'claims',series:'ICSA'},
 {id:'US_CONTINUED_CLAIMS',url:'https://fred.stlouisfed.org/series/CCSA',type:'claims',series:'CCSA'},
 {id:'IBIT_HOLDINGS',url:'https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf/latest-holdings.csv',type:'issuer',fund:'IBIT'},
 {id:'ETHA_HOLDINGS',url:'https://www.ishares.com/us/products/337614/ishares-ethereum-trust-etf/latest-holdings.csv',type:'issuer',fund:'ETHA'},
 {id:'OKX_ETH_OPTIONS',url:'https://www.okx.com/api/v5/public/open-interest?instType=OPTION&instFamily=ETH-USD',type:'option',asset:'ETH'},
 {id:'OKX_BTC_OPTIONS',url:'https://www.okx.com/api/v5/public/open-interest?instType=OPTION&instFamily=BTC-USD',type:'option',asset:'BTC'}
]);
export async function collectMacroReferences({fetcher=fetch,now=Date.now}={}){
 const sources=[];
 for(const spec of MACRO_REFERENCE_SOURCES){
  const row={id:spec.id,url:spec.url,requestedAt:new Date(now()).toISOString(),status:'unavailable'};
  try{
   const response=await fetcher(spec.url,{method:'GET',redirect:'error',headers:{accept:spec.type==='claims'?'text/html':spec.type==='issuer'?'text/csv,text/plain':'application/json','User-Agent':'CryptoAlphaReferenceData/1.0'},signal:AbortSignal.timeout(12000)});
   row.httpStatus=response.status;if(!response.ok)fail('UPSTREAM_HTTP_'+response.status);
   const reader=response.body?.getReader();if(!reader)fail('EMPTY_BODY');let size=0,parts=[];
   for(;;){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>600000){await reader.cancel();fail('REFERENCE_BODY_LIMIT');}parts.push(v.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}const text=new TextDecoder().decode(bytes);
   const collectedAt=now();row.data=spec.type==='claims'?parseClaimsHtml(text,{series:spec.series,now:collectedAt}):spec.type==='issuer'?parseIssuerHoldings(text,{fund:spec.fund,now:collectedAt}):parseOkxOptionInterest(JSON.parse(text),{asset:spec.asset,now:collectedAt});
   row.status='ok';row.fetchedAt=new Date(collectedAt).toISOString();row.bytes=size;
  }catch(error){row.error=/^[A-Z][A-Z0-9_]{2,90}$/.test(error.message)?error.message:'REFERENCE_REQUEST_OR_PARSE_FAILED';}
  sources.push(row);
 }
 return{scope:'MACRO_REFERENCE_CANDIDATE_NOT_PRODUCTION_CONNECTED',checkedAt:new Date(now()).toISOString(),sources,requiredSourcesAvailable:sources.every(s=>s.status==='ok'),dxy:{status:'NO_AUTHORIZED_REALTIME_SOURCE_CONNECTED'},automaticallyPlacesOrders:false,changesStrategyRules:false};
}
