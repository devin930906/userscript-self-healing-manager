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
 if(oldSelector===newSelector)throw new Error('Unchanged selector cannot create an approved repair revision');
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


/**
 * Draft 2–8 independently identified AST selector literal replacements as
 * ONE all-or-nothing, in-memory edit. Never execute or write a userscript.
 *
 * Every call is pinned to its original AST call start and optionally the
 * exact reviewed literal byte range. Changing string lengths cannot shift
 * subsequent call identities because edits are applied right-to-left.
 */
export interface BatchSelectorChange {
 readonly oldSelector:string;
 readonly newSelector:string;
 readonly selectorLocation:SelectorLocation;
 readonly expectedSourceRange?:Readonly<{start:number;end:number}>|undefined;
}
export interface BatchLiteralPatchDraft {
 readonly baseHash:string;
 readonly proposedHash:string;
 readonly proposedSource:string;
 readonly changes:readonly {
  readonly oldSelector:string;
  readonly newSelector:string;
  readonly sourceRange:{readonly start:number;readonly end:number};
 }[];
}
export function proposeLiteralPatchBatch({
 sourceBytes,changes,
}:{
 sourceBytes:Uint8Array;
 changes:readonly BatchSelectorChange[];
}):BatchLiteralPatchDraft{
 if(!(sourceBytes instanceof Uint8Array)||sourceBytes.byteLength>512*1024)
  throw new Error('Invalid batch source size or bytes');
 if(!Array.isArray(changes)||changes.length<2||changes.length>8)
  throw new Error('Batch requires between 2 and 8 selector changes');
 const hasBom=sourceBytes[0]===239&&sourceBytes[1]===187&&sourceBytes[2]===191;
 let original:string;
 try{original=new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);}
 catch{throw new Error('Batch source is not valid UTF-8');}
 const file=ts.createSourceFile('script.user.js',original,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const parseErrors=(file as ts.SourceFile&{parseDiagnostics?:readonly ts.Diagnostic[]}).parseDiagnostics;
 if(parseErrors?.length)throw new Error('Cannot draft batch patch from JavaScript syntax errors');
 const literals:ts.StringLiteralLike[]=[];
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
     ['querySelector','querySelectorAll','closest','matches','getElementById',
      'getElementsByName','getElementsByClassName'].includes(node.expression.name.text)&&
     node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))
   literals.push(node.arguments[0]);
  ts.forEachChild(node,visit);
 }
 visit(file);
 const selected:{
  oldSelector:string;newSelector:string;sourceRange:{start:number;end:number};
 }[]=[];
 const seen=new Set<number>();
 for(const change of changes){
  if(!change||typeof change.oldSelector!=='string'||typeof change.newSelector!=='string'||
     !change.oldSelector||!change.newSelector||
     change.oldSelector===change.newSelector||
     change.oldSelector.length>1024||change.newSelector.length>1024)
   throw new Error('Invalid or unchanged batch selector');
  const loc=change.selectorLocation;
  if(!loc||!['querySelector','querySelectorAll','closest','matches','getElementById',
     'getElementsByName','getElementsByClassName'].includes(loc.method)||
     !Number.isSafeInteger(loc.line)||loc.line<1||
     !Number.isSafeInteger(loc.column)||loc.column<1)
   throw new Error('Invalid batch selector AST location');
  const exact=change.expectedSourceRange;
  if(exact&&(!Number.isSafeInteger(exact.start)||!Number.isSafeInteger(exact.end)||
     exact.start<0||exact.end<=exact.start))
   throw new Error('Invalid pinned batch source range');
  const matches=literals.filter(literal=>{
   if(literal.text!==change.oldSelector)return false;
   const call=literal.parent;
   if(!ts.isCallExpression(call)||!ts.isPropertyAccessExpression(call.expression)||
      call.expression.name.text!==loc.method)return false;
   const pos=file.getLineAndCharacterOfPosition(call.getStart(file));
   return pos.line+1===loc.line&&pos.character+1===loc.column&&
    (!exact||(literal.getStart(file)===exact.start&&literal.getEnd()===exact.end));
  });
  if(matches.length!==1)
   throw new Error('Expected exactly one pinned AST selector for each batch change');
  const literal=matches[0]!,start=literal.getStart(file),end=literal.getEnd();
  if(seen.has(start))throw new Error('Duplicate batch AST selector target');
  seen.add(start);
  selected.push({
   oldSelector:change.oldSelector,newSelector:change.newSelector,
   sourceRange:{start,end},
  });
 }
 const descending=[...selected].sort((a,b)=>b.sourceRange.start-a.sourceRange.start);
 let changed=original;
 let previousStart=original.length+1;
 for(const entry of descending){
  if(entry.sourceRange.end>previousStart)
   throw new Error('Overlapping batch selector ranges');
  changed=changed.slice(0,entry.sourceRange.start)+
   JSON.stringify(entry.newSelector)+changed.slice(entry.sourceRange.end);
  previousStart=entry.sourceRange.start;
 }
 const proposedSource=(hasBom?'\ufeff':'')+changed;
 const outputBytes=new TextEncoder().encode(proposedSource);
 if(outputBytes.byteLength>512*1024)
  throw new Error('Batch patched script exceeds safe size');
 return {baseHash:sha(sourceBytes),proposedHash:sha(outputBytes),
  proposedSource,changes:selected};
}


