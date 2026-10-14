import {createHash} from 'node:crypto';
import {constants as copyFlags,createWriteStream} from 'node:fs';
import {copyFile,lstat,mkdtemp,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';

// CI-only fixture: never accept a caller-provided upstream URL or checksum on the CLI.
export const VIOLENTMONKEY_RELEASE_URL='https://github.com/violentmonkey/violentmonkey/releases/download/v2.49.0/Violentmonkey-mv3-v2.49.0.zip';
export const VIOLENTMONKEY_RELEASE_SHA256='3fa676c803a9698453ed23dfe496d4bc29a4bec52f6a95e55c43c2955921f8ee';
const RETRYABLE_HTTP=new Set([429,500,502,503,504]);
const DEFAULT_MAX_BYTES=32*1024*1024;
class DownloadFailure extends Error {
 constructor(message,{retryable=false}={}){super(message);this.retryable=retryable;}
}
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));

// A response is never exposed at the final path unless its complete SHA-256 is verified.
export async function downloadPinnedZip({url,expectedSha256,destination,fetchImpl=fetch,delay=wait,maxBytes=DEFAULT_MAX_BYTES}){
 if(typeof url!=='string'||!url.startsWith('https://')||!(/^[a-f0-9]{64}$/).test(expectedSha256)||
  !isAbsolute(destination)||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>DEFAULT_MAX_BYTES){
  throw new Error('Invalid pinned archive download configuration');
 }
 try {await lstat(destination);throw new Error('Pinned archive destination already exists');}
 catch(error){if(error.code!=='ENOENT')throw error;}
 const workspace=await mkdtemp(join(dirname(destination),'.usshm-pinned-'));
 const partial=join(workspace,'release.zip');
 try {
  for(let attempt=1;attempt<=3;attempt++){
   try {
    let response;
    try {response=await fetchImpl(url,{redirect:'follow',headers:{'User-Agent':'USSHM-CI-Pinned-Release/0.1'}});}
    catch(error){if(error instanceof TypeError)throw new DownloadFailure('Pinned archive network failure',{retryable:true});throw error;}
    if(response?.status!==200){
     const status=Number.isInteger(response?.status)?response.status:0;
     throw new DownloadFailure(`Pinned archive HTTP ${status}`,{retryable:RETRYABLE_HTTP.has(status)});
    }
    if(!response.body)throw new DownloadFailure('Pinned archive missing response body');
    const hash=createHash('sha256');let bytes=0;
    const guard=new Transform({transform(chunk,_encoding,callback){
     bytes+=chunk.length;
     if(bytes>maxBytes){callback(new DownloadFailure('Pinned archive size limit exceeded'));return;}
     hash.update(chunk);callback(null,chunk);
    }});
    try {
     await pipeline(Readable.fromWeb(response.body),guard,createWriteStream(partial,{flags:'wx',mode:0o600}));
    } catch(error) {
     if(error instanceof TypeError)throw new DownloadFailure('Pinned archive stream interrupted',{retryable:true});
     throw error;
    }
    const actual=hash.digest('hex');
    if(bytes===0||actual!==expectedSha256)throw new DownloadFailure('Pinned archive SHA-256 integrity mismatch');
    // Refuse an already-existing destination even after verification.
    await copyFile(partial,destination,copyFlags.COPYFILE_EXCL);
    return {sha256:actual,bytes,attempts:attempt};
   } catch(error) {
    await rm(partial,{force:true});
    if(!(error instanceof DownloadFailure)||!error.retryable||attempt===3)throw error;
    await delay(attempt*500);
   }
  }
  throw new Error('Unreachable pinned download state');
 }finally{await rm(workspace,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==3||!isAbsolute(process.argv[2]))
  throw new Error('Usage: node scripts/download-violentmonkey-release.mjs ABSOLUTE_TEMP_ARCHIVE_PATH');
 const result=await downloadPinnedZip({url:VIOLENTMONKEY_RELEASE_URL,
  expectedSha256:VIOLENTMONKEY_RELEASE_SHA256,destination:process.argv[2]});
 console.log(`Verified official Violentmonkey 2.49.0 archive (${result.bytes} bytes; SHA-256 matched)`);
}
