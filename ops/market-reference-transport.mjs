// Transport-only projection. The full news endpoint and background snapshot remain untouched.
export function compactNewsReferenceTransport(out,{calendarPreview=false,riskHeadersOnly=false}={}){
 const news=out?.newsContext;if(!news||typeof news!=='object')return false;
 let changed=false;
 const operational=['transportAgeSeconds','elapsedMs','failureCount','handshakeAt','transportRevision','lastAttemptAt','cacheState'];
 const optionalSourceDiagnostics=['reason','failureStage','nextAttemptAt','relayReceivedAt','directHttpStatus'];
 if(!news.fullOperationalDetails){
  for(const source of Object.values(news.sources||{}))if(source&&typeof source==='object'){
   for(const k of operational)if(Object.hasOwn(source,k)){delete source[k];changed=true;}
   for(const k of optionalSourceDiagnostics)if(source[k]===null){delete source[k];changed=true;}
   const d=source.parseDiagnostics;
   if(d&&typeof d==='object'){
    if(d.parserRevision===source.parserRevision){delete d.parserRevision;changed=true;}
    // Keep counts, content/failure status and unknown fields. Detailed rejection counters are in the full view.
    if(Object.hasOwn(d,'rejectedReasons')){delete d.rejectedReasons;changed=true;}
   }
  }
  for(const source of news.macroReferences?.sources||[])if(source&&typeof source==='object')for(const k of ['lastAttemptAt','lastSuccessAt','nextAttemptAt','revision'])if(Object.hasOwn(source,k)){delete source[k];changed=true;}
  if(changed)news.fullOperationalDetails={view:'news',path:'newsContext',scope:'SOURCE_OPERATIONAL_DIAGNOSTICS_ONLY_ALL_REFERENCE_VALUES_RETAINED'};
 }
 if(calendarPreview&&Array.isArray(news.upcomingEvents)&&news.upcomingEvents.length>1){
  // The nearest scheduled event is retained in full; every current event-window item remains intact.
  news.upcomingEventPreview={available:news.upcomingEvents.length,returned:1,completeView:'news',fullCalendarRequiredForFinalReview:true};
  news.upcomingEvents=news.upcomingEvents.slice(0,1);changed=true;
 }
 if(riskHeadersOnly&&Array.isArray(news.recentRiskHeadlines)&&news.recentRiskHeadlines.some(row=>row.title!==undefined||row.url!==undefined)){
  // Preserve timing and risk tags for every item. IDs, links and full text
  // remain in the news view, which is needed for the final news review.
  news.recentRiskHeadlines=news.recentRiskHeadlines.map(row=>{
   const {id,title,url,firstSeenAt,ageSeconds,...header}=row;
   if(header.fetchedAt&&header.fetchedAt===news.sources?.[header.source]?.fetchedAt)delete header.fetchedAt;
   if(header.eventAt===null)delete header.eventAt;
   if(header.relevant===true)delete header.relevant;
   if(header.tradeDirection===null)delete header.tradeDirection;
   if(header.causality==='NOT_PROVEN_BY_HEADLINE')delete header.causality;
   if(header.untrustedContent===true)delete header.untrustedContent;
   return header;
  });
  news.riskHeadlineDetails={view:'news',path:'newsContext.recentRiskHeadlines',count:news.recentRiskHeadlines.length,fullNewsRequiredForFinalReview:true,sourceFetchedAtDefault:'newsContext.sources[header.source].fetchedAt',headerDefaults:{eventAt:null,relevant:true,tradeDirection:null,causality:'NOT_PROVEN_BY_HEADLINE',untrustedContent:true}};
  changed=true;
 }
 return changed;
}
