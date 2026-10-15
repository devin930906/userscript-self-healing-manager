/**
 * RG-05 DIAGNOSTIC ONLY: map CDP's zero-based location into the already
 * SHA-256-pinned, PUBLIC official Violentmonkey v2.49.0 injected.js asset.
 * Never parse/execute real userscripts or emit text, identifiers, stacks,
 * source spans or browser data. Syntax classes are not GM acceptance proof.
 *
 * The caller MUST supply only the fixed asset read from its isolated CFT
 * extension directory after verifying the release ZIP SHA-256. This module
 * never opens a path and is never bundled into Electron production code.
 */
import {createHash} from 'node:crypto';
import ts from 'typescript';

const allowedProperties=new Set([
 'sendMessage','connect','getScripts','register','unregister',
 'get','set','postMessage','then','catch','addListener','removeListener'
]);
const allowedBoundMethods=new Set([
 'forEach','slice','appendChild','getElementsByTagName','then','setData',
 'getBlob','getArrayBuffer','getText','map','getHighEntropyValues','fdAppend',
 'tdDecode','getReadyState','getDetail','getRelatedTarget','append','remove',
 'setAttribute','attachShadow','stopImmediatePropagation',
]);
export interface PublicFaultAstEvidence {
 readonly locationVerified:boolean;
 readonly syntaxKind:string;
 readonly callKind:'none'|'member-call'|'direct-call'|'other-call';
 readonly propertyKind:string;
 readonly expressionRole:'call-target'|'call-argument'|'other';
 readonly callArgumentIndex:number;
 readonly ancestorKinds:readonly string[];
 readonly calleeBindingKind:'safe-call-shape'|'function'|'alias'|'other'|'unresolved';
 readonly boundMethodKind:string;
 readonly fingerprintSha256:string;
}
const unavailable=():PublicFaultAstEvidence=>Object.freeze({
 locationVerified:false,syntaxKind:'unavailable',callKind:'none',
 propertyKind:'other',expressionRole:'other',callArgumentIndex:-1,
 ancestorKinds:Object.freeze([]),calleeBindingKind:'unresolved',
 boundMethodKind:'other',fingerprintSha256:'0'.repeat(64),
});

type LocalBinding=ts.VariableDeclaration|ts.BindingElement|ts.ParameterDeclaration|ts.FunctionDeclaration;
function bindingName(binding:LocalBinding):string{
 const name=binding.name;
 return name&&ts.isIdentifier(name)?name.text:'';
}
function findLocalBinding(file:ts.SourceFile,name:string,before:number):LocalBinding|undefined{
 if(!name||name.length>128)return undefined;
 let best:LocalBinding|undefined;
 let bestStart=-1;
 const visit=(current:ts.Node):void=>{
  const start=current.getStart(file);
  if(start>=before)return;
  if((ts.isVariableDeclaration(current)||ts.isBindingElement(current)||
      ts.isParameter(current)||ts.isFunctionDeclaration(current))&&
     bindingName(current)===name&&start>bestStart){
   best=current;bestStart=start;
  }
  ts.forEachChild(current,visit);
 };
 visit(file);
 return best;
}
function safeCallBindingShape(binding:LocalBinding|undefined):PublicFaultAstEvidence['calleeBindingKind']{
 if(!binding)return 'unresolved';
 if(ts.isFunctionDeclaration(binding))return 'function';
 if(ts.isParameter(binding))return 'other';
 if(ts.isBindingElement(binding))return 'alias';
 const init=binding.initializer;
 if(!init)return 'other';
 if(ts.isArrowFunction(init)||ts.isFunctionExpression(init))return 'function';
 if(ts.isIdentifier(init))return 'alias';
 if(ts.isCallExpression(init)&&ts.isPropertyAccessExpression(init.expression)&&
    init.expression.name.text==='bind'&&
    ts.isPropertyAccessExpression(init.expression.expression)&&
    init.expression.expression.name.text==='call'&&
    init.arguments.length===1&&ts.isPropertyAccessExpression(init.arguments[0])&&
    init.arguments[0].name.text==='call')
  return 'safe-call-shape';
 return 'other';
}
function fixedBoundMethod(file:ts.SourceFile,call:ts.CallExpression|undefined):string{
 if(!call||!ts.isIdentifier(call.expression)||call.arguments.length<1)return 'other';
 const arg=call.arguments[0];
 if(ts.isPropertyAccessExpression(arg)&&allowedBoundMethods.has(arg.name.text))
  return arg.name.text;
 if(!ts.isIdentifier(arg))return 'other';
 const binding=findLocalBinding(file,arg.text,call.getStart(file));
 if(ts.isBindingElement(binding)){
  const prop=binding.propertyName;
  const name=prop&&(ts.isIdentifier(prop)||ts.isStringLiteral(prop))?prop.text:
   ts.isIdentifier(binding.name)?binding.name.text:'';
  return allowedBoundMethods.has(name)?name:'other';
 }
 if(ts.isVariableDeclaration(binding)){
  const init=binding.initializer;
  if(init&&ts.isPropertyAccessExpression(init)&&allowedBoundMethods.has(init.name.text))
   return init.name.text;
 }
 return 'other';
}

