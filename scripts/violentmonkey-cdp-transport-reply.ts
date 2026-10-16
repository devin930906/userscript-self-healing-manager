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
     !result.value||typeof result.value!=='object'||Array.isArray(result.value)||
     'error' in result.value||'exceptionDetails' in result.value)
   throw new Error('invalid');
  return result.value as Record<string,unknown>;
 }catch{
  throw new Error('CDP command failed');
 }
}

/**
 * RG-05 synthetic Chrome USER_SCRIPT controls must not treat a protocol
 * failure (including falsy or inherited errors), exception, or accessor-backed
 * value as a successful registration, reply, or cleanup receipt.
 * This never returns CDP errors or private extension data to diagnostics.
 */
export function readVerifiedDirectChromeControlValue(reply:unknown):unknown{
 try{
  const result=readVerifiedOfficialManagerCdpReply(reply);
  const data=Object.getOwnPropertyDescriptor(result,'value');
  if(!data||!Object.hasOwn(data,'value'))throw new Error('missing');
  return data.value;
 }catch{
  throw new Error('Invalid direct Chrome CDP control receipt');
 }
}
