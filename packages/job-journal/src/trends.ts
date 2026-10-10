import type {JournalRun} from './index.ts';

export type DomTrendKind='more-missing'|'fewer-missing'|'unchanged'|'not-comparable'|'insufficient-history';
export interface SiteDiagnosisTrend {
 readonly pageOrigin:string;
 readonly kind:DomTrendKind;
 readonly comparable:boolean;
 readonly latestStatus:JournalRun['status'];
 readonly currentMissing:number;
 readonly previousMissing:number|null;
 readonly currentTotal:number;
 readonly previousTotal:number|null;
 readonly evidenceLevel:'dom-only';
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
/**
 * Conservative read-only telemetry. A count difference is NOT proof of site
 * markup changes, selector drift, userscript execution or any V2-V4 outcome.
 * Each site compares only its two most recent runs and only if both completed
 * exactly the same quantity of imported scripts.
 */
export function summarizeSiteTrends(runs:readonly JournalRun[]):SiteDiagnosisTrend[]{
 if(!Array.isArray(runs)||runs.length>1000)throw new Error('Invalid bounded diagnosis history');
 const byOrigin=new Map<string,JournalRun[]>();
 for(const run of runs){
  if(!run||typeof run.pageOrigin!=='string'||run.pageOrigin.length>300||
     !['running','completed','cancelled','interrupted','failed'].includes(run.status)||
     !Number.isSafeInteger(run.totalItems)||run.totalItems<1||run.totalItems>1000||
     !Number.isSafeInteger(run.processedItems)||run.processedItems<0||run.processedItems>run.totalItems||
     !Number.isSafeInteger(run.locatorMissing)||run.locatorMissing<0||run.locatorMissing>run.totalItems)
   throw new Error('Invalid DOM history record');
  let parsed:URL;
  try{parsed=new URL(run.pageOrigin);}catch{throw new Error('Invalid history origin');}
  if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||
     parsed.origin!==run.pageOrigin||parsed.search||parsed.hash||parsed.pathname!=='/')
   throw new Error('History origin must exclude private URL paths and query strings');
  const group=byOrigin.get(run.pageOrigin)??[];
  if(group.length<2)group.push(run);
  byOrigin.set(run.pageOrigin,group);
 }
 return Array.from(byOrigin,([pageOrigin,values])=>{
  const latest=values[0]!,prior=values[1];
  let kind:DomTrendKind='insufficient-history';
  const comparable=!!prior&&latest.status==='completed'&&prior.status==='completed'&&
   latest.processedItems===latest.totalItems&&prior.processedItems===prior.totalItems&&
   latest.totalItems===prior.totalItems;
  if(prior&&latest.status==='completed'&&prior.status==='completed'&&
     latest.totalItems!==prior.totalItems)kind='not-comparable';
  if(comparable){
   kind=latest.locatorMissing>prior!.locatorMissing?'more-missing':
    latest.locatorMissing<prior!.locatorMissing?'fewer-missing':'unchanged';
  }
  return {
   pageOrigin,kind,comparable,latestStatus:latest.status,
   currentMissing:latest.locatorMissing,previousMissing:prior?.locatorMissing??null,
   currentTotal:latest.totalItems,previousTotal:prior?.totalItems??null,
   evidenceLevel:'dom-only' as const,functionalVerified:false as const,managerVerified:false as const,
  };
 });
}
