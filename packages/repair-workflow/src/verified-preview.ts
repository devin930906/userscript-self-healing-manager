import {isAbsolute} from 'node:path';
import {assertStablePageDocument,type ConfirmedPageIdentity} from '../../cdp-client/src/page-identity.ts';
import type {VerifiedCandidate,MissingLocator} from '../../candidate-engine/src/workflow.ts';
import type {ProposalReceipt} from './index.ts';
import type {SelectorLocation} from '../../patch-engine/src/index.ts';
import {isSafeLocatorToken} from '../../candidate-engine/src/index.ts';

/** A raw DOM API argument and the independently observed CSS locator must
 * describe the same element, never a different alias or unrelated selector. */
function matchesCandidateLocatorEvidence(method:string,expression:string,cssSelector:string):boolean{
 if(method==='querySelector')return expression===cssSelector;
 if(!isSafeLocatorToken(expression))return false;
 switch(method){
  case 'getElementById':return cssSelector==='#'+expression;
  case 'getElementsByName':return cssSelector==='[name="'+expression+'"]';
  case 'getElementsByClassName':return cssSelector==='.'+expression;
  default:return false;
 }
}

/** Preview orchestration only. Neither code execution nor managed-source write
 * is allowed by this module; applying still requires a separate approval IPC.
 * DOM candidate validation is NOT evidence of equivalent business semantics. */
export interface VerifiedPreviewDeps {
 confirm:()=>Promise<ConfirmedPageIdentity>;
 discover:()=>Promise<readonly VerifiedCandidate[]>;
 verifySource:()=>Promise<void>;
 propose:(selector:string)=>Promise<ProposalReceipt>;
 revoke:(proposalId:string)=>void;
}
export interface VerifiedPreviewResult {
 readonly status:'prepared'|'needs-review';
 readonly candidate:VerifiedCandidate|null;
 readonly proposal:ProposalReceipt|null;
 readonly verificationLevel:'dom-only';
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly productionVerified:false;
}
export async function prepareVerifiedRepairPreview({approved,target,locator,source,deps}:{
 approved:boolean;
 target:{id:string;url:string};
 locator:MissingLocator;
 source:{scriptId:string;sourcePath:string;expectedSha256:string;selectorLocation:SelectorLocation};
 deps:VerifiedPreviewDeps;
}):Promise<VerifiedPreviewResult>{
 if(approved!==true)throw new Error('Explicit candidate preview consent is required');
 if(!target||typeof target.id!=='string'||!target.id||target.id.length>128||
    typeof target.url!=='string'||!/^https?:\/\//.test(target.url))
  throw new Error('Invalid selected CDP target');
 if(!locator||locator.runtimeRequired||!['querySelector','getElementById',
    'getElementsByName','getElementsByClassName'].includes(locator.method)||
    typeof locator.expression!=='string'||!locator.expression||
    locator.expression.length>1024)
  throw new Error('Only supported literal document selectors can be repaired');
 if(!source||!isAbsolute(source.sourcePath)||!/^[a-z0-9_-]{1,64}$/i.test(source.scriptId)||
    !/^[0-9a-f]{64}$/.test(source.expectedSha256)||
    !source.selectorLocation||source.selectorLocation.method!==locator.method||
    !Number.isSafeInteger(source.selectorLocation.line)||source.selectorLocation.line<1||
    !Number.isSafeInteger(source.selectorLocation.column)||source.selectorLocation.column<1)
  throw new Error('Invalid scanned script source or hash identity');
 if(!deps||typeof deps.confirm!=='function'||typeof deps.discover!=='function'||
    typeof deps.verifySource!=='function'||typeof deps.propose!=='function'||
    typeof deps.revoke!=='function')
  throw new Error('Missing trusted Main candidate preview dependencies');
 const baseline=await deps.confirm();
 const requireIdentity=(identity:ConfirmedPageIdentity)=>{
  if(!identity||identity.targetId!==target.id||identity.confirmedUrl!==target.url||
     !identity.frameId||!identity.loaderId||
     identity.frameId.length>256||identity.loaderId.length>256)
   throw new Error('Candidate document identity cannot be verified');
  assertStablePageDocument(baseline,identity);
 };
 requireIdentity(baseline);
 const candidates=await deps.discover();
 requireIdentity(await deps.confirm());
 const basic:Omit<VerifiedPreviewResult,'status'|'candidate'|'proposal'>={
  verificationLevel:'dom-only',V2:'blocked',V3:'not-configured',V4:'not-configured',
  productionVerified:false,
 };
 // Even two uniquely matching candidates might point to unrelated elements.
 // Without a human-defined semantic contract there is NO safe automatic choice.
 if(!Array.isArray(candidates)||candidates.length!==1)
  return {...basic,status:'needs-review',candidate:null,proposal:null};
 const chosen=candidates[0]!;
 if(chosen.validationLevel!=='dom-candidate-verified'||chosen.source!=='DOMSnapshot'||
    chosen.matchCount!==1||chosen.approved!==false||
    typeof chosen.expression!=='string'||chosen.expression.length<1||chosen.expression.length>1024||
    chosen.expression===locator.expression||typeof chosen.cssSelector!=='string'||
    !chosen.cssSelector||chosen.cssSelector.length>1024||
    !matchesCandidateLocatorEvidence(locator.method,chosen.expression,chosen.cssSelector)||
    !Number.isSafeInteger(chosen.confidenceScore)||chosen.confidenceScore<0||chosen.confidenceScore>100)
  throw new Error('Untrusted or unverified DOM candidate evidence');
 await deps.verifySource();
 let proposal:ProposalReceipt|undefined;
 try{
  proposal=await deps.propose(chosen.expression);
  requireIdentity(await deps.confirm());
  await deps.verifySource();
  if(!proposal||typeof proposal.proposalId!=='string'||!proposal.proposalId||
     proposal.scriptId!==source.scriptId||proposal.originalHash!==source.expectedSha256||
     proposal.oldSelector!==locator.expression||proposal.newSelector!==chosen.expression||
     !/^[0-9a-f]{64}$/.test(proposal.proposedHash)||!/^[0-9a-f]{64}$/.test(proposal.baseHash))
   throw new Error('Prepared proposal source or candidate identity mismatch');
  return {...basic,status:'prepared',candidate:chosen,proposal};
 }catch(error){
  if(proposal?.proposalId)deps.revoke(proposal.proposalId);
  throw error;
 }
}
