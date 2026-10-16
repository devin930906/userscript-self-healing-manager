/**
 * Interpret bounded real-Chrome startup observations without returning
 * CDP errors, browser stderr, executable paths, page URLs or profile data.
 * These labels distinguish observations; they never assert the cause of a
 * Windows runner failure or grant Chrome/page identity verification.
 */
export type ChromeSmokeStartupObservation={
 readonly launchFailed:boolean;
 readonly processExited:boolean;
 readonly cdpResponded:boolean;
 readonly fixtureTargetSeen:boolean;
};

export type ChromeSmokeStartupFailure=
 'chrome-spawn-failed'|'chrome-exited'|'cdp-no-valid-response'|
 'fixture-target-not-observed'|'fixture-frame-unconfirmed';

export function classifyChromeSmokeStartupFailure(
 state:ChromeSmokeStartupObservation,
):ChromeSmokeStartupFailure{
 if(!state||typeof state!=='object'||
    typeof state.launchFailed!=='boolean'||
    typeof state.processExited!=='boolean'||
    typeof state.cdpResponded!=='boolean'||
    typeof state.fixtureTargetSeen!=='boolean'||
    (state.fixtureTargetSeen&&!state.cdpResponded))
  throw new Error('Invalid Chrome startup observation');
 if(state.launchFailed)return 'chrome-spawn-failed';
 if(state.processExited)return 'chrome-exited';
 if(!state.cdpResponded)return 'cdp-no-valid-response';
 if(!state.fixtureTargetSeen)return 'fixture-target-not-observed';
 return 'fixture-frame-unconfirmed';
}