export function mapPinnedOfficialFaultSite(source:unknown,row:unknown,column:unknown):PublicFaultAstEvidence{
 if(typeof source!=='string'||source.length<1||source.length>524288||
    !Number.isSafeInteger(row)||!Number.isSafeInteger(column)||
    (row as number)<0||(row as number)>100000||
    (column as number)<0||(column as number)>10000000)
  return unavailable();
 try{
  const file=ts.createSourceFile('injected.js',source,ts.ScriptTarget.ESNext,true,ts.ScriptKind.JS);
  const starts=file.getLineStarts();
  if((row as number)>=starts.length)return unavailable();
  const start=starts[row as number]!;
  const end=(row as number)+1<starts.length?starts[(row as number)+1]!:source.length;
  const position=start+(column as number);
  if(position>=end||position>=source.length)return unavailable();
  // Select the deepest syntax node touching ONLY this coordinate.
  // Do not export even a property name unless it belongs to our fixed set.
  let node:ts.Node=file;
  for(let depth=0;depth<80;depth++){
   let child:ts.Node|undefined;
   ts.forEachChild(node,item=>{
    if(item.getStart(file)<=position&&position<item.getEnd())child=item;
   });
   if(!child)break;
   node=child;
  }
  let call:ts.CallExpression|undefined;
  for(let ancestor:ts.Node|undefined=node;ancestor;ancestor=ancestor.parent){
   if(ts.isCallExpression(ancestor)){call=ancestor;break;}
  }
  const callKind:PublicFaultAstEvidence['callKind']=!call?'none':
   ts.isPropertyAccessExpression(call.expression)?'member-call':
   ts.isIdentifier(call.expression)?'direct-call':'other-call';
  const method=call&&ts.isPropertyAccessExpression(call.expression)
   ?call.expression.name.text:'';
  const propertyKind=allowedProperties.has(method)?method:'other';
  let expressionRole:PublicFaultAstEvidence['expressionRole']='other';
  let callArgumentIndex=-1;
  if(call){
   if(call.expression.getStart(file)<=position&&position<call.expression.getEnd()){
    expressionRole='call-target';
   }else{
    const index=call.arguments.findIndex(argument=>
     argument.getStart(file)<=position&&position<argument.getEnd());
    if(index>=0&&index<=32){
     expressionRole='call-argument';
     callArgumentIndex=index;
    }
   }
  }
  const ancestorKinds:string[]=[];
  for(let current:ts.Node|undefined=node;current&&ancestorKinds.length<6;current=current.parent){
   const kind=ts.SyntaxKind[current.kind]||'unknown';
   if(typeof kind==='string'&&kind.length>0&&kind.length<64)ancestorKinds.push(kind);
  }
  const calleeBinding=call&&ts.isIdentifier(call.expression)
   ?findLocalBinding(file,call.expression.text,call.getStart(file)):undefined;
  const calleeBindingKind=safeCallBindingShape(calleeBinding);
  const boundMethodKind=calleeBindingKind==='safe-call-shape'
   ?fixedBoundMethod(file,call):'other';
  return Object.freeze({
   locationVerified:true,
   syntaxKind:ts.SyntaxKind[node.kind]||'unknown',
   callKind,propertyKind,expressionRole,callArgumentIndex,
   ancestorKinds:Object.freeze(ancestorKinds),calleeBindingKind,boundMethodKind,
   fingerprintSha256:createHash('sha256').update(source,'utf8').digest('hex'),
  });
 }catch{
  return unavailable();
 }
}
