import {createHash} from 'node:crypto';
import ts from 'typescript';

export interface Position {line:number;column:number}
export interface SourceRange {start:Position;end:Position}
export type DynamicKind='literal'|'template-dynamic'|'concat-dynamic'|'wrapper-unknown';
export interface SelectorRecord {
  scriptId:string; expression:string; method:string;sourceRange:SourceRange;
  functionName:string|null;scope:string[];alternateSelectors:string[];receiver:string;
  dynamicKind:DynamicKind;runtimeRequired:boolean;
}
export interface MetadataParseResult {name:string|null;match:string[];include:string[];grant:string[];runAt:string|null;raw:Record<string,string[]>}
export interface ManagerApiCall {
 /** Static syntactic reference, NOT proof that the real manager injected APIs. */
 readonly api:string;
 readonly line:number;
 readonly column:number;
 readonly grantStatus:'declared'|'missing'|'unknown';
 readonly evidenceLevel:'static-only';
 readonly managerVerified:false;
}
export interface SourceAnalysis {
 scriptId:string;sourceSha256:string;metadata:MetadataParseResult;selectorRecords:SelectorRecord[];
 managerApiCalls:ManagerApiCall[];
 parseDiagnostics:string[]; encoding:'utf-8'|'utf-8-bom'|'invalid';lineEnding:'crlf'|'lf'|'mixed'|'none';
}
export function parseUserscriptMetadata(source:string):MetadataParseResult {
 const lines=source.split(/\r?\n/);
 // A metadata opener appearing after real JavaScript (including a template)
 // is not an activation header. Inspect only a bounded, comment-only prefix.
 let start=-1;
 for(let i=0;i<lines.length&&i<128;i++){
  const line=lines[i]!;
  if(/^\s*\/\/\s*==UserScript==\s*$/.test(line)){start=i;break;}
  if(!line.trim()||/^\s*\/\//.test(line))continue;
  break;
 }
 // Metadata keys are untrusted; inherited names such as __proto__/constructor
 // must never select Object.prototype methods or setters.
 const raw:Record<string,string[]>=Object.create(null) as Record<string,string[]>;
 let closed=false;
 if(start>=0)for(let i=start+1;i<lines.length;i++){
   const line=lines[i]!;
   if(/^\s*\/\/\s*==\/UserScript==\s*$/.test(line)){closed=true;break;}
   if(!line.trim())continue;
   // A blank line is legal in metadata; executable content is not metadata.
   if(!/^\s*\/\//.test(line))break;
   const m=line.match(/^\s*\/\/\s*@([\w-]+)\s*(.*?)\s*$/);if(m&&m[1]) (raw[m[1]]??=[]).push(m[2]??'');
 }
 // Unclosed or forged marker blocks script activation; preserve separate AST
 // analysis so users can still diagnose a malformed script without authorizing CDP.
 const validated=closed?raw:Object.create(null) as Record<string,string[]>;
 return {name:validated.name?.[0]??null,match:validated.match??[],include:validated.include??[],grant:validated.grant??[],runAt:validated['run-at']?.[0]??null,raw:validated};
}
const METHODS=new Set(['querySelector','querySelectorAll','getElementById','getElementsByClassName','getElementsByName','closest','matches']);
function selectorOf(node:ts.Expression):{expression:string;dynamicKind:DynamicKind}{
 if(ts.isStringLiteralLike(node)&&!ts.isTemplateExpression(node)) return {expression:node.text,dynamicKind:'literal'};
 if(ts.isNoSubstitutionTemplateLiteral(node))return {expression:node.text,dynamicKind:'literal'};
 if(ts.isTemplateExpression(node))return {expression:node.getText(),dynamicKind:'template-dynamic'};
 if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.PlusToken)return {expression:node.getText(),dynamicKind:'concat-dynamic'};
 return {expression:node.getText(),dynamicKind:'wrapper-unknown'};
}
function functionScope(node:ts.Node):{name:string|null;scope:string[]}{
 const scope:string[]=[];
 for(let parent=node.parent;parent;parent=parent.parent){
   if(ts.isFunctionDeclaration(parent)&&parent.name)scope.unshift(parent.name.text);
   else if(ts.isMethodDeclaration(parent)&&parent.name)scope.unshift(parent.name.getText());
   else if(ts.isArrowFunction(parent)&&parent.parent&&ts.isVariableDeclaration(parent.parent)&&ts.isIdentifier(parent.parent.name))scope.unshift(parent.parent.name.text);
 }
 return {name:scope.at(-1)??null,scope};
}
function getAlternates(node:ts.CallExpression):string[]{
 const parent=node.parent;
 if(ts.isBinaryExpression(parent)&&parent.operatorToken.kind===ts.SyntaxKind.BarBarToken){
   const alternative=parent.left===node?parent.right:parent.left;
   if(ts.isCallExpression(alternative)&&alternative.arguments[0])return [selectorOf(alternative.arguments[0]).expression];
 }
 return [];
}
export function analyzeSource({scriptId,sourceBytes}:{scriptId:string;sourceBytes:Uint8Array}):SourceAnalysis{
 const sourceSha256=createHash('sha256').update(sourceBytes).digest('hex');
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);}
 catch{
  // Never turn corrupt user scripts into a successful AST scan with replacement
  // characters. The original byte hash remains available for diagnostics.
  return {scriptId,sourceSha256,metadata:parseUserscriptMetadata(''),
   selectorRecords:[],managerApiCalls:[],parseDiagnostics:['Invalid UTF-8 source encoding'],
   encoding:'invalid',lineEnding:'none'};
 }
 const source=ts.createSourceFile(`${scriptId}.user.js`,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const selectorRecords:SelectorRecord[]=[];
 const managerApiCalls:ManagerApiCall[]=[];
 const metadata=parseUserscriptMetadata(text);
 const grants=new Set(metadata.grant.map(x=>x.trim()));
 // A local binding named GM or GM_getValue is not a Tampermonkey API.
 // Build the lexical binding map before collecting calls, so hoisted var
 // and declarations encountered AFTER a call still mask the name.
 const localBindings=new Map<ts.Node,Set<string>>();
 const addBinding=(owner:ts.Node,name:string)=>{
  const local=localBindings.get(owner)??new Set<string>();
  local.add(name);localBindings.set(owner,local);
 };
 const collectNames=(name:ts.BindingName,owner:ts.Node):void=>{
  if(ts.isIdentifier(name)){addBinding(owner,name.text);return;}
  for(const member of name.elements)if(ts.isBindingElement(member))
   collectNames(member.name,owner);
 };
 const isFunctionScope=(node:ts.Node):boolean=>ts.isSourceFile(node)||
  ts.isFunctionDeclaration(node)||ts.isFunctionExpression(node)||
  ts.isArrowFunction(node)||ts.isMethodDeclaration(node)||
  ts.isConstructorDeclaration(node)||ts.isGetAccessorDeclaration(node)||
  ts.isSetAccessorDeclaration(node);
 const isLexicalScope=(node:ts.Node):boolean=>isFunctionScope(node)||
  ts.isBlock(node)||ts.isCaseBlock(node)||ts.isCatchClause(node)||
  ts.isForStatement(node)||ts.isForInStatement(node)||ts.isForOfStatement(node);
 const ownerOf=(from:ts.Node,scope:'function'|'lexical'):ts.Node=>{
  for(let parent=from.parent;parent;parent=parent.parent)
   if(scope==='function'?isFunctionScope(parent):isLexicalScope(parent))
    return parent;
  return source;
 };
 const collectBindings=(node:ts.Node):void=>{
  if(ts.isVariableDeclaration(node)&&!ts.isCatchClause(node.parent)){
   // A catch parameter is scoped ONLY to its catch clause, not a hoisted
   // function-level var. CatchClause below records that distinct binding.
   const list=node.parent;
   const isBlockScoped=ts.isVariableDeclarationList(list)&&
    (list.flags&(ts.NodeFlags.Let|ts.NodeFlags.Const))!==0;
   collectNames(node.name,ownerOf(node,isBlockScoped?'lexical':'function'));
  }else if(ts.isParameter(node)){
   collectNames(node.name,ownerOf(node,'function'));
  }else if(ts.isCatchClause(node)&&node.variableDeclaration){
   collectNames(node.variableDeclaration.name,node);
  }else if(ts.isFunctionDeclaration(node)&&node.name){
   addBinding(ownerOf(node,'lexical'),node.name.text);
   addBinding(node,node.name.text);
  }else if(ts.isFunctionExpression(node)&&node.name){
   // A named function expression binds its name inside itself ONLY.
   addBinding(node,node.name.text);
  }else if((ts.isClassDeclaration(node)||ts.isEnumDeclaration(node))&&node.name){
   addBinding(ownerOf(node,'lexical'),node.name.text);
  }else if(ts.isClassExpression(node)&&node.name){
   addBinding(node,node.name.text);
  }else if(ts.isImportClause(node)&&node.name){
   addBinding(source,node.name.text);
  }else if(ts.isImportSpecifier(node)||ts.isNamespaceImport(node)||
            ts.isImportEqualsDeclaration(node)){
   addBinding(source,node.name.text);
  }
  ts.forEachChild(node,collectBindings);
 };
 collectBindings(source);
 const isLocallyBound=(node:ts.Node,name:string):boolean=>{
  for(let parent:ts.Node|undefined=node;parent;parent=parent.parent)
   if(localBindings.get(parent)?.has(name))return true;
  return false;
 };
 function collectManagerApi(node:ts.CallExpression):void{
  const callee=node.expression;
  let api:string|null=null;
  if(ts.isIdentifier(callee)&&/^GM_[A-Za-z][A-Za-z0-9_]{0,79}$/.test(callee.text))
   api=callee.text;
  else if(ts.isPropertyAccessExpression(callee)&&
      ts.isIdentifier(callee.expression)&&callee.expression.text==='GM'&&
      /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(callee.name.text))
   api='GM.'+callee.name.text;
  else if(ts.isElementAccessExpression(callee)&&
      ts.isIdentifier(callee.expression)&&callee.expression.text==='GM'){
   const key=callee.argumentExpression;
   api=key&&ts.isStringLiteralLike(key)&&/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(key.text)?
    'GM.'+key.text:'GM.<dynamic>';
  }
  if(!api)return;
  // Local variables/imports/functions with the same name are not proof of a
  // call into the privileged userscript manager. Do not manufacture V4 risk
  // rows from unrelated user code.
  if(isLocallyBound(node,api.startsWith('GM.')?'GM':api))return;
  const pos=source.getLineAndCharacterOfPosition(node.getStart(source));
  managerApiCalls.push({api,line:pos.line+1,column:pos.character+1,
   grantStatus:api==='GM.<dynamic>'?'unknown':grants.has(api)?'declared':'missing',
   evidenceLevel:'static-only',managerVerified:false});
 }
 function walk(node:ts.Node):void{
   if(ts.isCallExpression(node))collectManagerApi(node);
   if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&METHODS.has(node.expression.name.text)&&node.arguments[0]){
     const selector=selectorOf(node.arguments[0]);const start=source.getLineAndCharacterOfPosition(node.getStart(source));const end=source.getLineAndCharacterOfPosition(node.getEnd());
     const scope=functionScope(node);
     selectorRecords.push({scriptId,expression:selector.expression,method:node.expression.name.text,
       sourceRange:{start:{line:start.line+1,column:start.character+1},end:{line:end.line+1,column:end.character+1}},
       functionName:scope.name,scope:scope.scope,alternateSelectors:getAlternates(node),receiver:node.expression.expression.getText(source),
       dynamicKind:selector.dynamicKind,runtimeRequired:selector.dynamicKind!=='literal'});
   }
   if(ts.isCallExpression(node)&&ts.isElementAccessExpression(node.expression)&&node.arguments[0]){
     const accessor=node.expression;
     const key=accessor.argumentExpression;
     const resolvedMethod=key&&ts.isStringLiteralLike(key)&&METHODS.has(key.text)?key.text:null;
     // Unknown computed keys on *document* may be DOM calls. For arbitrary
     // receivers, do not invent a selector from an unrelated dynamic method.
     const isDocumentKey=ts.isIdentifier(accessor.expression)&&accessor.expression.text==='document';
     if(resolvedMethod||isDocumentKey){
       const selector=selectorOf(node.arguments[0]);
       const start=source.getLineAndCharacterOfPosition(node.getStart(source));
       const end=source.getLineAndCharacterOfPosition(node.getEnd());
       const scope=functionScope(node);
       selectorRecords.push({scriptId,expression:selector.expression,method:resolvedMethod??'<computed>',
        sourceRange:{start:{line:start.line+1,column:start.character+1},end:{line:end.line+1,column:end.character+1}},
        functionName:scope.name,scope:scope.scope,alternateSelectors:[],
        receiver:accessor.expression.getText(source),dynamicKind:'wrapper-unknown',runtimeRequired:true});
     }
   }
   ts.forEachChild(node,walk);
 }
 walk(source);
 const diagnostics=((source as ts.SourceFile & {parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics??[]).map(d=>ts.flattenDiagnosticMessageText(d.messageText,' '));
 const crlf=(text.match(/\r\n/g)??[]).length;const lf=(text.match(/(?<!\r)\n/g)??[]).length;
 return {scriptId,sourceSha256,metadata,selectorRecords,managerApiCalls,
   parseDiagnostics:diagnostics,encoding:sourceBytes[0]===239&&sourceBytes[1]===187&&sourceBytes[2]===191?'utf-8-bom':'utf-8',
   lineEnding:crlf&&lf?'mixed':crlf?'crlf':lf?'lf':'none'};
}
