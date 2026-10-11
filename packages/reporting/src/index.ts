import type {ScanBatchResult} from '../../scan-service/src/index.ts';
import {projectVerificationLevels} from '../../scan-service/src/verification-levels.ts';
const escapeMarkdown=(value:string)=>value.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/[|`]/g,'\\$&').replace(/\r?\n/g,' ');
export function serializeStaticReport(report:ScanBatchResult,format:'json'|'markdown'):string{
 const dto={schemaVersion:2,scanMode:'static-only',createdAt:report.createdAt,requestedCount:report.requestedCount,enumeratedCount:report.enumeratedCount,processedCount:report.processedCount,passedCount:report.passedCount,errorCount:report.errorCount,items:report.items.map(({path,status,selectorCount,runtimeRequiredCount,diagnostics})=>({path,status,selectorCount,runtimeRequiredCount,diagnostics,verification:projectVerificationLevels({staticStatus:status})}))};
 if(format==='json')return JSON.stringify(dto,null,2)+'\n';
 const rows=dto.items.map(i=>`| ${escapeMarkdown(i.path)} | ${i.status} | ${i.selectorCount} | ${i.runtimeRequiredCount} | ${i.diagnostics.map(escapeMarkdown).join('; ')} | ${i.verification.V0} | ${i.verification.V1} | ${i.verification.V2} | ${i.verification.V3} | ${i.verification.V4} |`).join('\n');
 return `# 油猴脚本静态诊断报告\n\n创建时间：${escapeMarkdown(report.createdAt)}\n\n> 仅完成静态 AST 检查；未运行网页功能测试，不能证明脚本工作正常或已修复。V0 仅证明解析，V1/V2 为 blocked，V3/V4 为 not-configured（未配置）。\n\n处理 ${dto.processedCount} 项；解析成功 ${dto.passedCount}；错误 ${dto.errorCount}。\n\n| 文件 | 状态 | Selector | 需要运行时确认 | 诊断 | V0 | V1 | V2 | V3 | V4 |\n|---|---|---:|---:|---|---|---|---|---|---|\n${rows}\n`;
}
