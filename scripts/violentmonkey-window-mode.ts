/**
 * RG-05 test-only launcher mode control. The default remains the historically
 * verified headless CFT setup. Explicit "headed" exercises the supported
 * visible Windows Chrome process with the same disposable profile/extension
 * and unchanged GM release acceptance, so a headless-only failure can be
 * distinguished without changing real user environments.
 */
export function pinnedViolentmonkeyWindowFlags(mode:unknown):string[]{
 if(mode===undefined||mode==='headless')return ['--headless=new'];
 if(mode==='headed')return [];
 throw new Error('Invalid isolated Chrome window mode');
}

/**
 * RG-05 test-only CFT differential. "proxy-isolated" removes ONLY Chrome's
 * background-network disable switch. The calling smoke fixture still blocks
 * non-loopback networking with a dead proxy and DNS resolver, never a
 * production browser setting or evidence of real manager GM success.
 */
export function pinnedViolentmonkeyBackgroundNetworkFlags(mode:unknown):string[]{
 if(mode===undefined||mode==='disabled')return ['--disable-background-networking'];
 if(mode==='proxy-isolated')return [];
 throw new Error('Invalid isolated Chrome background-network mode');
}
