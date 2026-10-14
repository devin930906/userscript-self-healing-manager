import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';

const roots=process.argv.slice(2);
if(roots.length!==3)throw new Error('Require precisely three Windows edition data roots');
for(const root of roots){
  for(const name of ['registry.sqlite','diagnosis-journal.sqlite']){
    const path=resolve(root,name);
    const db=new DatabaseSync(path,{readOnly:true});
    try{
      const result=db.prepare('PRAGMA quick_check').all();
      if(result.length!==1||result[0].quick_check!=='ok')
        throw new Error('SQLite quick_check failed for '+path+': '+JSON.stringify(result));
      console.log('SQLite quick_check PASS:',path);
    }finally{db.close();}
  }
}
