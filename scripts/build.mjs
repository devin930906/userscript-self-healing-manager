import {build} from 'esbuild';
import {mkdir,copyFile,rm} from 'node:fs/promises';
import {assertProductionModuleGraph,verifyProductionBundles} from './production-boundary.mjs';

// Every developer/release build verifies BOTH the esbuild import graph and
// the actual bundled JavaScript; CI independently repeats the artifact scan.
// A failed security gate removes the incomplete dist/ output. No installers.
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
try{
 const main=await build({
  entryPoints:['apps/desktop/src/main/index.ts'],bundle:true,platform:'node',
  format:'cjs',target:'node24',outfile:'dist/main.cjs',
  external:['electron','typescript'],metafile:true,logLevel:'info',
 });
 assertProductionModuleGraph(main.metafile,'main');
 const preload=await build({
  entryPoints:['apps/desktop/src/preload/index.ts'],bundle:true,platform:'node',
  format:'cjs',target:'node24',outfile:'dist/preload.cjs',
  external:['electron'],metafile:true,logLevel:'info',
 });
 assertProductionModuleGraph(preload.metafile,'preload');
 const renderer=await build({
  entryPoints:['apps/desktop/src/renderer/App.tsx'],bundle:true,
  platform:'browser',format:'iife',target:'chrome120',
  outfile:'dist/renderer.js',logLevel:'info',jsx:'automatic',metafile:true,
 });
 assertProductionModuleGraph(renderer.metafile,'renderer');
 await Promise.all([
  copyFile('apps/desktop/src/renderer/index.html','dist/index.html'),
  copyFile('apps/desktop/src/renderer/style.css','dist/style.css'),
 ]);
 await verifyProductionBundles('dist');
 console.log('Built Electron main, preload, React UI and assets; compiled production security boundary PASS.');
}catch(error){
 // Never leave distributable compiled JS from a failed security build.
 await rm('dist',{recursive:true,force:true});
 throw error;
}
