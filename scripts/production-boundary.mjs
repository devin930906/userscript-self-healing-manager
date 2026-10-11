import {lstat,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const FILES=['main.cjs','preload.cjs','renderer.js'];
const MAX_FILE_BYTES=20*1024*1024;
const TEST_ONLY_MODULE=/(?:^|\/)(?:scripts\/(?:local-fixture-(?:behavior|interaction)|synthetic-functional-lifecycle)\.ts|(?:apps\/desktop\/tests|packages\/[^/]+\/(?:test|tests)|tests)\/.*)$/;
const FORBIDDEN_OUTPUT=[
 /Runtime\s*\.\s*evaluate\b/,
 /Input\s*\.\s*dispatchMouseEvent\b/,
 /runIsolatedFixtureBehavior\b/,
 /runIsolatedFixtureInteraction\b/,
 /runSyntheticFunctionalLifecycle\b/,
];

/** Check the actual source import graph collected by esbuild. */
export function assertProductionModuleGraph(metafile,entrypoint){
 if(!['main','preload','renderer'].includes(entrypoint)||
    !metafile||typeof metafile!=='object'||!metafile.inputs||
    typeof metafile.inputs!=='object'||Array.isArray(metafile.inputs))
  throw new Error('Invalid production build graph');
 const inputs=Object.keys(metafile.inputs);
 if(!inputs.length||inputs.length>5000)
  throw new Error('Invalid production build import inventory');
 for(const input of inputs){
  if(typeof input!=='string'||input.length>1000)
   throw new Error('Invalid production build module path');
  const normalized=input.replace(/\\/g,'/');
  if(TEST_ONLY_MODULE.test(normalized))
   throw new Error('Test-only module imported into production '+entrypoint+' bundle');
 }
 return true;
}

/**
 * A second gate scans ACTUAL compiled Electron payloads, not just TS source.
 * It fails closed if a test-only CDP executor or input-dispatch API leaks
 * into the distributable application. It does not confer V2/V3/V4 status.
 */
export async function verifyProductionBundles(folder){
 if(typeof folder!=='string'||folder.length===0)
  throw new Error('Invalid production bundle directory');
 const root=resolve(folder);
 for(const name of FILES){
  const file=join(root,name);
  const info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||
     !Number.isSafeInteger(info.size)||info.size<1||info.size>MAX_FILE_BYTES)
   throw new Error('Unsafe or empty production bundle file: '+name);
  const bytes=await readFile(file);
  if(bytes.length!==info.size)
   throw new Error('Production bundle changed during security scan: '+name);
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(FORBIDDEN_OUTPUT.some(pattern=>pattern.test(source)))
   throw new Error('Test-only CDP execution capability leaked into production bundle: '+name);
 }
 return {valid:true,checkedFiles:FILES.length};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 verifyProductionBundles(process.argv[2]??'').then(
  receipt=>process.stdout.write('PASS compiled production boundary: '+receipt.checkedFiles+' Electron bundles contain no test-only CDP execution API.\n'),
  error=>{process.stderr.write('FAILED compiled production boundary: '+String(error?.message??error)+'\n');process.exitCode=1;}
 );
}
