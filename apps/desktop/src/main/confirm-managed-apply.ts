/** Renderer approved:true is a request, never proof of user consent.
 * Require main-process native confirmation before activating a managed revision. */
export async function confirmSingleManagedApply(
 showNativeConfirmation:()=>Promise<{response:number}>,
):Promise<boolean>{
 const result=await showNativeConfirmation();
 return result.response===1;
}
