/**
 * QA-048 isolated Electron security fixture helper.
 * RED scaffold only: deliberately refuses any mutation until TDD verifies
 * the real CDP DOM attachment implementation.
 */
export async function attachSyntheticSecurityIframeViaCdp(_options:{
 expectedUrl:string;
 call:(method:string,params?:Record<string,unknown>)=>Promise<Record<string,unknown>>;
 assertAlive:()=>void;
}):Promise<void>{
 throw new Error('QA-048 synthetic iframe DOM attachment not implemented');
}
