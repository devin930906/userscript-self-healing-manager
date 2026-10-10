/**
 * Boundary for IPC / OS / CDP exceptions shown in the React renderer.
 *
 * Electron errors often embed private source paths, site URLs, selectors,
 * query parameters, cookie values or snippets of user script code. A thrown
 * value is NEVER a displayable string. Preserve actionability only for a
 * tiny list of exact, non-secret transport error identities.
 *
 * This function does not write a log, invoke IPC or call String(error).
 */
const UNKNOWN='操作未完成，请检查当前授权、源文件和浏览器状态后重试。';
const SAFE_CODES:Readonly<Record<string,string>>=Object.freeze({
 'CDP page identity timeout':'浏览器页面连接超时，请检查 Chrome 调试连接与目标标签页。',
 'CDP locator probe timeout':'页面 DOM 检查超时，请刷新目标页状态后重试。',
 'CDP snapshot timeout':'页面 DOM 检查超时，请刷新目标页状态后重试。',
 'CDP candidate snapshot timeout':'页面 DOM 检查超时，请刷新目标页状态后重试。',
 'CDP page identity socket error':'浏览器调试连接中断，请检查 Chrome 调试连接与目标标签页。',
 'CDP socket error':'浏览器调试连接中断，请检查 Chrome 调试连接与目标标签页。',
 'CDP socket closed before locator results':'浏览器调试连接中断，请检查 Chrome 调试连接与目标标签页。',
 'CDP page identity socket closed before response':'浏览器调试连接中断，请检查 Chrome 调试连接与目标标签页。',
});
/** Always return private-data-free UI copy; unknown errors are never echoed. */
export function summarizeSafeDesktopError(error:unknown):string{
 if(!(error instanceof Error)||typeof error.message!=='string')return UNKNOWN;
 let message=error.message;
 // Electron's *known, namespaced* IPC envelope may be unwrapped, but the
 // payload must still be an exact allowlisted code. Reject appended text.
 const envelope=/^Error invoking remote method 'usshm:[a-z-]{1,64}': Error: (.+)$/s.exec(message);
 if(envelope)message=envelope[1]!;
 return Object.prototype.hasOwnProperty.call(SAFE_CODES,message)?
  SAFE_CODES[message]!:UNKNOWN;
}
