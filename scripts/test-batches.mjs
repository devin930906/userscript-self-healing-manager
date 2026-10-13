/**
 * Keep Windows CreateProcess argument lengths far below 32,767 UTF-16 units.
 * A single node --test command containing hundreds of absolute test paths can
 * fail before Node emits any test result. Never silently omit tests.
 */
export function buildTestBatches(files){
 if(!Array.isArray(files)||files.length===0)
  throw new Error('No tests available for CI batching');
 const maxBatchFiles=48,maxBatchChars=12000;
 const batches=[];
 let batch=[],used=0;
 for(const file of files){
  if(typeof file!=='string'||file.length===0||file.includes('\0')||
     file.length+3>maxBatchChars)
   throw new Error('Invalid test path or path exceeds CI argument budget');
  const cost=file.length+3;
  if(batch.length&&(batch.length>=maxBatchFiles||used+cost>maxBatchChars)){
   batches.push(batch);
   batch=[];
   used=0;
  }
  batch.push(file);
  used+=cost;
 }
 if(batch.length)batches.push(batch);
 return batches;
}
