import type {ScanBatchResult} from '../../scan-service/src/index.ts';
import {projectVerificationLevels} from '../../scan-service/src/verification-levels.ts';
/** Strip control characters that could forge rows or reverse displayed audit labels. */
const neutralizeMarkdownControls=(value:string):string=>value
 .replace(/\r\n|[\r\n\u2028\u2029]/g,' ')
 .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
  char=>'[U+'+char.codePointAt(0)!.toString(16).toUpperCase()+']')
 // Terminal control bytes must never execute when a Markdown report is viewed in a console.
 .replace(/[\u0000-\u001f\u007f]/g,' ');
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
 if(!report||typeof report!=='object'||!Array.isArray(report.items))
  throw new Error('Invalid static report input');
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
 // The row inventory is the authority for exported processed/passed/error
 // totals. Recursive inputs can enumerate more files than requested paths.
 const processed=report.items.length;
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
