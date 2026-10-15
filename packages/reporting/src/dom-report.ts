import type {BatchDomResult,BatchDomStatus} from '../../scan-service/src/batch-dom.ts';

const statuses=new Set<BatchDomStatus>(['locator-missing','dom-present','needs-review','no-evidence','out-of-scope','skipped','error']);
const validationStates=new Set(['passed','failed','skipped','blocked','not-configured']);
// Human-facing Markdown must not allow untrusted filename text to add
// visual record separators or reverse the following verification cells.
// Keep the original basename untouched in the JSON evidence projection.
const markdown=(value:string)=>value
 .replace(/\r\n|[\r\n\u2028\u2029]/g,' ')
 .replace(/[\u061c\u200e\u200f\u202a-\u202e\u2066-\u206f]/g,
  char=>'[U+'+char.codePointAt(0)!.toString(16).toUpperCase()+']')
 .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
 .replace(/[|\u0060]/g,'\\$&').replace(/[\u0000-\u001f\u007f-\u009f]/g,' ');
// Script basenames are attacker-controlled display text, not Markdown syntax.
const markdownFileName=(value:string)=>markdown(value).replace(/[!\[\]()*_~]/g,'\\$&');
/** No raw selectors, DOM text, full local paths, URLs with tokens or CDP loader fingerprints. */
export function serializeDomBatchReport(
 report:BatchDomResult,format:'json'|'markdown',createdAt:string,
):string{
 if(format!=='json'&&format!=='markdown')throw new Error('Invalid report format');
 if(!report||report.validationLevel!=='dom-only'||!Number.isSafeInteger(report.totalItems)||
  report.totalItems<0||report.totalItems>1000||!Array.isArray(report.items)||
  report.items.length!==report.totalItems)throw new Error('Invalid DOM diagnosis batch');
 if(typeof createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(createdAt)||
  Number.isNaN(Date.parse(createdAt)))throw new Error('Invalid diagnosis report timestamp');
 // Date.parse normalizes impossible calendar dates (e.g. February 30);
 // never write a trusted-looking diagnostic timestamp from one.
 const year=Number(createdAt.slice(0,4));
 const month=Number(createdAt.slice(5,7));
 const day=Number(createdAt.slice(8,10));
 const calendarDate=new Date(0);
 calendarDate.setUTCFullYear(year,month-1,day);
 if(calendarDate.getUTCFullYear()!==year||
    calendarDate.getUTCMonth()!==month-1||
    calendarDate.getUTCDate()!==day)
  throw new Error('Invalid diagnosis report timestamp');
 let url:URL;
 try{url=new URL(report.pageUrl);}catch{throw new Error('Invalid page URL');}
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password)
  throw new Error('Invalid DOM diagnosis origin');
 const entries=report.items.map((row,index)=>{
  if(!row||!Number.isSafeInteger(row.index)||row.index!==index||
   typeof row.path!=='string'||row.path.length>4096||
   row.scriptId!==null&&(typeof row.scriptId!=='string'||row.scriptId.length>128)||
   !statuses.has(row.status))throw new Error('Invalid DOM diagnosis row');
  for(const [field,cap] of [['checked',50],['found',50],['missing',50],['needsReview',50]] as const){
   if(!Number.isSafeInteger(row[field])||row[field]<0||row[field]>cap)throw new Error('Invalid DOM diagnosis counts');
  }
  // Reviewed-but-not-probed dynamic/iframe selectors are legitimate:
  // checked=0, needsReview>0. Any actually checked selector, however, must
  // belong to exactly one found/missing/review bucket. Never export a forged
  // V1 result from contradictory raw counts.
  const uncheckedReview=row.checked===0&&row.found===0&&row.missing===0&&
   row.status==='needs-review'&&row.needsReview>0;
  if(!uncheckedReview&&row.found+row.missing+row.needsReview!==row.checked)
   throw new Error('Inconsistent DOM diagnosis counts');
  const ordinaryZero=row.checked===0&&row.found===0&&row.missing===0&&row.needsReview===0;
  const statusValid=row.status==='dom-present'?
   row.checked>0&&row.found===row.checked&&row.missing===0&&row.needsReview===0:
   row.status==='locator-missing'?row.checked>0&&row.missing>0:
   row.status==='needs-review'?row.needsReview>0&&row.missing===0:
   ordinaryZero;
  if(!statusValid)throw new Error('Contradictory DOM diagnosis status and counters');
  const v=row.verification;
  if(!v||!validationStates.has(v.V0)||!validationStates.has(v.V1)||
   v.V2!=='blocked'||v.V3!=='not-configured'||v.V4!=='not-configured'||
   v.functionalVerified!==false||v.managerVerified!==false)
   throw new Error('Invalid or overstated userscript verification');
  if(v.V0==='not-configured'||(v.V1==='passed'||v.V1==='failed')&&v.V0!=='passed'||
   v.V1==='not-configured'&&row.status!=='no-evidence'||
   row.status==='no-evidence'&&v.V0==='passed'&&v.V1!=='not-configured'||
   v.highestVerified!==(v.V1==='passed'?'V1':v.V0==='passed'?'V0':null))
   throw new Error('Invalid DOM verification level evidence');
  if(v.V1==='passed'&&(row.status!=='dom-present'||row.checked<1||row.found!==row.checked))
   throw new Error('Unsupported DOM evidence verification claim');
  if(v.V1==='failed'&&(row.status!=='locator-missing'||row.checked<1||row.missing<1))
   throw new Error('Unsupported V1 failed verification claim');
  if(v.V1==='skipped'&&row.status!=='out-of-scope'&&row.status!=='skipped')
   throw new Error('Unsupported V1 skipped verification claim');
  // The private scriptId authenticates Main's scan-session evidence, but is
  // NOT part of the external report. Index + basename are enough to review
  // a row without leaking an opaque ID, account name or token.
  // Do not serialize evidence reason strings or private absolute directories:
  // CDP errors and source paths can contain credentials or personal details.
  const name=row.path.replace(/\\/g,'/').split('/').at(-1)??'';
  if(!name||name.length>255)throw new Error('Invalid script basename');
  return {index:row.index,name,status:row.status,
   checked:row.checked,found:row.found,missing:row.missing,needsReview:row.needsReview,
   verification:{V0:v.V0,V1:v.V1,V2:'blocked',V3:'not-configured',V4:'not-configured',
    functionalVerified:false,managerVerified:false}};
 });
 const dto={schemaVersion:2,scanMode:'dom-only',createdAt,pageOrigin:url.origin,
  processedCount:entries.length,items:entries,
  disclaimer:'Read-only DOM evidence only. No userscript, GM API or business functionality verified.'};
 if(format==='json')return JSON.stringify(dto,null,2)+'\n';
 const rows=entries.map(x=>`| ${x.index+1} | ${markdownFileName(x.name)} | ${x.status} | ${x.checked} | ${x.found} | ${x.missing} | ${x.needsReview} | ${x.verification.V0} | ${x.verification.V1} | ${x.verification.V2} | ${x.verification.V3} | ${x.verification.V4} |`).join('\n');
 return `# 油猴脚本批量 DOM 诊断报告

创建时间：${markdown(createdAt)}
网站来源：${markdown(url.origin)}

> 仅限只读 DOM 证据；未运行 Tampermonkey、GM API 或脚本业务功能测试，不代表功能修复成功。内部 CDP 身份令牌、页面查询参数和完整文件路径不导出。

| # | 脚本文件 | 状态 | 检查 | 匹配 | 缺失 | 需复核 | V0 | V1 | V2 | V3 | V4 |
|---:|---|---|---:|---:|---:|---:|---|---|---|---|---|
${rows}
`;
}
