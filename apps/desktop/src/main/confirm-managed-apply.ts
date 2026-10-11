/** Renderer approved:true is a request, never proof of user consent.
 * Require main-process native confirmation before activating a managed revision. */
export async function confirmSingleManagedApply(
 showNativeConfirmation:()=>Promise<{response:number}>,
):Promise<boolean>{
 const result=await showNativeConfirmation();
 return result.response===1;
}

/** Only main passes a native confirmation callback and its live state validators.
 * Any dismissal, stale scan, or consumed proposal aborts before the write. */
export async function approveAndApplyManagedRevision<T>(deps:{
 confirm:()=>Promise<{response:number}>;
 revalidate:()=>void|Promise<void>;
 apply:()=>Promise<T>;
}):Promise<T>{
 if(!await confirmSingleManagedApply(deps.confirm))
  throw new Error('Managed repair was not approved by user');
 await deps.revalidate();
 return deps.apply();
}
