/**
 * A browser-discovered page URL is trusted only for exact Main-process CDP
 * identity checks. The renderer's target picker needs a human-readable site
 * origin, never userinfo, document paths, query strings or fragments: these
 * frequently contain private account names and one-time login tokens.
 *
 * This is a display-only declassification; never reuse it as a page identity,
 * selector scope, browser socket destination or userscript match URL.
 */
export function displayCdpPageOrigin(value:unknown):string{
 const unavailable='[non-web/invalid page]';
 if(typeof value!=='string'||value.length<1||value.length>8192||
    value!==value.trim()||/[\u0000-\u001F\u007F]/.test(value))return unavailable;
 try{
  const parsed=new URL(value);
  if((parsed.protocol!=='http:'&&parsed.protocol!=='https:')||!parsed.hostname)
   return unavailable;
  const origin=parsed.origin;
  return origin.length<=256?origin:unavailable;
 }catch{return unavailable;}
}
