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
/**
 * Do not execute getters supplied by hostile metadata or array elements while
 * deciding whether a page falls within a userscript's declared scope.
 * Snapshot own data properties only; inherited deny lists fail closed.
 */
function readScopeRules(source:object,key:string,optional=false):string[]|null{
 const field=Object.getOwnPropertyDescriptor(source,key);
 if(!field)return optional&&!(key in source)?[]:null;
 if(!Object.hasOwn(field,'value')||!Array.isArray(field.value))return null;
 const values=field.value as unknown[];
 // Array Proxy get('length') may lie and silently omit an @exclude rule.
 // Read the array's own data descriptor instead of running a hostile getter.
 const ownLength=Object.getOwnPropertyDescriptor(values,'length');
 const count=ownLength?.value;
 if(!ownLength||!Object.hasOwn(ownLength,'value')||
    !Number.isSafeInteger(count)||count<0||count>256)return null;
 // Even own property descriptors can be forged by a Proxy while the
 // underlying array still contains real @exclude entries. Verify every
 // indexed own key and reject custom fields before cloning; otherwise an
 // unrelated enumerable accessor could run during structuredClone.
 const keys=Reflect.ownKeys(values);
 if(keys.length!==count+1||keys[count]!=='length')return null;
 const rules:string[]=[];
 for(let i=0;i<count;i++){
  if(keys[i]!==String(i))return null;
  const item=Object.getOwnPropertyDescriptor(values,String(i));
  if(!item||!Object.hasOwn(item,'value')||typeof item.value!=='string')return null;
  rules.push(item.value);
 }
 // A Proxy can lie consistently about both descriptors and ownKeys.
 // structuredClone rejects Proxies; after the complete data-slot census it
 // cannot invoke an unexpected own getter on an ordinary rules array.
 const cloned=structuredClone(values);
 if(!Array.isArray(cloned)||cloned.length!==count||
    cloned.some((rule,index)=>rule!==rules[index]))return null;
 return rules;
}
/**
 * A Proxy can forge the absence of a configurable @exclude property on raw,
 * or replace the root's raw descriptor with an empty object. Descriptors alone
 * cannot authenticate either container: structuredClone rejects Proxy values.
 *
 * Before cloning, census only bounded own DATA properties and string arrays
 * so structuredClone cannot execute an unrelated user-supplied getter.
 * Fail closed for malformed/oversized metadata, not just the four scope keys.
 */
function metadataCloneIsSafe(meta:object,raw:object):boolean{
 let totalEntries=0,totalCharacters=0;
 const scan=(source:object,root:boolean):boolean=>{
  const keys=Reflect.ownKeys(source);
  if(keys.length>64)return false;
  for(const key of keys){
   if(typeof key!=='string')return false;
   const descriptor=Object.getOwnPropertyDescriptor(source,key);
   if(!descriptor||!Object.hasOwn(descriptor,'value'))return false;
   const value=descriptor.value;
   if(root&&key==='raw'){
    if(value!==raw)return false;
    continue;
   }
   if(Array.isArray(value)){
    const items=readScopeRules(source,key);
    if(!items)return false;
    totalEntries+=items.length;
    for(const item of items)totalCharacters+=item.length;
   }else if(root&&(value===null||typeof value==='string'||
                     typeof value==='boolean'||typeof value==='number')){
    if(typeof value==='number'&&!Number.isFinite(value))return false;
    if(typeof value==='string')totalCharacters+=value.length;
   }else return false;
   if(totalEntries>4096||totalCharacters>131072)return false;
  }
  return true;
 };
 try{
  if(!scan(meta,true)||!scan(raw,false))return false;
  // The original container, not a sanitized re-creation, must be cloneable:
  // cloning a copied record would miss Proxy-forged property descriptors.
  const copy=structuredClone(meta);
  return copy!==null&&typeof copy==='object'&&!Array.isArray(copy);
 }catch{return false;}
}
export function checkUserscriptPageScope(meta:UserscriptPageMetadata,pageUrl:string):PageScopeResult {
 // Page URLs arrive across a runtime trust boundary: TypeScript alone cannot
 // prevent object coercion from invoking an untrusted toString/toPrimitive.
 // Share the 8192-character cap of the CDP page identity boundary.
 if(typeof pageUrl!=='string'||pageUrl.length===0||pageUrl.length>8192)
  return {status:'blocked',reason:'Invalid page URL'};
 // Treat userscript metadata as hostile input, not a bounded trusted list.
 // Enforce the aggregate cap BEFORE accepting even the first @match: a huge
 // trailing deny/include list must not bypass full activation-scope review.
 const unverified={status:'unknown' as const,reason:'Userscript page-scope rules exceed the safe evaluation budget or are malformed'};
 let matchRules:string[],includeRules:string[],excludeMatchRules:string[],excludeRules:string[];
 try{
  if(!meta||typeof meta!=='object'||Array.isArray(meta))return unverified;
  const rawField=Object.getOwnPropertyDescriptor(meta,'raw');
  if(!rawField||!Object.hasOwn(rawField,'value'))return unverified;
  const raw=rawField.value;
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return unverified;
  const match=readScopeRules(meta,'match');
  const include=readScopeRules(meta,'include');
  const excludeMatch=readScopeRules(raw,'exclude-match',true);
  const exclude=readScopeRules(raw,'exclude',true);
  if(!match||!include||!excludeMatch||!exclude)return unverified;
  if(!metadataCloneIsSafe(meta,raw))return unverified;
  matchRules=match;includeRules=include;
  excludeMatchRules=excludeMatch;excludeRules=exclude;
 }catch{return unverified;}
 const groups=[matchRules,includeRules,excludeMatchRules,excludeRules];
 let patternCount=0,totalCharacters=0;
 for(const patterns of groups){
  if(!Array.isArray(patterns))return unverified;
  patternCount+=patterns.length;
  if(patternCount>256)return unverified;
  for(const pattern of patterns){
   if(typeof pattern!=='string')return unverified;
   totalCharacters+=pattern.length;
   if(totalCharacters>65536)return unverified;
  }
 }
 let url:URL;
 try{url=new URL(pageUrl);}catch{return {status:'blocked',reason:'Invalid page URL'};}
 if(!['http:','https:'].includes(url.protocol))return {status:'blocked',reason:'Only HTTP(S) CDP pages are supported'};
 // Credential-bearing URL authorities are sensitive and cannot be treated as ordinary page scope.
 if(url.username||url.password)return {status:'blocked',reason:'Credentialed CDP page URLs are not supported'};
 // An unsupported deny rule must not silently permit a matching allow rule.
 for(const p of excludeMatchRules){
  const excluded=matchPattern(p,url);
  if(excluded===true)return {status:'blocked',reason:'Page matches @exclude-match'};
  if(excluded===null)return {status:'unknown',reason:'Unsupported @exclude-match prevents safe scope confirmation'};
 }
 for(const p of excludeRules){
  const excluded=includePattern(p,url);
  if(excluded===true)return {status:'blocked',reason:'Page matches @exclude'};
  if(excluded===null)return {status:'unknown',reason:'Unsupported @exclude prevents safe scope confirmation'};
 }
 const matches=matchRules.map(p=>matchPattern(p,url)),includes=includeRules.map(p=>includePattern(p,url));
 if(matches.some(v=>v===true)||includes.some(v=>v===true))return {status:'allowed',reason:'Page matches a userscript activation rule'};
 if(matches.length===0&&includes.length===0||[...matches,...includes].some(v=>v===null))return {status:'unknown',reason:'Missing or unsupported @match/@include rule'};
 return {status:'blocked',reason:'Selected page is not covered by @match/@include'};
}
