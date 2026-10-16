import type {ScanBatchResult} from '../../scan-service/src/index.ts';
import {projectVerificationLevels} from '../../scan-service/src/verification-levels.ts';
/** Strip control characters that could forge rows or reverse displayed audit labels. */
const neutralizeMarkdownControls=(value:string):string=>value
 .replace(/\r\n|[\r\n\u2028\u2029]/g,' ')
 .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/g,
  char=>'[U+'+char.codePointAt(0)!.toString(16).toUpperCase()+']')
 // Terminal control bytes must never execute when a Markdown report is viewed in a console.
 .replace(/[\u0000-\u001f\u007f-\u009f]/g,' ');
const escapeMarkdown=(value:string)=>neutralizeMarkdownControls(value)
 .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/\\/g,'\\\\').replace(/[|`!\[\]()*_~]/g,'\\$&');
/**
 * Static reports cross a privacy boundary: do not serialize local account
 * directory names, raw filesystem errors, source snippets or embedded URLs.
 */
const reportFileName=(path:string):string=>{
 const last=path.replace(/\\/g,'/').split('/').at(-1)??'';
 return last.replace(/[\u0000-\u001f\u007f]/g,'_')||'unnamed-script';
};
const reportDiagnostic=(_message:string):string=>'STATIC_DIAGNOSTIC_REDACTED';

export function serializeStaticReport(report:ScanBatchResult,format:'json'|'markdown'):string{
 if(format!=='json'&&format!=='markdown')
  throw new Error('Invalid static report format');
 if(!report||typeof report!=='object'||Array.isArray(report))
  throw new Error('Invalid static report input');
 // Snapshot validated own data descriptors. Do not re-read an untrusted
 // Proxy's get traps after validation, even when descriptors are ordinary.
 const verifiedRoot:Record<string,unknown>=Object.create(null);
 // Validate all incoming root descriptors before accessing any value.
 // In particular, Array.isArray(report.items) and numeric count checks
 // must not invoke an untrusted accessor or export its thrown message.
 for(const key of ['items','scanMode','createdAt','requestedCount',
                    'enumeratedCount','processedCount','passedCount','errorCount']){
  let descriptor:PropertyDescriptor|undefined;
  // Proxy descriptor traps may throw private exception text. The export
  // boundary reports only its fixed validation error, never that text.
  try{descriptor=Object.getOwnPropertyDescriptor(report,key);}
  catch{throw new Error(key==='items'?'Invalid static report input':
    key==='scanMode'||key==='createdAt'?'Invalid static report metadata':
    'Invalid static report count');}
  if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))
   throw new Error(key==='items'?'Invalid static report input':
    key==='scanMode'||key==='createdAt'?'Invalid static report metadata':
    'Invalid static report count');
  verifiedRoot[key]=descriptor.value;
 }
 report=verifiedRoot as unknown as ScanBatchResult;
 if(!Array.isArray(report.items))throw new Error('Invalid static report input');
 // JSON-like report arrays must use native Array.prototype. A hostile custom
 // prototype can supply inherited .every/.filter/.map getters, which the
 // existing own-property check alone cannot detect before export.
 // A Proxy's getPrototypeOf trap can throw private data: never propagate it.
 const hasNativeArrayPrototype=(value:unknown):value is unknown[]=>{
  try{return Array.isArray(value)&&Object.getPrototypeOf(value)===Array.prototype;}
  catch{return false;}
 };
 // Never relabel runtime/manager evidence as a static scan; reject malformed
 // timestamps before Markdown escaping or JSON serialization can inspect them.
 if(report.scanMode!=='static-only'||typeof report.createdAt!=='string')
  throw new Error('Invalid static report metadata');
 // Runtime report rows must be shape-checked before destructuring or
 // serializing diagnostics. Never echo invalid field values in errors.
 // Array.every() skips holes; a sparse row/diagnostic array would otherwise
 // become null placeholders in JSON without counting as validated evidence.
 // for..of visits holes as undefined, so malformed input fails closed.
 // Array Proxy get traps can lie about .length without touching own indices,
 // hiding report rows or diagnostics. Read the non-accessor own length
 // descriptor and use it consistently while building trusted snapshots.
 const descriptorArrayLength=(items:unknown[]):number|null=>{
  const length=Object.getOwnPropertyDescriptor(items,'length');
  return length&&Object.hasOwn(length,'value')&&
   Number.isSafeInteger(length.value)&&length.value>=0?length.value:null;
 };
 const validItems=():boolean=>{
  // Reject throwing Proxy own-property traps without leaking their errors.
  try{
  const safeItems:ScanBatchResult['items']=[];
  if(!hasNativeArrayPrototype(report.items))return false;
  const itemCount=descriptorArrayLength(report.items);
  if(itemCount===null)return false;
  // Later serialization uses these native Array methods. Reject own
  // overrides without accessing them, before any untrusted method call.
  if(['every','filter','map'].some(method=>Object.hasOwn(report.items,method)))
   return false;
  // Runtime input must not execute an accessor while a supposedly static
  // report is being inspected. Validate own enumerable data descriptors
  // before downstream status/count projections read any row property.
  for(let index=0;index<itemCount;index++){
   const slot=Object.getOwnPropertyDescriptor(report.items,String(index));
   if(!slot||!slot.enumerable||!Object.hasOwn(slot,'value'))return false;
   const item=slot.value;
   if(!item||typeof item!=='object'||Array.isArray(item))return false;
   const values:Record<string,unknown>=Object.create(null);
   for(const key of ['path','status','selectorCount','runtimeRequiredCount','diagnostics']){
    const descriptor=Object.getOwnPropertyDescriptor(item,key);
    if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))
     return false;
    values[key]=descriptor.value;
   }
   if(typeof values.path!=='string'||!hasNativeArrayPrototype(values.diagnostics)||
      Object.hasOwn(values.diagnostics,'map'))
    return false;
   // for..of invokes accessor-backed array elements, including malicious
   // getters containing private error text. Inspect only owned data slots.
   const safeDiagnostics:string[]=[];
   const diagnosticCount=descriptorArrayLength(values.diagnostics);
   if(diagnosticCount===null)return false;
   for(let index=0;index<diagnosticCount;index++){
    const descriptor=Object.getOwnPropertyDescriptor(values.diagnostics,String(index));
    if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value')||
       typeof descriptor.value!=='string')return false;
    safeDiagnostics.push(descriptor.value);
   }
   // Never use status/count/path reads or .map on the original row Proxy
   // after descriptor validation. Output is computed from a trusted copy.
   safeItems.push({
    path:values.path as string,
    status:values.status as ScanBatchResult['items'][number]['status'],
    selectorCount:values.selectorCount as number,
    runtimeRequiredCount:values.runtimeRequiredCount as number,
    diagnostics:safeDiagnostics,
   });
  }
  report.items=safeItems;
  return true;
  }catch{return false;}
 };
 if(!validItems())throw new Error('Invalid static report item');
 // The TypeScript union cannot authenticate an object crossing a runtime
 // export boundary. Reject untrusted status values before either format
 // can render a forged row or inconsistent V0 verification.
 if(!report.items.every(({status})=>status==='parsed'||status==='parse-error'||
    status==='unreadable'||status==='skipped'))
  throw new Error('Invalid static report item status');
 // Counts cross the same runtime boundary as statuses. Strict safe integers
 // prevent Markdown row/control injection and malformed JSON telemetry.
 const validCount=(value:unknown):boolean=>
  typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
 if(![report.requestedCount,report.enumeratedCount,report.processedCount,
      report.passedCount,report.errorCount].every(validCount)||
    !report.items.every(item=>validCount(item.selectorCount)&&
      validCount(item.runtimeRequiredCount)))
  throw new Error('Invalid static report count');
 // The runtime-required set cannot exceed all selectors in the same row.
 if(!report.items.every(item=>item.runtimeRequiredCount<=item.selectorCount))
  throw new Error('Inconsistent static report selector counts');
 // The row inventory is the authority for exported processed/passed/error
 // totals. Recursive inputs can enumerate more files than requested paths.
 const processed=report.items.length;
 // A zero-input scan cannot discover rows; keep empty folder scans and
 // recursive expansion from one or more paths valid.
 if(report.requestedCount===0&&processed>0)
  throw new Error('Inconsistent static report request count');
 const passed=report.items.filter(item=>item.status==='parsed').length;
 const failed=report.items.filter(item=>item.status==='parse-error'||
  item.status==='unreadable').length;
 if(report.enumeratedCount!==processed||report.processedCount!==processed||
    report.passedCount!==passed||report.errorCount!==failed)
  throw new Error('Inconsistent static report item counts');
 const dto={schemaVersion:2,scanMode:'static-only',createdAt:report.createdAt,requestedCount:report.requestedCount,enumeratedCount:report.enumeratedCount,processedCount:report.processedCount,passedCount:report.passedCount,errorCount:report.errorCount,items:report.items.map(({path,status,selectorCount,runtimeRequiredCount,diagnostics})=>({path:reportFileName(path),status,selectorCount,runtimeRequiredCount,diagnostics:diagnostics.map(reportDiagnostic),verification:projectVerificationLevels({staticStatus:status})}))};
 if(format==='json')return JSON.stringify(dto,null,2)+'\n';
 const rows=dto.items.map(i=>`| ${escapeMarkdown(i.path)} | ${i.status} | ${i.selectorCount} | ${i.runtimeRequiredCount} | ${i.diagnostics.join('; ')} | ${i.verification.V0} | ${i.verification.V1} | ${i.verification.V2} | ${i.verification.V3} | ${i.verification.V4} |`).join('\n');
 return `# 油猴脚本静态诊断报告\n\n创建时间：${escapeMarkdown(report.createdAt)}\n\n> 仅完成静态 AST 检查；未运行网页功能测试，不能证明脚本工作正常或已修复。V0 仅证明解析，V1/V2 为 blocked，V3/V4 为 not-configured（未配置）。 导出仅含文件名，原始异常文本已脱敏。\n\n处理 ${dto.processedCount} 项；解析成功 ${dto.passedCount}；错误 ${dto.errorCount}。\n\n| 文件 | 状态 | Selector | 需要运行时确认 | 诊断 | V0 | V1 | V2 | V3 | V4 |\n|---|---|---:|---:|---|---|---|---|---|---|\n${rows}\n`;
}
