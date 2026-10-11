import type {ErrorOrigin} from '../../contracts/src/index.ts';

/**
 * FR-018: evidence-bounded classification for read-only CDP diagnosis only.
 * A failed DOM selector is NOT proof that the page or userscript caused it.
 * A thrown adapter error may contain private strings; never inspect its text.
 * No category implies V2/V3/V4 functional or manager verification.
 */
export type FaultCategory=
 'selector-assertion'|'functional-assertion'|'permission'|'login'|'network'|'unknown';
export type ReadOnlyFaultCode=
 'DOM_SELECTOR_MISSING'|'CDP_PROBE_UNVERIFIED'|'CDP_EVIDENCE_REJECTED'|'UNATTRIBUTED_FAILURE';
export interface ReadOnlyFault {
 readonly code:ReadOnlyFaultCode;
 readonly origin:ErrorOrigin;
 readonly category:FaultCategory;
 readonly attribution:'protocol-boundary'|'unattributed';
 readonly functionalVerified:false;
}
type ObservedOutcome={readonly status:string;readonly reason?:string|undefined};
const fault=(code:ReadOnlyFaultCode,origin:ErrorOrigin,
 category:FaultCategory,attribution:ReadOnlyFault['attribution']):ReadOnlyFault=>
 Object.freeze({code,origin,category,attribution,functionalVerified:false});

/**
 * Intentionally recognizes ONLY trusted, exact internal diagnostic reasons,
 * never page text, arbitrary exceptions, URLs, selectors, or guessed origins.
 * A CDP response-shape mismatch identifies a protocol boundary, not blame
 * for a particular browser extension, page, user script or website.
 */
export function classifyReadOnlyFault(row:ObservedOutcome):ReadOnlyFault|undefined{
 if(row.status==='locator-missing')
  return fault('DOM_SELECTOR_MISSING','unknown','selector-assertion','unattributed');
 if(row.status!=='error')return undefined;
 if(row.reason==='CDP locator probe failed')
  return fault('CDP_PROBE_UNVERIFIED','unknown','unknown','unattributed');
 if(row.reason==='CDP evidence identity or shape mismatch')
  return fault('CDP_EVIDENCE_REJECTED','cdp','unknown','protocol-boundary');
 return fault('UNATTRIBUTED_FAILURE','unknown','unknown','unattributed');
}
