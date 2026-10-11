#!/usr/bin/env node
import {dirname,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {openDatabase,migrateDatabase,createScriptRepository} from '../packages/persistence/src/index.ts';
import {runStaticScan} from '../packages/scan-service/src/index.ts';
import {serializeStaticReport} from '../packages/reporting/src/index.ts';

async function main(argv:string[]):Promise<void>{
 let output='';let format:'json'|'markdown'='json';let recursive=true;const paths:string[]=[];
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--output'){output=argv[++i]??'';}else if(arg==='--markdown')format='markdown';
  else if(arg==='--no-recursive')recursive=false;else if(arg?.startsWith('-'))throw new Error(`Unknown option: ${arg}`);else if(arg)paths.push(resolve(arg));
 }
 if(paths.length===0)throw new Error('Usage: node --experimental-strip-types scripts/diagnose.ts [--output report.json] [--markdown] <file.user.js|folder> [...]');
 const db=openDatabase(':memory:');migrateDatabase(db);
 try {const r=await runStaticScan({paths,recursive,maxFiles:1000},{repository:createScriptRepository(db)});
  const report=serializeStaticReport(r,format);
  if(output){const target=resolve(output);await mkdir(dirname(target),{recursive:true});await writeFile(target,report,'utf8');console.log(`Analyzed ${r.processedCount} files. Report: ${target}`);}else process.stdout.write(report);
  if(r.errorCount>0)process.exitCode=2;
 }finally{db.close();}
}
main(process.argv.slice(2)).catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
