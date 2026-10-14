import type {ChromeTarget} from '../../cdp-client/src/index.ts';
import {validateCdpPageSocket} from '../../cdp-client/src/endpoint.ts';

export interface SyntheticActionBoundaryReceipt {
 readonly status:'fixture-eligible';
 readonly validationLevel:'synthetic-action-scope-only';
 readonly productionEligible:false;
 readonly V2:'blocked';
 readonly V3:'not-configured';
 readonly V4:'not-configured';
 readonly interactionVerified:false;
 readonly functionalVerified:false;
 readonly managerVerified:false;
}

/**
 * Strict, non-transferable PRE-FLIGHT for the synthetic fixture click runner.
 * It does not authorize any browser Input call on its own. The test runner
 * separately verifies frame/loader identity, button attributes and a fresh
 * pre-click frame state. No real website can be whitelisted by its DOM label.
 */
export function assessSyntheticActionBoundary(input:{
 readonly approved:boolean;
 readonly action:string;
 readonly elementId:string;
 readonly target:ChromeTarget;
 readonly fixtureUrl:string;
}):SyntheticActionBoundaryReceipt{
 if(!input||input.approved!==true)
  throw new Error('Explicit synthetic action approval required');
 if(input.action!=='fixture-test-click')
  throw new Error('Unsupported synthetic fixture action');
 if(input.elementId!=='fixture-safe-click')
  throw new Error('Unexpected synthetic fixture button');
 const {target,fixtureUrl}=input;
 let url:URL;
 try{url=new URL(fixtureUrl);}catch{throw new Error('Invalid synthetic fixture URL');}
 if(url.href!==fixtureUrl||url.protocol!=='http:'||
    url.hostname!=='127.0.0.1'||!url.port||
    Number(url.port)<1024||Number(url.port)>65535||
    url.pathname!=='/fixture'||url.username||url.password||
    url.search||url.hash)
  throw new Error('Refusing noncanonical or non-local synthetic fixture URL');
 if(!target||target.type!=='page'||target.url!==fixtureUrl||
    typeof target.id!=='string'||!target.id||target.id.length>128)
  throw new Error('Refusing mismatched synthetic fixture target');
 validateCdpPageSocket(target,9223);
 return Object.freeze({
  status:'fixture-eligible',validationLevel:'synthetic-action-scope-only',
  productionEligible:false,V2:'blocked',V3:'not-configured',V4:'not-configured',
  interactionVerified:false,functionalVerified:false,managerVerified:false,
 });
}
