/** A conservative subset of userscript @match and @include. Unknown means fail closed. */
export type PageScopeStatus='allowed'|'blocked'|'unknown';
export interface PageScopeResult {status:PageScopeStatus;reason:string}
export interface UserscriptPageMetadata {match:readonly string[];include:readonly string[];raw:Readonly<Record<string,readonly string[]>>}
/**
 * Linear-time '*' glob matcher; does not construct regex from script metadata.
 * Backtracking only returns to the most recent wildcard and cannot explode
 * with many adjacent stars or nested untrusted pattern fragments.
 */
function wildcardMatch(pattern:string,input:string,ignoreCase=false):boolean {
 const glob=ignoreCase?pattern.toLowerCase():pattern;
 const text=ignoreCase?input.toLowerCase():input;
 let i=0,j=0,star=-1,starMatched=0;
 while(j<text.length){
  if(i<glob.length&&glob[i]===text[j]){i++;j++;continue;}
  if(i<glob.length&&glob[i]==='*'){star=i++;starMatched=j;continue;}
  if(star>=0){i=star+1;j=++starMatched;continue;}
  return false;
 }
 while(i<glob.length&&glob[i]==='*')i++;
 return i===glob.length;
}
function matchPattern(pattern:string,url:URL):boolean|null {
 if(pattern.length>2048)return null;
 if(pattern==='<all_urls>')return true;
 const match=pattern.match(/^(\*|http|https):\/\/([^/]+)(\/.*)$/i);
 if(!match)return null;
 const scheme=match[1]!.toLowerCase(),host=match[2]!.toLowerCase(),path=match[3]!;
 // Chrome match patterns do not allow arbitrary host wildcards or explicit ports.
 // Syntax is validated *before* checking whether a deny rule matches the URL.
 const base=host.startsWith('*.')?host.slice(2):host;
 if(host!=='*'&&(!base||base.includes('*')||base.includes(':')||base.includes('..')||
    !/^[a-z0-9.-]+$/i.test(base)||base.startsWith('.')||base.endsWith('.')))
  return null;
 if(!['http:','https:'].includes(url.protocol))return false;
 if(scheme!=='*'&&scheme+':'!==url.protocol)return false;
 if(host!=='*') {
  if(host.startsWith('*.')){
   if(!(url.hostname===base||url.hostname.endsWith('.'+base)))return false;
  }else if(url.hostname!==host)return false;
 }
 return wildcardMatch(path,url.pathname+url.search);
}
function includePattern(pattern:string,url:URL):boolean|null {
 if(pattern.startsWith('/')&&pattern.endsWith('/'))return null;
 if(pattern.length>500||!pattern.includes('://'))return null;
 // URL schemes and hostnames are case-insensitive, but paths and queries
 // are not. Normalizing the entire URL would invent userscript activation.
 const parts=/^([^:]+:\/\/)([^/]+)(.*)$/.exec(pattern);
 if(!parts)return null;
 const canonicalPattern=parts[1]!.toLowerCase()+parts[2]!.toLowerCase()+parts[3]!;
 return wildcardMatch(canonicalPattern,url.href);
}
export function checkUserscriptPageScope(meta:UserscriptPageMetadata,pageUrl:string):PageScopeResult {
 let url:URL;
 try{url=new URL(pageUrl);}catch{return {status:'blocked',reason:'Invalid page URL'};}
 if(!['http:','https:'].includes(url.protocol))return {status:'blocked',reason:'Only HTTP(S) CDP pages are supported'};
 // An unsupported deny rule must not silently permit a matching allow rule.
 for(const p of meta.raw['exclude-match']??[]){
  const excluded=matchPattern(p,url);
  if(excluded===true)return {status:'blocked',reason:'Page matches @exclude-match'};
  if(excluded===null)return {status:'unknown',reason:'Unsupported @exclude-match prevents safe scope confirmation'};
 }
 for(const p of meta.raw.exclude??[]){
  const excluded=includePattern(p,url);
  if(excluded===true)return {status:'blocked',reason:'Page matches @exclude'};
  if(excluded===null)return {status:'unknown',reason:'Unsupported @exclude prevents safe scope confirmation'};
 }
 const matches=meta.match.map(p=>matchPattern(p,url)),includes=meta.include.map(p=>includePattern(p,url));
 if(matches.some(v=>v===true)||includes.some(v=>v===true))return {status:'allowed',reason:'Page matches a userscript activation rule'};
 if(matches.length===0&&includes.length===0||[...matches,...includes].some(v=>v===null))return {status:'unknown',reason:'Missing or unsupported @match/@include rule'};
 return {status:'blocked',reason:'Selected page is not covered by @match/@include'};
}
