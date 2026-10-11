/**
 * Guards independent UI requests against late completions after a target or
 * scan switch. Invalidation revokes callbacks, including finally cleanup.
 * It does not attempt to cancel an already-sent IPC/CDP operation.
 */
export class LatestRequestGate {
 private generation=0;
 begin():number {return ++this.generation;}
 invalidate():void {this.generation++;}
 isCurrent(token:number):boolean {return token===this.generation;}
 commit(token:number,callback:()=>void):boolean {
  if(!this.isCurrent(token))return false;
  callback();
  return true;
 }
}
