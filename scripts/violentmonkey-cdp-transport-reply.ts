/**
 * Validate the CDP command envelope for the isolated official manager fixture.
 * Even a falsy protocol error is an error. Never export raw CDP error data.
 */
export function readVerifiedOfficialManagerCdpReply(reply:unknown):Record<string,unknown>{
 try{
  if(!reply||typeof reply!=='object'||Array.isArray(reply)||
     'error' in reply||'exceptionDetails' in reply)
   throw new Error('invalid');
  const result=Object.getOwnPropertyDescriptor(reply,'result');
  if(!result||!Object.hasOwn(result,'value')||
     !result.value||typeof result.value!=='object'||Array.isArray(result.value))
   throw new Error('invalid');
  return result.value as Record<string,unknown>;
 }catch{
  throw new Error('CDP command failed');
 }
}
