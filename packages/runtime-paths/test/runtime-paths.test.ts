import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveDataRoot, ensureWritableDataRoot } from '../src/index.ts';
import { mkdtemp, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('installed application keeps userData outside the binary folder', () => {
  assert.equal(resolveDataRoot({ distributionMode: 'installed', exeDirectory: 'C:\\Program Files\\USSHM', osUserDataDirectory: 'C:\\Users\\Public\\AppData\\USSHM' }), 'C:\\Users\\Public\\AppData\\USSHM');
});
test('portable EXE saves data beside the external executable, never the extraction temp dir', () => {
  assert.equal(resolveDataRoot({distributionMode:'portable-exe',exeDirectory:'C:\\Temp\\portable-unpacked',portableExternalDirectory:'D:\\My Apps',osUserDataDirectory:'C:\\Users\\Demo\\AppData'}),'D:\\My Apps\\Data');
  assert.throws(()=>resolveDataRoot({distributionMode:'portable-exe',exeDirectory:'C:\\Temp\\unpacked',osUserDataDirectory:'C:\\Users\\Demo\\AppData'}),/PORTABLE_EXECUTABLE_DIR/);
});
test('ZIP uses the extracted executable directory and rejects relative paths', () => {
  assert.equal(resolveDataRoot({distributionMode:'portable-zip',exeDirectory:'D:\\Apps\\USSHM',osUserDataDirectory:'C:\\AppData'}),'D:\\Apps\\USSHM\\Data');
  assert.throws(()=>resolveDataRoot({distributionMode:'portable-zip',exeDirectory:'relative',osUserDataDirectory:'C:\\AppData'}),/absolute/);
});
test('directory validation refuses a symlink-based portable data root', async (t) => {
  const root=await mkdtemp(join(tmpdir(),'usshm-path-'));
  try { const real=join(root,'real'); const link=join(root,'link'); await mkdir(real); const {symlink}=await import('node:fs/promises'); try { await symlink(real,link); } catch(error) { if(['EPERM','EACCES'].includes((error as NodeJS.ErrnoException).code??'')) { t.skip('Windows runner cannot create symlink without privilege'); return; } throw error; } await assert.rejects(ensureWritableDataRoot(link),/symlink/i); }
  finally { await rm(root,{recursive:true,force:true}); }
});
test('writable data root is created without deleting existing settings', async()=>{
  const root=await mkdtemp(join(tmpdir(),'usshm-data-'));const target=join(root,'Data');
  try { await ensureWritableDataRoot(target);const {writeFile}=await import('node:fs/promises'); await writeFile(join(target,'settings.json'),'{}'); await ensureWritableDataRoot(target);assert.equal(await readFile(join(target,'settings.json'),'utf8'),'{}');}
  finally {await rm(root,{recursive:true,force:true});}
});
