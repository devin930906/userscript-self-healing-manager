import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
async function collect(dir){let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return [];}
 const paths=[];for(const entry of entries){const path=resolve(dir,entry.name);if(entry.isDirectory()&&!['node_modules','dist','.worktrees','.git'].includes(entry.name))paths.push(...await collect(path));else if(entry.isFile()&&entry.name.endsWith('.test.ts'))paths.push(path);}return paths;}
const files=[...await collect('packages'),...await collect('apps'),...await collect('tests')];
if(files.length===0)throw Error('No test files discovered');
console.log(`Running ${files.length} TypeScript test files`);
const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit'});
process.exit(result.status??1);
