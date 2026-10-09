import {createHash} from 'node:crypto';
import {join,isAbsolute} from 'node:path';
import {lstat} from 'node:fs/promises';
import {persistImmutableSnapshot} from './immutable-archive.ts';
import ts from 'typescript';
import {ensureWritableDataRoot} from '../../runtime-paths/src/index.ts';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';

export interface SelectorLocation {readonly method:string;readonly line:number;readonly column:number}
export interface LiteralPatchDraft {
 baseHash:string;proposedHash:string;oldSelector:string;newSelector:string;
 proposedSource:string;sourceRange:{start:number;end:number};
}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
export function proposeLiteralPatch({sourceBytes,oldSelector,newSelector,selectorLocation,expectedSourceRange}:{
 sourceBytes:Uint8Array;oldSelector:string;newSelector:string;
 selectorLocation?:SelectorLocation|undefined;
 /** Internal apply-time check: reconstruct EXACTLY the previously previewed AST literal. */
 expectedSourceRange?:Readonly<{start:number;end:number}>|undefined;
}):LiteralPatchDraft{
 if(typeof oldSelector!=='string'||typeof newSelector!=='string'||!oldSelector||!newSelector||
    oldSelector.length>1024||newSelector.length>1024)
  throw new Error('Selectors must be nonempty and short');
 if(expectedSourceRange&&
   (!Number.isSafeInteger(expectedSourceRange.start)||!Number.isSafeInteger(expectedSourceRange.end)||
    expectedSourceRange.start<0||expectedSourceRange.end<=expectedSourceRange.start))
  throw new Error('Invalid approved selector source range');
 const hasBom=sourceBytes[0]===239&&sourceBytes[1]===187&&sourceBytes[2]===191;
 let text:string;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);}
 catch{throw new Error('Source encoding is not valid UTF-8; refusing patch');}
 const file=ts.createSourceFile('script.user.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 // Parsing can recover and still find a querySelector() call inside broken
 // JavaScript. Reject pre-existing syntax errors instead of showing a patch
 // preview that would mislead the user into thinking the script can execute.
 const parseErrors=(file as ts.SourceFile&{parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics;
 if(parseErrors?.length)throw new Error('Userscript JavaScript syntax is invalid; refusing selector patch');
 const matches:ts.StringLiteralLike[]=[];
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.name)&&['querySelector','querySelectorAll','closest','matches','getElementById','getElementsByName','getElementsByClassName'].includes(node.expression.name.text)&&node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])&&node.arguments[0].text===oldSelector){
   const pos=file.getLineAndCharacterOfPosition(node.getStart(file));
   const literal=node.arguments[0];
   if((!selectorLocation||(selectorLocation.method===node.expression.name.text&&selectorLocation.line===pos.line+1&&selectorLocation.column===pos.character+1))&&
     (!expectedSourceRange||(literal.getStart(file)===expectedSourceRange.start&&literal.getEnd()===expectedSourceRange.end)))
    matches.push(literal);
  }
  ts.forEachChild(node,visit);
 }
 visit(file);
 if(matches.length!==1)throw new Error('Expected exactly one static literal selector match');
 const literal=matches[0]!;const start=literal.getStart(file),end=literal.getEnd();
 const quoted=JSON.stringify(newSelector);const changed=text.slice(0,start)+quoted+text.slice(end);
 const proposedBytes=new TextEncoder().encode(changed);const outputBytes=hasBom?new Uint8Array([239,187,191,...proposedBytes]):proposedBytes;
 if(outputBytes.length>512*1024)throw new Error('Approved patched userscript exceeds file size limit');
 return {baseHash:sha(sourceBytes),proposedHash:sha(outputBytes),oldSelector,newSelector,proposedSource:(hasBom?'\ufeff':'')+changed,sourceRange:{start,end}};
}
export async function applyManagedPatch({sourcePath,managedRoot,scriptId,draft,expectedHash,approved,baseRevisionKind='original'}:{sourcePath:string;managedRoot:string;scriptId:string;draft:LiteralPatchDraft;expectedHash:string;approved:boolean;baseRevisionKind?:'original'|'revision'}):Promise<{backupPath:string;managedPath:string;hash:string}>{
 if(!approved)throw new Error('Explicit user approval required');
 if(!/^[a-z0-9_-]{1,64}$/i.test(scriptId))throw new Error('Unsafe scriptId');
 if(baseRevisionKind!=='original'&&baseRevisionKind!=='revision')
  throw new Error('Invalid base revision kind for immutable archive path');
 if(!isAbsolute(sourcePath)||!isAbsolute(managedRoot))throw new Error('Absolute source and managed paths required');
 const sourceInfo=await lstat(sourcePath);if(!sourceInfo.isFile()||sourceInfo.isSymbolicLink())throw new Error('Source must be a regular file');
 const current=await readPinnedRegularFile(sourcePath,{maxBytes:512*1024,expected:sourceInfo});
 if(sha(current)!==expectedHash||draft.baseHash!==expectedHash)throw new Error('Source hash mismatch: stale patch or external edit');
 // Treat even internally supplied drafts as untrusted at this write boundary.
 // A self-consistent SHA does NOT prove that the draft contains only the
 // single approved AST string-literal replacement. Reconstruct the proposed
 // bytes from the already pinned source and the recorded literal range.
 if(!draft||typeof draft.proposedSource!=='string'||typeof draft.proposedHash!=='string'||
    typeof draft.baseHash!=='string'||!draft.sourceRange)
  throw new Error('Invalid approved patch draft');
 let verifiedDraft:LiteralPatchDraft;
 try{
  verifiedDraft=proposeLiteralPatch({
   sourceBytes:current,oldSelector:draft.oldSelector,newSelector:draft.newSelector,
   expectedSourceRange:draft.sourceRange,
  });
 }catch{
  throw new Error('Approved patch draft cannot be reconstructed at its exact selector location');
 }
 if(verifiedDraft.baseHash!==draft.baseHash||
    verifiedDraft.proposedHash!==draft.proposedHash||
    verifiedDraft.proposedSource!==draft.proposedSource||
    verifiedDraft.sourceRange.start!==draft.sourceRange.start||
    verifiedDraft.sourceRange.end!==draft.sourceRange.end)
  throw new Error('Approved patch draft mismatch: only the reviewed selector literal may change');
 const proposedBytes=new TextEncoder().encode(verifiedDraft.proposedSource);
 if(sha(proposedBytes)!==verifiedDraft.proposedHash)
  throw new Error('Reconstructed approved patch hash mismatch');
 const folder=join(managedRoot,'managed',scriptId);await ensureWritableDataRoot(folder);
 const backupPath=join(folder,`${baseRevisionKind}-${expectedHash}.user.js`),managedPath=join(folder,`revision-${draft.proposedHash}.user.js`);
 // Both the original and the patched revision must be flushed and
 // read-back verified before current.user.js is activated. Failed writes
 // cannot leave a partial, hash-named archive blocking future retries.
 await persistImmutableSnapshot({archivePath:backupPath,bytes:current});
 await persistImmutableSnapshot({archivePath:managedPath,bytes:proposedBytes});
 return {backupPath,managedPath,hash:draft.proposedHash};
}
