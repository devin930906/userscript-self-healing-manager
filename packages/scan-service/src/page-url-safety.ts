/**
 * Read-only browser observations return selected page URLs over IPC.
 * Reject URLs embedding HTTP Basic Auth credentials before a page identity
 * or diagnostic result can leave the trusted main-process boundary.
 *
 * This does not redact URL query strings, which are still used for exact
 * target identity and need a separate privacy review before Stable.
 */
export function assertCredentialFreePageUrl(value:unknown):void{
 const failure=()=>new Error('Invalid or credential-bearing HTTP(S) page URL');
 if(typeof value!=='string')throw failure();
 let parsed:URL;
 try{parsed=new URL(value);}catch{throw failure();}
 if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||
    parsed.username!==''||parsed.password!=='')
  throw failure();
}
