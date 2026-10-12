/**
 * Test-only trusted Electron renderer readiness gate.
 * This never grants access and never changes production Electron configuration.
 */
export interface TrustedRendererState {
 readonly href:string;
 readonly readyState:string;
 readonly topLevel:boolean;
 readonly hasGetAppInfo:boolean;
 readonly hasGenericInvoke:boolean;
 readonly hasNode:boolean;
 readonly hasRawIpc:boolean;
}
export async function waitForTrustedRendererReady(
 probe:()=>Promise<TrustedRendererState|null>,
 options:{expectedUrl:string;attempts:number;pause:()=>Promise<void>;assertAlive:()=>void}
):Promise<void>{
 // TDD RED scaffold: deliberately does not wait for or verify the renderer.
 void probe; void options;
}
