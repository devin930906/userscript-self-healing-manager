import {checkUserscriptPageScope} from './page-scope.ts';

/**
 * Versioned, local-only compatibility descriptions.
 * A role definition is an untrusted proposal for future evidence collection,
 * NOT DOM evidence or permission to execute a userscript.
 */
export interface AdapterContext {
 readonly stateId:string;
 readonly frame:'top'|'iframe';
 readonly shadow:'none'|'open';
}
export interface AdapterRole {
 readonly contexts:readonly AdapterContext[];
 readonly strategies:readonly {readonly kind:'css';readonly selector:string;readonly weight:number}[];
 readonly cardinality:{readonly min:number;readonly max:number};
 readonly assertions:readonly ('exists'|'unique')[];
}
export interface SiteAdapter {
 readonly schemaVersion:1;
 readonly siteId:string;
 readonly version:string;
 readonly urlPatterns:readonly string[];
 readonly states:Readonly<Record<string,{readonly description:string}>>;
 readonly roles:Readonly<Record<string,AdapterRole>>;
 readonly validationCases:readonly string[];
}
export interface AdapterRoleResolution {
 readonly status:'candidate-only'|'out-of-scope'|'blocked-context'|'unknown-role';
 readonly selectors:readonly string[];
 readonly validationLevel:'definition-only';
 readonly functionalVerified:false;
 readonly managerVerified:false;
}
export interface AdapterScriptDependency {
 readonly scriptId:string;
 readonly siteId:string;
 readonly pinnedVersion:string;
 readonly roles:readonly string[];
 readonly regressionCases:readonly string[];
}
export interface AdapterImpactReport {
 readonly siteId:string;
 readonly fromVersion:string;
 readonly toVersion:string;
 readonly changedRoles:readonly string[];
 readonly removedRoles:readonly string[];
 readonly affectedScriptIds:readonly string[];
 readonly requiredRegressionCases:readonly string[];
 readonly status:'unchanged'|'no-affected-scripts'|'review-required'|'blocked-removal';
 readonly autoActivateAllowed:false;
}
type AnyObject=Record<string,unknown>;
const idRe=/^[a-z][a-z0-9-]{0,63}$/;
const stateRe=/^[a-z][a-z0-9-]{0,40}$/;
const roleRe=/^[a-z][a-z0-9_-]{0,40}(?:\.[a-z][a-z0-9_-]{0,40})+$/;
const caseRe=/^[A-Z][A-Z0-9_:-]{0,63}$/;
const versionRe=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const cssRe=/^(?:#[a-zA-Z][\w-]{0,63}|\.[a-zA-Z][\w-]{0,63}|\[(?:id|name|class|data-testid|data-test|data-qa)="[a-zA-Z][\w-]{0,63}"\])$/;
const scopeRe=/^https?:\/\/(?:\*\.)?[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[a-zA-Z0-9_.*~/%/-]*$/;

function record(value:unknown,where:string):AnyObject{
 if(value===null||typeof value!=='object'||Array.isArray(value)||
    (Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null))
  throw new Error('Invalid adapter '+where+' object');
 return value as AnyObject;
}
function exact(value:AnyObject,fields:readonly string[],where:string){
 const valid=new Set(fields);
 for(const k of Object.keys(value))
  if(!valid.has(k)||k==='__proto__'||k==='constructor'||k==='prototype')
   throw new Error('Unsafe or unsupported adapter '+where+' field: '+k);
 for(const k of fields)if(!Object.hasOwn(value,k))throw new Error('Missing adapter '+where+' field: '+k);
}
function textField(value:unknown,re:RegExp,what:string):string{
 if(typeof value!=='string'||!re.test(value))throw new Error('Invalid adapter '+what);
 return value;
}
function arr(value:unknown,max:number,what:string):unknown[]{
 if(!Array.isArray(value)||value.length>max)throw new Error('Invalid adapter '+what+' list');
 return value;
}
function names(items:unknown,regex:RegExp,maximum:number,what:string):string[]{
 const results=arr(items,maximum,what).map(v=>textField(v,regex,what));
 if(new Set(results).size!==results.length)throw new Error('Duplicate adapter '+what);
 return results;
}
function versionParts(version:string):number[]{
 const values=version.split('.').map(Number);
 if(values.some(v=>!Number.isSafeInteger(v)))throw new Error('Invalid adapter version');
 return values;
}
function newer(left:string,right:string):boolean {
 const a=versionParts(left),b=versionParts(right);
 for(let i=0;i<3;i++){if(a[i]! > b[i]!)return true;if(a[i]! < b[i]!)return false;}
 return false;
}
function freezeRoles(roles:Record<string,AdapterRole>):Readonly<Record<string,AdapterRole>> {
 return Object.freeze(roles);
}

/** Reject unknown fields and unbounded data before an adapter enters the app. */
export function parseSiteAdapter(raw:unknown):SiteAdapter {
 const root=record(raw,'root');
 exact(root,['schemaVersion','siteId','version','urlPatterns','states','roles','validationCases'],'root');
 if(root.schemaVersion!==1)throw new Error('Unsupported adapter schema version');
 const siteId=textField(root.siteId,idRe,'site ID');
 const version=textField(root.version,versionRe,'version');
 versionParts(version);
 const urlPatterns=names(root.urlPatterns,scopeRe,12,'scope patterns');
 if(!urlPatterns.length||urlPatterns.some(p=>p.length>256||p.includes('..')||p.includes('?')||p.includes('#')||p.includes('://*')))
  throw new Error('Invalid adapter scope pattern');
 // A '*' host or global wildcard would let a site-specific adapter escape
 // its intended origin. Use the ordinary userscript matcher for the final URL.
 for(const p of urlPatterns){
  const host=p.split('/')[2]??'';
  const base=host.startsWith('*.')?host.slice(2):host;
  if(!base||base.includes('*')||base.includes('..')||base.startsWith('.')||base.endsWith('.')||
     !/^[a-z0-9.-]+$/.test(base))
   throw new Error('Invalid adapter scope host');
 }
 const stateRaw=record(root.states,'states');
 const stateKeys=Object.keys(stateRaw);
 if(!stateKeys.length||stateKeys.length>16)throw new Error('Invalid adapter state count');
 const states:Record<string,{readonly description:string}>=Object.create(null);
 for(const state of stateKeys){
  textField(state,stateRe,'state ID');
  const entry=record(stateRaw[state],'state');
  exact(entry,['description'],'state');
  if(typeof entry.description!=='string'||entry.description.length<1||entry.description.length>160||
     /[\u0000-\u001f]/.test(entry.description))throw new Error('Invalid adapter state description');
  states[state]=Object.freeze({description:entry.description});
 }
 const roleRaw=record(root.roles,'roles');
 const roleKeys=Object.keys(roleRaw);
 if(!roleKeys.length||roleKeys.length>50)throw new Error('Invalid adapter role count');
 const roles:Record<string,AdapterRole>=Object.create(null);
 for(const roleId of roleKeys){
  textField(roleId,roleRe,'role ID');
  const rawRole=record(roleRaw[roleId],'role');
  exact(rawRole,['contexts','strategies','cardinality','assertions'],'role');
  const contexts=arr(rawRole.contexts,8,'role contexts').map(value=>{
   const context=record(value,'context');
   exact(context,['stateId','frame','shadow'],'context');
   const stateId=textField(context.stateId,stateRe,'context state');
   if(!Object.hasOwn(states,stateId))throw new Error('Adapter context references an unknown state');
   if(context.frame!=='top'&&context.frame!=='iframe')throw new Error('Unsupported adapter frame context');
   if(context.shadow!=='none'&&context.shadow!=='open')throw new Error('Unsupported adapter shadow context');
   return Object.freeze({stateId,frame:context.frame,shadow:context.shadow}) as AdapterContext;
  });
  if(!contexts.length||new Set(contexts.map(c=>JSON.stringify(c))).size!==contexts.length)
   throw new Error('Invalid or duplicate adapter contexts');
  const strategies=arr(rawRole.strategies,10,'role strategies').map(value=>{
   const strategy=record(value,'strategy');
   exact(strategy,['kind','selector','weight'],'strategy');
   if(strategy.kind!=='css')throw new Error('Unsupported adapter strategy kind');
   const selector=textField(strategy.selector,cssRe,'strategy selector');
   if(!Number.isSafeInteger(strategy.weight)||Number(strategy.weight)<1||Number(strategy.weight)>100)
    throw new Error('Invalid adapter strategy weight');
   return Object.freeze({kind:'css' as const,selector,weight:strategy.weight as number});
  });
  if(!strategies.length||new Set(strategies.map(s=>s.selector)).size!==strategies.length)
   throw new Error('Invalid or duplicate adapter strategies');
  const rawCard=record(rawRole.cardinality,'cardinality');
  exact(rawCard,['min','max'],'cardinality');
  const min=rawCard.min,max=rawCard.max;
  if(!Number.isSafeInteger(min)||!Number.isSafeInteger(max)||
     Number(min)<1||Number(max)>10||Number(min)>Number(max))
   throw new Error('Invalid adapter cardinality');
  const assertions=names(rawRole.assertions,/^(?:exists|unique)$/,4,'role assertions') as ('exists'|'unique')[];
  if(!assertions.length)throw new Error('Missing adapter role assertions');
  if(assertions.includes('unique')&&(min!==1||max!==1))throw new Error('Invalid adapter unique cardinality');
  roles[roleId]=Object.freeze({
   contexts:Object.freeze(contexts),
   strategies:Object.freeze(strategies.sort((a,b)=>b.weight-a.weight||a.selector.localeCompare(b.selector))),
   cardinality:Object.freeze({min:min as number,max:max as number}),
   assertions:Object.freeze(assertions),
  });
 }
 const validationCases=names(root.validationCases,caseRe,64,'validation cases');
 if(!validationCases.length)throw new Error('Adapter must define validation cases');
 return Object.freeze({
  schemaVersion:1,siteId,version,urlPatterns:Object.freeze(urlPatterns),
  states:Object.freeze(states),roles:freezeRoles(roles),
  validationCases:Object.freeze(validationCases),
 });
}

/** A local suggestion list only: never run scripts or upgrade to DOM/V3/V4 success. */
export function resolveSiteAdapterRole({adapter,pageUrl,roleId,observedStateId}:{
 adapter:SiteAdapter;pageUrl:string;roleId:string;observedStateId:string|null;
}):AdapterRoleResolution {
 const output=(status:AdapterRoleResolution['status'],selectors:readonly string[]=[]):AdapterRoleResolution=>({
  status,selectors,validationLevel:'definition-only',functionalVerified:false,managerVerified:false,
 });
 // Revalidate even if a caller used a TypeScript cast to forge a definition.
 const trusted=parseSiteAdapter(adapter);
 const scope=checkUserscriptPageScope({
  match:trusted.urlPatterns,include:[],raw:{},
 },pageUrl);
 if(scope.status!=='allowed')return output('out-of-scope');
 const role=Object.hasOwn(trusted.roles,roleId)?trusted.roles[roleId]:undefined;
 if(!role)return output('unknown-role');
 if(!observedStateId||!Object.hasOwn(trusted.states,observedStateId))return output('blocked-context');
 if(!role.contexts.some(c=>c.stateId===observedStateId&&c.frame==='top'&&c.shadow==='none'))
  return output('blocked-context');
 return output('candidate-only',role.strategies.map(s=>s.selector));
}

/** Changed shared locators never activate automatically, even with zero dependents. */
export function assessSiteAdapterUpgrade({previous,next,dependencies}:{
 previous:SiteAdapter;next:SiteAdapter;dependencies:readonly AdapterScriptDependency[];
}):AdapterImpactReport {
 const old=parseSiteAdapter(previous),incoming=parseSiteAdapter(next);
 if(old.siteId!==incoming.siteId)throw new Error('Adapter site identity changed');
 if(!newer(incoming.version,old.version))throw new Error('Adapter upgrade requires a newer semantic version');
 if(!Array.isArray(dependencies)||dependencies.length>1000)throw new Error('Invalid adapter dependency budget');
 const changedRoles:string[]=[];
 const removedRoles:string[]=[];
 for(const roleId of new Set([...Object.keys(old.roles),...Object.keys(incoming.roles)])){
  const a=old.roles[roleId],b=incoming.roles[roleId];
  const stateSignature=(role:AdapterRole|undefined,adapter:SiteAdapter)=>
   role?.contexts.map(c=>[c.stateId,adapter.states[c.stateId]]);
  if(JSON.stringify([a,stateSignature(a,old)])!==JSON.stringify([b,stateSignature(b,incoming)]))
   changedRoles.push(roleId);
  if(a&&!b)removedRoles.push(roleId);
 }
 changedRoles.sort();removedRoles.sort();
 const affected=new Set<string>(),regressions=new Set(incoming.validationCases),removedUsed=new Set<string>();
 for(const dep of dependencies){
  if(!dep||typeof dep!=='object'||!idRe.test(dep.scriptId)||!idRe.test(dep.siteId)||
     !versionRe.test(dep.pinnedVersion)||
     !Array.isArray(dep.roles)||dep.roles.length>50||
     !Array.isArray(dep.regressionCases)||dep.regressionCases.length>64)
   throw new Error('Invalid adapter dependency record');
  for(const r of dep.roles)textField(r,roleRe,'dependency role');
  for(const v of dep.regressionCases)textField(v,caseRe,'dependency regression case');
  if(dep.siteId!==old.siteId||dep.pinnedVersion!==old.version)continue;
  if(!dep.roles.some(id=>changedRoles.includes(id)))continue;
  affected.add(dep.scriptId);
  for(const name of dep.regressionCases)regressions.add(name);
  for(const id of dep.roles)if(removedRoles.includes(id))removedUsed.add(id);
 }
 const status:AdapterImpactReport['status']=
  removedUsed.size?'blocked-removal':changedRoles.length===0?'unchanged':
  affected.size?'review-required':'no-affected-scripts';
 return Object.freeze({
  siteId:old.siteId,fromVersion:old.version,toVersion:incoming.version,
  changedRoles:Object.freeze(changedRoles),removedRoles:Object.freeze(removedRoles),
  affectedScriptIds:Object.freeze([...affected].sort()),
  requiredRegressionCases:Object.freeze([...regressions].sort()),
  status,autoActivateAllowed:false,
 });
}
