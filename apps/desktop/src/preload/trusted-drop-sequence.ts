/** Prevent an earlier trusted OS drop's asynchronous IPC reply from being
 * delivered to a UI which has already received a more recent drop.
 * This is an ordering guard, not a substitute for OS drag authentication. */
export class TrustedDropSequence {
 private generation=0;
 begin():number { return ++this.generation; }
 invalidate():void { ++this.generation; }
 isCurrent(generation:number):boolean {
  return Number.isSafeInteger(generation)&&generation>0&&generation===this.generation;
 }
}
