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
const allowedFirstArgumentLiterals=new Set([
 'NotificationClicked','NotificationClosed',
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
 readonly callArgumentCount:number;
 readonly elementBaseKind:string;
 readonly elementBaseBindingKind:'parameter'|'variable'|'binding-element'|'function'|'unresolved'|'other';
 readonly elementIndexKind:'number-0'|'number-1'|'number-other'|'identifier'|'string'|'other';
 readonly calleeFunctionKind:'function-declaration'|'function-expression'|'arrow-block'|'arrow-expression'|'other'|'unresolved';
 readonly calleeParameterCount:number;
 readonly calleeStatementCount:number;
 readonly binaryOperatorKinds:readonly string[];
 readonly binaryOperandRoles:readonly ('left'|'right'|'other')[];
 readonly callArgumentKinds:readonly string[];
 readonly firstArgumentLiteralKind:string;
 readonly calleeBodyKind:string;
 readonly calleeBodyBinaryOperatorKinds:readonly string[];
 readonly elementBaseInitializerKind:string;
 readonly fixedUpstreamShape:'mv3-runtime-onmessage-listener-wrapper'|'other'|'unavailable';
 readonly fingerprintSha256:string;
}
const unavailable=():PublicFaultAstEvidence=>Object.freeze({
 locationVerified:false,syntaxKind:'unavailable',callKind:'none',
 propertyKind:'other',expressionRole:'other',callArgumentIndex:-1,
 ancestorKinds:Object.freeze([]),calleeBindingKind:'unresolved',
 boundMethodKind:'other',callArgumentCount:-1,elementBaseKind:'unavailable',
 elementBaseBindingKind:'unresolved',elementIndexKind:'other',
 calleeFunctionKind:'unresolved',calleeParameterCount:-1,calleeStatementCount:-1,
 binaryOperatorKinds:Object.freeze([]),binaryOperandRoles:Object.freeze([]),
 callArgumentKinds:Object.freeze([]),firstArgumentLiteralKind:'other',
 calleeBodyKind:'unavailable',calleeBodyBinaryOperatorKinds:Object.freeze([]),
 elementBaseInitializerKind:'unavailable',fixedUpstreamShape:'unavailable',
 fingerprintSha256:'0'.repeat(64),
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

function stableBinaryOperatorKind(kind:ts.SyntaxKind):string{
 if(kind===ts.SyntaxKind.EqualsToken)return 'EqualsToken';
 if(kind===ts.SyntaxKind.AmpersandAmpersandToken)return 'AmpersandAmpersandToken';
 if(kind===ts.SyntaxKind.BarBarToken)return 'BarBarToken';
 if(kind===ts.SyntaxKind.QuestionQuestionToken)return 'QuestionQuestionToken';
 if(kind===ts.SyntaxKind.PlusToken)return 'PlusToken';
 if(kind===ts.SyntaxKind.MinusToken)return 'MinusToken';
 if(kind===ts.SyntaxKind.AsteriskToken)return 'AsteriskToken';
 if(kind===ts.SyntaxKind.SlashToken)return 'SlashToken';
 if(kind===ts.SyntaxKind.EqualsEqualsEqualsToken)return 'EqualsEqualsEqualsToken';
 if(kind===ts.SyntaxKind.ExclamationEqualsEqualsToken)return 'ExclamationEqualsEqualsToken';
 const name=ts.SyntaxKind[kind]||'unknown';
 return typeof name==='string'&&name.length<64?name:'unknown';
}
function localBindingKind(binding:LocalBinding|undefined):PublicFaultAstEvidence['elementBaseBindingKind']{
 if(!binding)return 'unresolved';
 if(ts.isParameter(binding))return 'parameter';
 if(ts.isVariableDeclaration(binding))return 'variable';
 if(ts.isBindingElement(binding))return 'binding-element';
 if(ts.isFunctionDeclaration(binding))return 'function';
 return 'other';
}
function calleeFunctionDetails(binding:LocalBinding|undefined):{
 kind:PublicFaultAstEvidence['calleeFunctionKind'];parameters:number;statements:number;
}{
 if(!binding)return {kind:'unresolved',parameters:-1,statements:-1};
 let fn:ts.FunctionDeclaration|ts.FunctionExpression|ts.ArrowFunction|undefined;
 if(ts.isFunctionDeclaration(binding))fn=binding;
 else if(ts.isVariableDeclaration(binding)){
  const init=binding.initializer;
  if(init&&(ts.isFunctionExpression(init)||ts.isArrowFunction(init)))fn=init;
 }
 if(!fn)return {kind:'other',parameters:-1,statements:-1};
 const parameters=fn.parameters.length<=32?fn.parameters.length:-1;
 if(ts.isFunctionDeclaration(fn))
  return {kind:'function-declaration',parameters,statements:fn.body&&fn.body.statements.length<=128?fn.body.statements.length:-1};
 if(ts.isFunctionExpression(fn))
  return {kind:'function-expression',parameters,statements:fn.body.statements.length<=128?fn.body.statements.length:-1};
 if(ts.isBlock(fn.body))
  return {kind:'arrow-block',parameters,statements:fn.body.statements.length<=128?fn.body.statements.length:-1};
 return {kind:'arrow-expression',parameters,statements:0};
}

function calleeBodyNode(binding:LocalBinding|undefined):ts.ConciseBody|undefined{
 if(!binding)return undefined;
 if(ts.isFunctionDeclaration(binding)||ts.isFunctionExpression(binding))return binding.body;
 if(ts.isVariableDeclaration(binding)){
  const init=binding.initializer;
  if(init&&(ts.isFunctionExpression(init)||ts.isArrowFunction(init)))return init.body;
 }
 return undefined;
}
function bodyBinaryOperators(body:ts.Node|undefined):readonly string[]{
 if(!body)return Object.freeze([]);
 const result:string[]=[];
 const visit=(current:ts.Node):void=>{
  if(result.length>=4)return;
  if(ts.isBinaryExpression(current))result.push(stableBinaryOperatorKind(current.operatorToken.kind));
  ts.forEachChild(current,visit);
 };
 visit(body);
 return Object.freeze(result);
}
function variableInitializerKind(binding:LocalBinding|undefined):string{
 if(!binding||!ts.isVariableDeclaration(binding)||!binding.initializer)return 'unavailable';
 const kind=ts.SyntaxKind[binding.initializer.kind]||'unknown';
 return typeof kind==='string'&&kind.length<64?kind:'unknown';
}

function sameIdentifier(node:ts.Node|undefined,name:string):boolean{
 return !!node&&ts.isIdentifier(node)&&node.text===name;
}
function classifyFixedUpstreamShape(
 file:ts.SourceFile,call:ts.CallExpression|undefined,
 calleeBinding:LocalBinding|undefined,elementBaseBinding:LocalBinding|undefined,
):PublicFaultAstEvidence['fixedUpstreamShape']{
 if(!call||!ts.isIdentifier(call.expression)||call.arguments.length!==2||
    !ts.isVariableDeclaration(calleeBinding)||!ts.isArrowFunction(calleeBinding.initializer)||
    calleeBinding.initializer.parameters.length!==2||
    !ts.isArrowFunction(calleeBinding.initializer.body)||
    !ts.isVariableDeclaration(elementBaseBinding)||elementBaseBinding.initializer)
  return 'other';
 const first=call.arguments[0];
 const second=call.arguments[1];
 if(!ts.isIdentifier(first)||!ts.isElementAccessExpression(second)||
    !ts.isIdentifier(second.expression)||second.expression.text!==first.text||
    !ts.isIdentifier(second.argumentExpression))
  return 'other';
 const base=first.text;
 const index=second.argumentExpression.text;
 let assignment:ts.BinaryExpression|undefined;
 for(let current:ts.Node|undefined=call;current;current=current.parent){
  if(ts.isBinaryExpression(current)&&current.operatorToken.kind===ts.SyntaxKind.EqualsToken&&
     current.right===call){assignment=current;break;}
 }
 if(!assignment||!ts.isElementAccessExpression(assignment.left)||
    !sameIdentifier(assignment.left.expression,base)||
    !sameIdentifier(assignment.left.argumentExpression,index))
  return 'other';
 let prior=false;
 let latest=-1;
 const before=assignment.getStart(file);
 const visit=(current:ts.Node):void=>{
  const start=current.getStart(file);
  if(start>=before)return;
  if(ts.isBinaryExpression(current)&&current.operatorToken.kind===ts.SyntaxKind.EqualsToken&&
     sameIdentifier(current.left,base)&&ts.isPropertyAccessExpression(current.right)&&
     current.right.name.text==='onMessage'&&start>latest){
    prior=true;latest=start;
  }
  ts.forEachChild(current,visit);
 };
 visit(file);
 return prior?'mv3-runtime-onmessage-listener-wrapper':'other';
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
  const callArgumentCount=call&&call.arguments.length<=32?call.arguments.length:-1;
  let element:ts.ElementAccessExpression|undefined;
  for(let current:ts.Node|undefined=node;current;current=current.parent){
   if(ts.isElementAccessExpression(current)){element=current;break;}
   if(call&&current===call)break;
  }
  const elementBaseKind=element?(ts.SyntaxKind[element.expression.kind]||'unknown'):'unavailable';
  const elementBaseBinding=element&&ts.isIdentifier(element.expression)
   ?findLocalBinding(file,element.expression.text,element.getStart(file)):undefined;
  const elementBaseBindingKind=element&&ts.isIdentifier(element.expression)
   ?localBindingKind(elementBaseBinding):'other';
  const index=element?.argumentExpression;
  const elementIndexKind:PublicFaultAstEvidence['elementIndexKind']=!index?'other':
   ts.isNumericLiteral(index)?index.text==='0'?'number-0':index.text==='1'?'number-1':'number-other':
   ts.isIdentifier(index)?'identifier':ts.isStringLiteral(index)?'string':'other';
  const fn=calleeFunctionDetails(calleeBinding);
  const body=calleeBodyNode(calleeBinding);
  const calleeBodyKind=body?(ts.SyntaxKind[body.kind]||'unknown'):'unavailable';
  const calleeBodyBinaryOperatorKinds=bodyBinaryOperators(body);
  const callArgumentKinds=Object.freeze((call?.arguments||[]).slice(0,8).map(argument=>{
   const kind=ts.SyntaxKind[argument.kind]||'unknown';
   return typeof kind==='string'&&kind.length<64?kind:'unknown';
  }));
  const first=call?.arguments[0];
  const firstArgumentLiteralKind=first&&ts.isStringLiteral(first)&&allowedFirstArgumentLiterals.has(first.text)
   ?first.text:'other';
  const elementBaseInitializerKind=variableInitializerKind(elementBaseBinding);
  const fixedUpstreamShape=classifyFixedUpstreamShape(
   file,call,calleeBinding,elementBaseBinding);
  const binaryOperatorKinds:string[]=[];
  const binaryOperandRoles:('left'|'right'|'other')[]=[];
  for(let current:ts.Node|undefined=node;current&&binaryOperatorKinds.length<4;current=current.parent){
   if(!ts.isBinaryExpression(current))continue;
   binaryOperatorKinds.push(stableBinaryOperatorKind(current.operatorToken.kind));
   binaryOperandRoles.push(current.left.getStart(file)<=position&&position<current.left.getEnd()
    ?'left':current.right.getStart(file)<=position&&position<current.right.getEnd()?'right':'other');
  }
  return Object.freeze({
   locationVerified:true,
   syntaxKind:ts.SyntaxKind[node.kind]||'unknown',
   callKind,propertyKind,expressionRole,callArgumentIndex,
   ancestorKinds:Object.freeze(ancestorKinds),calleeBindingKind,boundMethodKind,
   callArgumentCount,elementBaseKind,elementBaseBindingKind,elementIndexKind,
   calleeFunctionKind:fn.kind,calleeParameterCount:fn.parameters,calleeStatementCount:fn.statements,
   binaryOperatorKinds:Object.freeze(binaryOperatorKinds),
   binaryOperandRoles:Object.freeze(binaryOperandRoles),
   callArgumentKinds,firstArgumentLiteralKind,
   calleeBodyKind:typeof calleeBodyKind==='string'&&calleeBodyKind.length<64?calleeBodyKind:'unknown',
   calleeBodyBinaryOperatorKinds,elementBaseInitializerKind,fixedUpstreamShape,
   fingerprintSha256:createHash('sha256').update(source,'utf8').digest('hex'),
  });
 }catch{
  return unavailable();
 }
}
