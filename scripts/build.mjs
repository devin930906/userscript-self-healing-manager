import {build} from 'esbuild';
import {mkdir,copyFile,rm} from 'node:fs/promises';
await rm('dist',{recursive:true,force:true});await mkdir('dist',{recursive:true});
await build({entryPoints:['apps/desktop/src/main/index.ts'],bundle:true,platform:'node',format:'cjs',target:'node24',outfile:'dist/main.cjs',external:['electron','typescript'],logLevel:'info'});
await build({entryPoints:['apps/desktop/src/preload/index.ts'],bundle:true,platform:'node',format:'cjs',target:'node24',outfile:'dist/preload.cjs',external:['electron'],logLevel:'info'});
await build({entryPoints:['apps/desktop/src/renderer/App.tsx'],bundle:true,platform:'browser',format:'iife',target:'chrome120',outfile:'dist/renderer.js',logLevel:'info',jsx:'automatic'});
await Promise.all([
 copyFile('apps/desktop/src/renderer/index.html','dist/index.html'),
 copyFile('apps/desktop/src/renderer/style.css','dist/style.css'),
]);
console.log('Built Electron main, preload, React UI and assets.');
