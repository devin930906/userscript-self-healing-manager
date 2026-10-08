import {importPaths,type ImportResult} from '../../script-registry/src/index.ts';
import type {ScriptRepository} from '../../persistence/src/index.ts';
export interface ScanRequest {paths:string[];recursive:boolean;maxFiles:number}
export interface ScanItemResult {
 path:string;scriptId?:string|undefined;status:'parsed'|'parse-error'|'unreadable'|'skipped';
 selectorCount:number;runtimeRequiredCount:number;diagnostics:string[];
 analysis?:ImportResult['analysis']|undefined;
}
export interface ScanBatchResult {
 scanMode:'static-only';createdAt:string;requestedCount:number;enumeratedCount:number;
 processedCount:number;passedCount:number;errorCount:number;items:ScanItemResult[];
}
export async function runStaticScan(request:ScanRequest,deps:{repository:ScriptRepository}):Promise<ScanBatchResult>{
 if(!Number.isSafeInteger(request.maxFiles)||request.maxFiles<1||request.paths.length>request.maxFiles)throw new Error('limit-exceeded');
 const results=await importPaths({paths:request.paths,recursive:request.recursive,repository:deps.repository});
 if(results.length>request.maxFiles)throw new Error('limit-exceeded');
 const items:ScanItemResult[]=results.map(r=>({path:r.path,scriptId:r.scriptId,status:r.status==='imported'?'parsed':r.status==='parse-error'?'parse-error':r.status==='unreadable'?'unreadable':'skipped',selectorCount:r.analysis?.selectorRecords.length??0,runtimeRequiredCount:r.analysis?.selectorRecords.filter(x=>x.runtimeRequired).length??0,diagnostics:r.analysis?.parseDiagnostics??(r.message?[r.message]:[]),analysis:r.analysis}));
 return {scanMode:'static-only',createdAt:new Date().toISOString(),requestedCount:request.paths.length,enumeratedCount:results.length,processedCount:items.length,passedCount:items.filter(x=>x.status==='parsed').length,errorCount:items.filter(x=>x.status==='parse-error'||x.status==='unreadable').length,items};
}
