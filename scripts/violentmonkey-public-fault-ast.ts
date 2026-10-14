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
export interface PublicFaultAstEvidence {
 readonly locationVerified:boolean;
 readonly syntaxKind:string;
 readonly callKind:'none'|'member-call'|'direct-call'|'other-call';
 readonly propertyKind:string;
 readonly fingerprintSha256:string;
}
const unavailable=():PublicFaultAstEvidence=>Object.freeze({
 locationVerified:false,syntaxKind:'unavailable',callKind:'none',
 propertyKind:'other',fingerprintSha256:'0'.repeat(64),
});

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
  return Object.freeze({
   locationVerified:true,
   syntaxKind:ts.SyntaxKind[node.kind]||'unknown',
   callKind,propertyKind,
   fingerprintSha256:createHash('sha256').update(source,'utf8').digest('hex'),
  });
 }catch{
  return unavailable();
 }
}
