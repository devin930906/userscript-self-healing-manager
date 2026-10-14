import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';
import {assertCredentialFreePageUrl} from '../../cdp-client/src/page-url-safety.ts';
import type {ReadOnlyInteractionReadinessResult} from './read-only-interaction-readiness.ts';

export type ProductAction='observe'|'focus'|'click'|'type'|'submit'|'send'|'delete'|'payment';
export type ProductActionRisk='READ_ONLY'|'LOW_IMPACT'|'STATE_CHANGING'|'DESTRUCTIVE';
export interface ProductActionReview{
 readonly action:ProductAction;readonly risk:ProductActionRisk;
 readonly validationLevel:'read-only-product-action-review';
 readonly reason:string;readonly readinessStatus:ReadOnlyInteractionReadinessResult['status'];
 readonly executionAllowed:false;
 readonly V2:'blocked';readonly V3:'not-configured';readonly V4:'not-configured';
 readonly interactionVerified:false;readonly functionalVerified:false;readonly managerVerified:false;
}
const risks:Readonly<Record<ProductAction,ProductActionRisk>>=Object.freeze({
 observe:'READ_ONLY',focus:'LOW_IMPACT',click:'STATE_CHANGING',
 type:'STATE_CHANGING',submit:'DESTRUCTIVE',send:'DESTRUCTIVE',
 delete:'DESTRUCTIVE',payment:'DESTRUCTIVE',
});
/** Production preview only. Button labels, CSS and click listeners cannot
 * authorize a real action. No execution tokens or browser input are produced. */
export function reviewProductAction({approved,action,target,readiness}:{
 readonly approved:boolean;readonly action:string;readonly target:ChromeTarget;
 readonly readiness:ReadOnlyInteractionReadinessResult;
}):ProductActionReview{
 if(approved!==true)throw new Error('Explicit product action review approval required');
 if(typeof action!=='string'||!Object.prototype.hasOwnProperty.call(risks,action))
  throw new Error('Unsupported product action for review');
 if(!target||target.type!=='page'||typeof target.url!=='string')
  throw new Error('Invalid product review CDP target');
 let page:URL;
 try{page=new URL(target.url);}catch{throw new Error('Invalid product review target page');}
 if(!['http:','https:'].includes(page.protocol)||!page.hostname||
    page.username||page.password||page.hash||page.href!==target.url)
  throw new Error('Invalid product review target page');
 assertCredentialFreePageUrl(target.url);
 validateCdpPageSocket(target);
 if(!readiness||readiness.evidenceLevel!=='V1+read-only-control-metadata'||
    !['potentially-ready','blocked','needs-review'].includes(readiness.status)||
    ![1,2].includes(readiness.samples)||
    typeof readiness.caseId!=='string'||!readiness.caseId||readiness.caseId.length>100||
    typeof readiness.reason!=='string'||readiness.reason.length>4000||
    (readiness.directClickListeners!==null&&
     (!Number.isSafeInteger(readiness.directClickListeners)||
      readiness.directClickListeners<0||readiness.directClickListeners>512))||
    readiness.V2!=='blocked'||readiness.V3!=='not-configured'||
    readiness.V4!=='not-configured'||readiness.interactionVerified!==false||
    readiness.functionalVerified!==false||readiness.managerVerified!==false)
  throw new Error('Invalid read-only readiness evidence');
 const risk=risks[action as ProductAction];
 const reason=risk==='DESTRUCTIVE'?
  'Destructive or externally consequential action disabled: review cannot authorize execution':
  risk==='STATE_CHANGING'?
  'Site/account state can change even when a control looks harmless; automatic execution is disabled':
  risk==='LOW_IMPACT'?
  'Focus can invoke handlers; this review cannot authorize execution':
  'Read-only observation only; the review does not run browser actions';
 return Object.freeze({action:action as ProductAction,risk,
  validationLevel:'read-only-product-action-review',reason,readinessStatus:readiness.status,
  executionAllowed:false,V2:'blocked',V3:'not-configured',V4:'not-configured',
  interactionVerified:false,functionalVerified:false,managerVerified:false});
}
