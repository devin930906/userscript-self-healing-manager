/**
 * Shared CDP observation boundary for selected user-authenticated browser
 * page identities. Reject URLs with HTTP Basic Auth userinfo before any
 * read-only operation can open a debugging socket or forward diagnostics.
 *
 * Query parameters may still be necessary to authenticate the selected
 * document and are not exported by this helper. They require separate
 * privacy handling in any renderer-facing report.
 */
export function assertCredentialFreePageUrl(value:unknown):void{
 const failure=()=>new Error('Invalid or credential-bearing HTTP(S) page URL');
 if(typeof value!=='string'||value.length<1||value.length>8192||
    value!==value.trim()||/[\u0000-\u001F\u007F-\u009F]/.test(value))
  throw failure();
 // WHATWG drops empty userinfo (https://@host) and normalizes raw
 // backslashes in HTTP(S) authority/path. Authenticate the original
 // spelling first; legitimate query/fragment data remain untouched.
 const pathAndAuthority=value.split(/[?#]/,1)[0];
 const authority=/^https?:\/\/([^/?#]*)/i.exec(pathAndAuthority)?.[1];
 if(!authority||authority.includes('@')||pathAndAuthority.includes('\\'))
  throw failure();
 let parsed:URL;
 try{parsed=new URL(value);}catch{throw failure();}
 if(!['http:','https:'].includes(parsed.protocol)||!parsed.hostname||
    parsed.username!==''||parsed.password!=='')
  throw failure();
}
