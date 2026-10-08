import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {lstat,readFile,mkdir,writeFile,stat} from 'node:fs/promises';
import ts from 'typescript';
import {ensureWritableDataRoot} from '../../runtime-paths/src/index.ts';

export interface SelectorLocation {readonly method:string;readonly line:number;readonly column:number}
export interface LiteralPatchDraft {
 baseHash:string;proposedHash:string;oldSelector:string;newSelector:string;
 proposedSource:string;sourceRange:{start:number;end:number};
}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function proposeLiteralPatch({sourceBytes,oldSelector,newSelector,selectorLocation}:{sourceBytes:Uint8Array;oldSelector:string;newSelector:string;selectorLocation?:SelectorLocation|undefined}):LiteralPatchDraft{
 if(!oldSelector||!newSelector||newSelector.length>1024)throw new Error('Selectors must be nonempty and short');
 const hasBom=sourceBytes[0]===239&&sourceBytes[1]===187&&sourceBytes[2]===191;
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);}
 catch{throw new Error('Source encoding is not valid UTF-8; refusing patch');}
 const file=ts.createSourceFile('script.user.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const matches:ts.StringLiteralLike[]=[];
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.name)&&['querySelector','querySelectorAll','closest','matches','getElementById'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])&&node.arguments[0].text===oldSelector){
   const pos=file.getLineAndCharacterOfPosition(node.getStart(file));
   if(!selectorLocation||(selectorLocation.method===node.expression.name.text&&selectorLocation.line===pos.line+1&&selectorLocation.column===pos.character+1))
    matches.push(node.arguments[0]);
  }
  ts.forEachChild(node,visit);
 }
 visit(file);
 if(matches.length!==1)throw new Error('Expected exactly one static literal selector match');
 const literal=matches[0]!;const start=literal.getStart(file),end=literal.getEnd();
 const quoted=JSON.stringify(newSelector);const changed=text.slice(0,start)+quoted+text.slice(end);
 const proposedBytes=new TextEncoder().encode(changed);const outputBytes=hasBom?new Uint8Array([239,187,191,...proposedBytes]):proposedBytes;
 return {baseHash:sha(sourceBytes),proposedHash:sha(outputBytes),oldSelector,newSelector,proposedSource:(hasBom?'\ufeff':'')+changed,sourceRange:{start,end}};
}
export async function applyManagedPatch({sourcePath,managedRoot,scriptId,draft,expectedHash,approved}:{sourcePath:string;managedRoot:string;scriptId:string;draft:LiteralPatchDraft;expectedHash:string;approved:boolean}):Promise<{backupPath:string;managedPath:string;hash:string}>{
 if(!approved)throw new Error('Explicit user approval required');
 if(!/^[a-z0-9_-]{1,64}$/i.test(scriptId))throw new Error('Unsafe scriptId');
 if(!isAbsolute(sourcePath)||!isAbsolute(managedRoot))throw new Error('Absolute source and managed paths required');
 const sourceInfo=await lstat(sourcePath);if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink())throw new Error('Source must be a regular file');
 const current=await readFile(sourcePath);
 if(sha(current)!==expectedHash||draft.baseHash!==expectedHash)throw new Error('Source hash mismatch: stale patch or external edit');
 const proposedBytes=new TextEncoder().encode(draft.proposedSource);
 if(sha(proposedBytes)!==draft.proposedHash)throw new Error('Candidate patch hash mismatch');
 const folder=join(managedRoot,'managed',scriptId);await ensureWritableDataRoot(folder);
 const backupPath=join(folder,`original-${expectedHash}.user.js`),managedPath=join(folder,`revision-${draft.proposedHash}.user.js`);
 async function writeImmutable(path:string,content:Uint8Array){
  try{await writeFile(path,content,{flag:'wx',mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
   const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw new Error('Immutable revision path is not a regular file');
   const existing=await readFile(path);if(sha(existing)!==sha(content))throw new Error('Immutable revision hash conflict');}
 }
 await writeImmutable(backupPath,current);await writeImmutable(managedPath,proposedBytes);
 return {backupPath,managedPath,hash:draft.proposedHash};
}
