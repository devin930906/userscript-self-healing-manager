/**
 * A userscript DOM method does not always accept CSS. Keep raw-argument
 * methods distinct so that a #prefix never accidentally breaks getElementById.
 */
export function getRepairInputHint(method:string|undefined):string {
 switch(method){
  case 'getElementById':
   return '输入原始元素 ID（不要加 #），例如 new-button';
  case 'getElementsByName':
   return '输入原始 name 属性值，例如 customer-name';
  case 'getElementsByClassName':
   return '输入类名，多个类名以空格分隔（不要加 .），例如 panel primary';
  default:
   return '#new-id 或 [data-testid="save-button"]';
 }
}
