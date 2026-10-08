/** A conservative subset of userscript @match and @include. Unknown means fail closed. */
export type PageScopeStatus='allowed'|'blocked'|'unknown';
export interface PageScopeResult {status:PageScopeStatus;reason:string}
export interface UserscriptPageMetadata {match:readonly string[];include:readonly string[];raw:Readonly<Record<string,readonly string[]>>}
const escape=(s:string)=>s.replace(/[^A-Za-z0-9]/g,char=>'\\'+char);
function matchPattern(pattern:string,url:URL):boolean|null {
 if(pattern==='<all_urls>')return true;
 const match=pattern.match(/^(\*|http|https):\/\/([^/]+)(\/.*)$/i);
 if(!match)return null;
 const scheme=match[1]!.toLowerCase(),host=match[2]!.toLowerCase(),path=match[3]!;
 if(!['http:','https:'].includes(url.protocol))return false;
 if(scheme!=='*'&&scheme+':'!==url.protocol)return false;
 if(host!=='*') {
  if(host.startsWith('*.')){
   const base=host.slice(2);
   if(!base||host.slice(2).includes('*')||!(url.hostname===base||url.hostname.endsWith('.'+base)))return false;
  }else if(host.includes('*')||url.hostname!==host)return false;
 }
 const pathRegex=new RegExp('^'+path.split('*').map(escape).join('.*')+'$');
 return pathRegex.test(url.pathname+url.search);
}
function includePattern(pattern:string,url:URL):boolean|null {
 if(pattern.startsWith('/')&&pattern.endsWith('/'))return null;
 if(pattern.length>500||!pattern.includes('://'))return null;
 const regex=new RegExp('^'+pattern.split('*').map(escape).join('.*')+'$','i');
 return regex.test(url.href);
}
export function checkUserscriptPageScope(meta:UserscriptPageMetadata,pageUrl:string):PageScopeResult {
 let url:URL;
 try{url=new URL(pageUrl);}catch{return {status:'blocked',reason:'Invalid page URL'};}
 if(!['http:','https:'].includes(url.protocol))return {status:'blocked',reason:'Only HTTP(S) CDP pages are supported'};
 for(const p of meta.raw['exclude-match']??[])if(matchPattern(p,url)===true)return {status:'blocked',reason:'Page matches @exclude-match'};
 for(const p of meta.raw.exclude??[])if(includePattern(p,url)===true)return {status:'blocked',reason:'Page matches @exclude'};
 const matches=meta.match.map(p=>matchPattern(p,url)),includes=meta.include.map(p=>includePattern(p,url));
 if(matches.some(v=>v===true)||includes.some(v=>v===true))return {status:'allowed',reason:'Page matches a userscript activation rule'};
 if(matches.length===0&&includes.length===0||[...matches,...includes].some(v=>v===null))return {status:'unknown',reason:'Missing or unsupported @match/@include rule'};
 return {status:'blocked',reason:'Selected page is not covered by @match/@include'};
}
