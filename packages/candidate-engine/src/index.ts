/** Candidate generation from privacy-filtered DOM attribute evidence only.
 * This does not prove semantic equivalence or userscript functionality. */
export interface SafeDomNode {readonly tagName:string;readonly attributes:Readonly<Record<string,string>>}
export interface SelectorCandidate {
 readonly expression:string;
 readonly cssSelector:string;
 readonly source:'DOMSnapshot';
 readonly matchCount:1;
 readonly confidenceScore:number;
 readonly evidence:string;
 readonly validationLevel:'candidate-only';
 readonly approved:false;
}
interface CandidateInput {
 readonly method:string;
 readonly oldSelector:string;
 readonly nodes:readonly SafeDomNode[];
 readonly runtimeRequired?:boolean;
 readonly limit?:number;
}
const MAX_NODES=5000;
const allowed=new Set(['id','data-testid','data-test','data-qa','name','class']);
const weights:Readonly<Record<string,number>>={'data-testid':100,'data-test':94,'data-qa':92,id:85,name:60,class:48};
/** These are public-facing locator tokens, not arbitrary page attributes or text. */
export function isSafeLocatorToken(value:string):boolean {
 if(!/^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(value))return false;
 if(/[0-9]/g.test(value) && value.replace(/\D/g,'').length > Math.max(8,value.length/2))return false;
 if(/(?:password|token|secret|api[-_]?key|session|auth[-_]?code)/i.test(value))return false;
 if(/^[a-f0-9]{16,}$/i.test(value))return false;
 return true;
}
function words(text:string):Set<string> {
 return new Set(text.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>=3&&!['data','test','btn','css','selector'].includes(x)));
}
function selectors(node:SafeDomNode,method:string):Array<{expression:string;cssSelector:string;weight:number;evidence:string}> {
 const result:Array<{expression:string;cssSelector:string;weight:number;evidence:string}>=[];
 for(const [name,value] of Object.entries(node.attributes)) {
  if(!allowed.has(name)||typeof value!=='string')continue;
  if(name==='class' && (method==='querySelector'||method==='getElementsByClassName')) {
   const tokens=value.split(/\s+/).filter(isSafeLocatorToken).slice(0,5);
   for(const x of tokens)result.push({expression:method==='getElementsByClassName'?x:'.'+x,
    cssSelector:'.'+x,weight:weights.class!,evidence:'class'});
  }else if(isSafeLocatorToken(value)) {
   if(method==='getElementById' && name!=='id')continue;
   if(method==='getElementsByName' && name!=='name')continue;
   if(method==='getElementsByClassName')continue;
   const cssSelector=name==='id'?'#'+value:'['+name+'="'+value+'"]';
   result.push({expression:['getElementById','getElementsByName'].includes(method)?value:cssSelector,cssSelector,weight:weights[name]!,evidence:name});
  }
 }
 return result;
}
/** Returns bounded *suggestions*, not automatic edits. Uniqueness is computed on current safe DOM evidence. */
export function rankSelectorCandidates({method,oldSelector,nodes,runtimeRequired=false,limit=10}:CandidateInput):SelectorCandidate[]{
 if(runtimeRequired||!['querySelector','getElementById','getElementsByName','getElementsByClassName'].includes(method)||typeof oldSelector!=='string'||!oldSelector.trim()||oldSelector.length>1024)return [];
 if(!Number.isInteger(limit)||limit<1||limit>10)throw new Error('Invalid candidate limit');
 if(nodes.length>MAX_NODES)throw new Error('DOM candidate node limit exceeded');
 const oldWords=words(oldSelector);
 const occurrences=new Map<string,{count:number;entry:{expression:string;cssSelector:string;weight:number;evidence:string}}>();
 for(const node of nodes) {
  if(!/^[a-z][a-z0-9-]{0,30}$/i.test(node.tagName))continue;
  const thisNode=new Set<string>();
  for(const entry of selectors(node,method)) {
   if(thisNode.has(entry.cssSelector))continue;thisNode.add(entry.cssSelector);
   const found=occurrences.get(entry.cssSelector);
   if(found)found.count++;
   else occurrences.set(entry.cssSelector,{count:1,entry});
  }
 }
 const candidates:SelectorCandidate[]=[];
 for(const {count,entry} of occurrences.values()) {
  if(count!==1||entry.expression===oldSelector)continue;
  const similarity=[...words(entry.expression)].filter(x=>oldWords.has(x)).length;
  const confidenceScore=Math.min(100,Math.round(entry.weight*0.68+similarity*12));
  candidates.push({expression:entry.expression,cssSelector:entry.cssSelector,source:'DOMSnapshot',matchCount:1,confidenceScore,evidence:"单节点唯一的 "+entry.evidence+" 属性，语义词重合 "+similarity+" 个",validationLevel:'candidate-only',approved:false});
 }
 return candidates.sort((a,b)=>b.confidenceScore-a.confidenceScore||a.expression.localeCompare(b.expression,'en')).slice(0,limit);
}
