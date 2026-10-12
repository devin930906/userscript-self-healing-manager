// Synthetic CI-only cross-process lease holder. Never opens a userscript.
import {reserveManagedScriptWrites} from '../src/main/managed-script-lease.ts';

let release;
try{
 release=reserveManagedScriptWrites(process.env.USSHM_LEASE_ROOT,[
  process.env.USSHM_LEASE_SCRIPT,
 ]);
 process.stdout.write('ACQUIRED\n');
 process.stdin.resume();
 process.stdin.once('data',()=>{
  try{release();process.stdout.write('RELEASED\n',()=>process.exit(0));}
  catch{process.exit(1);}
 });
}catch{
 // Never print private paths or OS error details to CI logs.
 process.stdout.write('DENIED\n',()=>process.exit(0));
}
