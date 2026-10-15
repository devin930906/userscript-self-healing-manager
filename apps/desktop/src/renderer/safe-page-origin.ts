/** FR-040 / RG-07: show only a validated public website origin in the
 * desktop DOM diagnosis summary. Raw page URLs can contain account tokens in
 * query strings, paths, fragments or URL userinfo and must not be displayed.
 *
 * This is a presentation projection, NOT a scope check or a CDP authorization.
 * Runtime target identity is still validated by the existing Main-process gate.
 */
export function safeDomReportPageOrigin(value:unknown):string{
 const unknown='站点来源未确认';
 if(typeof value!=='string'||value.length<1||value.length>4096||\n    /[\\u0000-\\u001f\\u007f]/.test(value)||value.trim()!==value)return unknown;
 try{
  const url=new URL(value);
  if((url.protocol!=='http:'&&url.protocol!=='https:')||
     !url.hostname||url.username||url.password)return unknown;
  return url.origin;
 }catch{return unknown;}
}
