import {DatabaseSync} from 'node:sqlite';
import {resolve,dirname,parse} from 'node:path';
import {lstatSync} from 'node:fs';

const roots=process.argv.slice(2);
if(roots.length!==3)throw new Error('Require precisely three Windows edition data roots');
if(new Set(roots.map(root=>resolve(root).toLowerCase())).size!==3)
 throw new Error('Windows edition data roots must be distinct');
for(const root of roots){
  for(const name of ['registry.sqlite','diagnosis-journal.sqlite']){
    const path=resolve(root,name);
    for(let directory=dirname(path);;directory=dirname(directory)){
      const info=lstatSync(directory);
      if(!info.isDirectory()||info.isSymbolicLink())
        throw new Error('Unsafe release SQLite ancestor directory: '+directory);
      if(directory===parse(directory).root)break;
    }
    const info=lstatSync(path,{throwIfNoEntry:false});
    if(!info?.isFile()||info.size===0)throw new Error('Missing or empty release SQLite database: '+path);
    const db=new DatabaseSync(path,{readOnly:true,create:false,timeout:5000});
    try{
      const result=db.prepare('PRAGMA integrity_check').all();
      if(result.length!==1||result[0].integrity_check!=='ok')
        throw new Error('SQLite integrity_check failed for '+path+': '+JSON.stringify(result));
      const foreignKeys=db.prepare('PRAGMA foreign_key_check').all();
      if(foreignKeys.length!==0)
        throw new Error('SQLite foreign_key_check failed for '+path+': '+JSON.stringify(foreignKeys));
      console.log('SQLite integrity_check and foreign_key_check PASS:',path);
    }finally{db.close();}
  }
}
