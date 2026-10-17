import {lstat} from 'node:fs/promises';
import {join,isAbsolute} from 'node:path';
import {readPinnedRegularFile} from '../../runtime-paths/src/pinned-file.ts';
import {listManagedRevisions,type ManagedRevision} from './history.ts';

const HASH=/^[a-f0-9]{64}$/;
const LIMIT=1900;
const LINE_LIMIT=140;
const ROW_LIMIT=12;
const TRUNCATED='\n…（差异预览已截断，未展示完整文件；请勿仅凭片段推断其余内容）';

/** Only printable, bounded text is permitted in a native confirmation.
 * Never put source bytes in logs, diagnostics, IPC, SQLite or reports. */
function printable(line:string):string{
 const clipped=line.length>LINE_LIMIT;
 const display=clipped?line.slice(0,LINE_LIMIT):line;
 const escaped=display.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/g,
  c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
 return escaped+(clipped?'…（单行省略）':'');
}
function textLines(bytes:Uint8Array):string[]{
 // A malformed or unrecognized encoding is NOT a trustworthy code diff.
 const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 return source.split(/\r\n|\n|\r/);
}
async function readArchive(managedRoot:string,scriptId:string,entry:ManagedRevision):Promise<string[]>{
 const path=join(managedRoot,'managed',scriptId,entry.fileName);
 const stat=await lstat(path);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)
  throw new Error('Unsafe managed rollback archive alias');
 const bytes=await readPinnedRegularFile(path,{maxBytes:512*1024,
  expected:stat,expectedNative:await lstat(path,{bigint:true}),expectedSha256:entry.hash});
 if((await lstat(path)).nlink!==1)
  throw new Error('Unsafe managed rollback archive hardlink after pinned read');
 return textLines(bytes);
}
/** Read-only local FR-028 diff for the native approval dialog.
 * Only SHA-verified immutable archives are read. A missing current is labeled
 * as recovery, never misrepresented as a verified old source. This snapshot
 * is informational; native approval is bound to a separate commit-time CAS.
 */
export async function buildManagedRollbackDiff({managedRoot,scriptId,currentHash,targetHash}:{
 managedRoot:string;scriptId:string;currentHash:string|null;targetHash:string;
}):Promise<string>{
 if(typeof managedRoot!=='string'||!isAbsolute(managedRoot)||
    typeof scriptId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(scriptId)||
    typeof targetHash!=='string'||!HASH.test(targetHash)||
    (currentHash!==null&&(typeof currentHash!=='string'||!HASH.test(currentHash))))
  throw new Error('Invalid managed rollback diff request');
 const revisions=await listManagedRevisions({managedRoot,scriptId});
 const selected=revisions.find(r=>r.hash===targetHash);
 if(!selected)throw new Error('Selected managed rollback revision archive not found');
 const previous=currentHash===null?null:revisions.find(r=>r.hash===currentHash);
 if(currentHash!==null&&!previous)
  throw new Error('Current managed revision archive not found');
 const next=textLinesFrom(await readArchive(managedRoot,scriptId,selected));
 const old=previous?textLinesFrom(await readArchive(managedRoot,scriptId,previous)):null;
 let headline:string;
 let before:string[]=[];
 let after:string[]=next;
 if(old===null){
  headline='当前受管副本缺失：这是从已验证归档恢复，不存在可证明的当前版本差异。';
 }else{
  let first=0;
  while(first<old.length&&first<next.length&&old[first]===next[first])first++;
  let oldLast=old.length,newLast=next.length;
  while(oldLast>first&&newLast>first&&old[oldLast-1]===next[newLast-1]){
   oldLast--;newLast--;
  }
  before=old.slice(first,oldLast);
  after=next.slice(first,newLast);
  headline='受管修订差异（- 当前归档 / + 所选归档；仅显示变更片段）：';
  if(before.length===0&&after.length===0)
   return headline+'\n只检测到换行符或文本编码形式的差异；源码字节哈希仍以确认窗口所示为准。';
 }
 const rows:string[]=[];
 let displayed=0;
 for(const [tag,lines] of [['- ',before],['+ ',after]] as const){
  for(const line of lines){
   if(displayed>=ROW_LIMIT)break;
   const candidate=tag+printable(line);
   if((headline+'\n'+rows.concat(candidate).join('\n')).length+TRUNCATED.length>LIMIT)break;
   rows.push(candidate);displayed++;
  }
 }
 const omitted=before.length+after.length>displayed;
 const outcome=headline+(rows.length?'\n'+rows.join('\n'):'');
 return outcome+(omitted?TRUNCATED:'');
}
// Keep decoding a separate boundary to avoid printing raw source in exceptions.
function textLinesFrom(lines:string[]):string[]{return lines;}