/**
 * Store a single verified all-or-nothing batch revision as immutable snapshots.
 * Does not update current.user.js: approval + compare-and-swap activation must
 * happen in a separate trusted repair-workflow transaction.
 */
export async function applyManagedPatchBatch({
 sourcePath,managedRoot,scriptId,draft,expectedHash,approved,baseRevisionKind='original',
}:{
 sourcePath:string;managedRoot:string;scriptId:string;
 draft:BatchLiteralPatchDraft;expectedHash:string;approved:boolean;
 baseRevisionKind?:'original'|'revision';
}):Promise<{backupPath:string;managedPath:string;hash:string}>{
 if(approved!==true)throw new Error('Explicit batch repair approval required');
 if(typeof scriptId!=='string'||!/^[a-z0-9_-]{1,64}$/i.test(scriptId)||
    !isAbsolute(sourcePath)||!isAbsolute(managedRoot))
  throw new Error('Unsafe batch script ID or filesystem paths');
 if(baseRevisionKind!=='original'&&baseRevisionKind!=='revision')
  throw new Error('Unsafe batch predecessor kind');
 if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash)||
    !draft||typeof draft!=='object'||
    draft.baseHash!==expectedHash||!/^[a-f0-9]{64}$/.test(draft.proposedHash)||
    typeof draft.proposedSource!=='string'||
    !Array.isArray(draft.changes)||draft.changes.length<2||draft.changes.length>8)
  throw new Error('Invalid approved batch draft');
 const meta=await lstat(sourcePath);
 if(!meta.isFile()||meta.isSymbolicLink()||meta.size>512*1024)
  throw new Error('Batch source must be a small regular file');
 const current=await readPinnedRegularFile(sourcePath,{maxBytes:512*1024,expected:meta});
 if(sha(current)!==expectedHash)
  throw new Error('Batch source hash mismatch after review: stale or external edit');
 // Never trust internally supplied source strings or SHA: rebuild from pinned
 // original bytes using *only* the previously reviewed AST literal spans.
 const replay=proposeLiteralPatchBatch({
  sourceBytes:current,
  changes:draft.changes.map(x=>({
   oldSelector:x.oldSelector,newSelector:x.newSelector,
   selectorLocation:deriveExactBatchCallLocation(current,x),
   expectedSourceRange:x.sourceRange,
  })),
 });
 if(replay.baseHash!==draft.baseHash||replay.proposedHash!==draft.proposedHash||
    replay.proposedSource!==draft.proposedSource||
    JSON.stringify(replay.changes)!==JSON.stringify(draft.changes))
  throw new Error('Batch approved draft mismatch at immutable write boundary');
 const bytes=new TextEncoder().encode(replay.proposedSource);
 if(sha(bytes)!==replay.proposedHash)
  throw new Error('Reconstructed batch patch checksum mismatch');
 const folder=join(managedRoot,'managed',scriptId);
 await ensureWritableDataRoot(folder);
 const backupPath=join(folder,baseRevisionKind+'-'+expectedHash+'.user.js');
 const managedPath=join(folder,'revision-'+draft.proposedHash+'.user.js');
 await persistImmutableSnapshot({archivePath:backupPath,bytes:current});
 await persistImmutableSnapshot({archivePath:managedPath,bytes});
 return {backupPath,managedPath,hash:replay.proposedHash};
}
/** Locate the *call*, not arbitrary text, containing a pinned reviewed range. */
function deriveExactBatchCallLocation(sourceBytes:Uint8Array,entry:{
 sourceRange:{start:number;end:number};oldSelector:string;
}):SelectorLocation{
 const text=new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes);
 const file=ts.createSourceFile('script.user.js',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const matches:SelectorLocation[]=[];
 function visit(node:ts.Node):void{
  if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
     node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0])){
   const literal=node.arguments[0];
   if(literal.getStart(file)===entry.sourceRange.start&&
      literal.getEnd()===entry.sourceRange.end&&literal.text===entry.oldSelector){
    const pos=file.getLineAndCharacterOfPosition(node.getStart(file));
    matches.push({method:node.expression.name.text,line:pos.line+1,column:pos.character+1});
   }
  }
  ts.forEachChild(node,visit);
 }
 visit(file);
 if(matches.length!==1)
  throw new Error('Cannot reconstruct exact reviewed batch selector call');
 return matches[0]!;
}
