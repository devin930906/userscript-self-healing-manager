import type {RollbackEvent} from '../../audit-journal/src/rollback-events.ts';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const TIME=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
type Status='committed'|'uncertain'|null;

const validTime=(value:unknown):value is string=>
 typeof value==='string'&&TIME.test(value)&&
 Number.isFinite(Date.parse(value))&&new Date(Date.parse(value)).toISOString()===value;
const validUuid=(value:unknown):value is string=>typeof value==='string'&&UUID.test(value);
const validHash=(value:unknown):value is string=>typeof value==='string'&&SHA.test(value);
/** Only own enumerable data properties from bounded immutable journal receipts.
 * The exported report intentionally omits script IDs, file paths, source and DOM.
 */
function readField(row:object,name:string):unknown{
 try{
  const descriptor=Object.getOwnPropertyDescriptor(row,name);
  if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))
   throw new Error('Invalid rollback audit report event');
  return descriptor.value;
 }catch{throw new Error('Invalid rollback audit report event');}
}
type OutputEvent=Readonly<{
 eventId:string;previousHash:string|null;targetHash:string;sourceAuditRevisionId:string|null;
 targetAuditRevisionId:string|null;createdAt:string;outcome:Status;finishedAt:string|null;
}>;
function safeEntry(raw:unknown):OutputEvent{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('Invalid rollback audit report event');
 const item=raw as object;
 const eventId=readField(item,'id'),previousHash=readField(item,'previousHash');
 const targetHash=readField(item,'targetHash');
 const sourceAuditRevisionId=readField(item,'sourceAuditRevisionId');
 const targetAuditRevisionId=readField(item,'targetAuditRevisionId');
 const createdAt=readField(item,'createdAt');
 const outcome=readField(item,'outcome'),finishedAt=readField(item,'finishedAt');
 // The scriptId itself is NEVER read or serialized. It is scoped by native
 // Main before the journal supplies this immutable local receipt.
 if(!validUuid(eventId)||previousHash!==null&&!validHash(previousHash)||
    !validHash(targetHash)||previousHash===targetHash||
    sourceAuditRevisionId!==null&&!validUuid(sourceAuditRevisionId)||
    targetAuditRevisionId!==null&&!validUuid(targetAuditRevisionId)||
    !validTime(createdAt)||
    outcome!==null&&outcome!=='committed'&&outcome!=='uncertain'||
    (outcome===null)!==(finishedAt===null)||
    finishedAt!==null&&!validTime(finishedAt))
  throw new Error('Invalid rollback audit report event');
 if(finishedAt!==null&&Date.parse(finishedAt)<Date.parse(createdAt))
  throw new Error('Invalid rollback audit event timestamp order');
 return Object.freeze({
  eventId,previousHash,targetHash,sourceAuditRevisionId,targetAuditRevisionId,
  createdAt,outcome,finishedAt,
 });
}
/** FR-040: a standalone review/rollback attachment, not V1/V3/V4 proof.
 * Caller MUST obtain records from authorized Main-owned rollback journal.
 */
export function serializeRollbackAuditReport(
 records:readonly RollbackEvent[],format:'json'|'markdown',createdAt:string,
):string{
 if(format!=='json'&&format!=='markdown'||!validTime(createdAt))
  throw new Error('Invalid rollback audit report format or timestamp');
 if(!Array.isArray(records)||Object.getPrototypeOf(records)!==Array.prototype||
    records.length>50||records.length<0||!Number.isSafeInteger(records.length))
  throw new Error('Invalid rollback audit report record limit');
 let events:OutputEvent[];
 try{
  events=Array.from({length:records.length},(_,i)=>{
   const slot=Object.getOwnPropertyDescriptor(records,String(i));
   if(!slot||!slot.enumerable||!Object.hasOwn(slot,'value'))
    throw new Error('Invalid rollback audit report row');
   return safeEntry(slot.value);
  });
 }catch{throw new Error('Invalid rollback audit report records');}
 if(new Set(events.map(e=>e.eventId)).size!==events.length)
  throw new Error('Duplicate rollback audit report event');
 const payload=Object.freeze({
  schemaVersion:1,reportType:'managed-rollback-audit',createdAt,
  recordCount:events.length,events,
  disclaimer:'Local managed rollback file evidence only; no userscript execution, GM API or business functionality verified. Pending and uncertain outcomes require offline review.',
 });
 if(format==='json')return JSON.stringify(payload,null,2)+'\n';
 const label=(outcome:Status):string=>outcome===null?'未完成，需要离线复核':
  outcome==='uncertain'?'结果不确定，需要离线复核':'已验证完成';
 const compact=(hash:string|null)=>hash===null?'当前缺失':hash.slice(0,16)+'…';
 const rows=events.map(x=>
  '| '+x.eventId+' | '+label(x.outcome)+' | '+compact(x.previousHash)+
  ' | '+compact(x.targetHash)+' | '+(x.sourceAuditRevisionId??'无已验证审计关联')+
  ' | '+(x.targetAuditRevisionId??'无已验证审计关联')+' | '+
  x.createdAt+' | '+(x.finishedAt??'—')+' |').join('\n');
 return '# 受管修订回滚操作审计报告\n\n创建时间：'+createdAt+
  '\n\n> 仅包含受管文件版本变更与真实已有的审计关联；不代表脚本运行、V1/V3/V4 功能或 GM API 已通过。未完成及结果不确定的操作必须离线复核。此报告不含原始用户脚本、路径、脚本 ID、网页或账户信息。\n\n'+
  '记录数量：'+events.length+'\n\n'+
  '| 操作 ID | 状态 | 操作前 SHA-256 | 目标 SHA-256 | 来源修订审计 ID | 目标修订审计 ID | 操作开始 | 操作结束 |\n'+
  '|---|---|---|---|---|---|---|---|\n'+rows+'\n';
}
