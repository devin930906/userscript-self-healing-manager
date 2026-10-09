/**
 * One scan's cooperative pause gate. Pausing never interrupts the active CDP
 * request; it only prevents dispatching the next page. Cancellation releases
 * every waiter and does not revive the job on later resume calls.
 */
export class BatchPauseGate {
 private paused=false;
 private stopped=false;
 private waiters=new Set<(ready:boolean)=>void>();
 get isPaused():boolean{return this.paused;}
 get isCancelled():boolean{return this.stopped;}
 pause():boolean {
  if(this.stopped)return false;
  this.paused=true;return true;
 }
 resume():void {
  if(this.stopped)return;
  this.paused=false;
  for(const wake of this.waiters)wake(true);
  this.waiters.clear();
 }
 cancel():void {
  this.stopped=true;
  this.paused=false;
  for(const wake of this.waiters)wake(false);
  this.waiters.clear();
 }
 async waitUntilReady():Promise<boolean>{
  if(this.stopped)return false;
  if(!this.paused)return true;
  return new Promise<boolean>(resolve=>this.waiters.add(resolve));
 }
}
