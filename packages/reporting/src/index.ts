import type {ScanBatchResult} from '../../scan-service/src/index.ts';
const escapeMarkdown=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[|`]/g,'\\$&').replace(/\r?\n/g,' ');
export function serializeStaticReport(report:ScanBatchResult,format:'json'|'markdown'):string{
 const dto={schemaVersion:1,scanMode:'static-only',createdAt:report.createdAt,requestedCount:report.requestedCount,enumeratedCount:report.enumeratedCount,processedCount:report.processedCount,passedCount:report.passedCount,errorCount:report.errorCount,items:report.items.map(({path,status,selectorCount,runtimeRequiredCount,diagnostics})=>({path,status,selectorCount,runtimeRequiredCount,diagnostics}))};
 if(format==='json')return JSON.stringify(dto,null,2)+'\n';
 const rows=dto.items.map(i=>`| ${escapeMarkdown(i.path)} | ${i.status} | ${i.selectorCount} | ${i.runtimeRequiredCount} | ${i.diagnostics.map(escapeMarkdown).join('; ')} |`).join('\n');
 return `# 油猴脚本静态诊断报告\n\n创建时间：${escapeMarkdown(report.createdAt)}\n\n> 仅完成静态 AST 检查；未运行网页功能测试，不能证明脚本工作正常或已修复。\n\n处理 ${dto.processedCount} 项；解析成功 ${dto.passedCount}；错误 ${dto.errorCount}。\n\n| 文件 | 状态 | Selector | 需要运行时确认 | 诊断 |\n|---|---|---:|---:|---|\n${rows}\n`;
}
