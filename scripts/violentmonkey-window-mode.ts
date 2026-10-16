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
