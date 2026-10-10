/**
 * Real Electron 44 negative security integration checks.
 *
 * Explicit opt-in, on Windows after npm ci && npm run build:
 *   set USSHM_ELECTRON_SECURITY_INTEGRATION=1
 *   node --experimental-strip-types --test apps/desktop/tests/electron-security.integration.test.ts
 *
 * No production modules are mocked. The program and its bundled renderer run in
 * actual Electron, using only a disposable data root and loopback CDP.
 * No external website or userscript is loaded.
 *
 * NOTE: A renderer cannot manufacture an Electron IpcMainInvokeEvent or invoke
 * an arbitrary unexposed IPC channel. The subframe probe below tests whether
 * that untrusted execution context acquires any bridge, NOT a forged native
 * event.sender. Direct native event forgery still requires a dedicated test
 * hook/harness and is deliberately not claimed as verified here.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const enabled = process.platform === 'win32'
  && process.env.USSHM_ELECTRON_SECURITY_INTEGRATION === '1';

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

// RED assertions authored before replacing the unbounded lifecycle waits.
test('timeout helper rejects a pending operation and preserves a completed result', async () => {
  await assert.rejects(withTimeout(new Promise<never>(() => {}), 10, 'probe'), /probe timed out/);
  assert.equal(await withTimeout(Promise.resolve('complete'), 1000, 'probe'), 'complete');
});

interface Target { type?: string; url?: string; webSocketDebuggerUrl?: string }
interface CdpReply { id?: number; result?: Record<string, unknown>; error?: { message: string } }

async function connectCdp(url: string): Promise<{
  events: string[];
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}> {
  const ws = new WebSocket(url);
  await new Promise<void>((done, fail) => {
    const timer = setTimeout(() => {
      ws.close();
      fail(new Error('CDP WebSocket open timed out'));
    }, 5000);
    const succeed = () => { clearTimeout(timer); done(); };
    const reject = () => { clearTimeout(timer); fail(new Error('CDP WebSocket failed')); };
    ws.addEventListener('open', succeed, { once: true });
    ws.addEventListener('error', reject, { once: true });
    ws.addEventListener('close', reject, { once: true });
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  const events: string[] = [];
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as CdpReply & { method?: string; params?: Record<string, unknown> };
    if (msg.method?.startsWith('Page.frame')) events.push(JSON.stringify({ method: msg.method, params: msg.params }));
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result ?? {});
  });
  ws.addEventListener('close', () => {
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('CDP disconnected')); }
    pending.clear();
  });
  return {
    events,
    call(method, params = {}) {
      const id = ++seq;
      return new Promise((resolveCall, rejectCall) => {
        const timer = setTimeout(() => { pending.delete(id); rejectCall(new Error('CDP call timed out: ' + method)); }, 5000);
        pending.set(id, { resolve: resolveCall, reject: rejectCall, timer });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: async () => {
      if (ws.readyState === WebSocket.CLOSED) return;
      const closed = new Promise<void>(resolve => ws.addEventListener('close', () => resolve(), { once: true }));
      ws.close();
      await withTimeout(closed, 5000, 'CDP close');
    },
  };
}

test('Electron 44 enforces renderer/IPC boundaries after hostile navigation attempts', {
  skip: enabled ? false : 'Windows Electron 44 integration requires USSHM_ELECTRON_SECURITY_INTEGRATION=1 and an existing build',
  timeout: 90_000,
}, async (t) => {
  const executable = resolve('node_modules', 'electron', 'dist', 'electron.exe');
  for (const file of [executable, resolve('dist', 'main.cjs'), resolve('dist', 'index.html')]) {
    await access(file); // Missing build is a failure when explicitly enabled.
  }

  const temporary = await mkdtemp(join(tmpdir(), 'usshm-security-'));
  let child: ChildProcess | undefined;
  let redirectServer: Server | undefined;
  let cdp: Awaited<ReturnType<typeof connectCdp>> | undefined;
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  let stderr = '';
  let exitConfirmed = false;
  let spawnError: Error | undefined;
  const marker = 'USSHM_EXISTING_HTML_44';
  const alternateFile = join(temporary, 'alternate-existing.html');
  const requests = { initial: 0, redirected: 0 };
  try {
    await writeFile(alternateFile, '<!doctype html><title>' + marker + '</title>', 'utf8');
    await access(alternateFile);
    await mkdir(join(temporary, 'Roaming'), { recursive: true });
    await mkdir(join(temporary, 'Local'), { recursive: true });
    redirectServer = createServer((request, response) => {
      if (request.url === '/redirect') {
        requests.initial++;
        response.writeHead(302, { Location: '/destination' });
        response.end();
      } else if (request.url === '/destination') {
        requests.redirected++;
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end('<!doctype html><title>' + marker + '</title>');
      } else { response.writeHead(404); response.end(); }
    });
    await withTimeout(new Promise<void>((done, fail) => {
      redirectServer!.once('error', fail);
      redirectServer!.listen(0, '127.0.0.1', done);
    }), 5000, 'HTTP listen');
    const address = redirectServer.address();
    assert.ok(address && typeof address !== 'string');
    const localRedirect = `http://127.0.0.1:${address.port}/redirect`;

    const env = {
      ...process.env,
      APPDATA: join(temporary, 'Roaming'),
      LOCALAPPDATA: join(temporary, 'Local'),
      PORTABLE_EXECUTABLE_DIR: temporary,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    child = spawn(executable, ['.', '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1', '--disable-gpu'], {
      cwd: process.cwd(), env, windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.on('error', (error: Error) => { spawnError = error; });
    child.on('exit', (code, signal) => { exit = { code, signal }; exitConfirmed = true; });
    child.stderr?.on('data', (data: Buffer) => { stderr = (stderr + String(data)).slice(-8000); });

    // Chrome chooses a free debugging port; parse its stderr endpoint.
    let endpoint: string | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw new Error('Electron launch failed: ' + spawnError.message);
      endpoint = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
      if (endpoint) break;
      if (exit) throw new Error('Electron exited before CDP became available: ' + JSON.stringify(exit));
      await delay(200);
    }
    if (spawnError) throw new Error('Electron launch failed: ' + spawnError.message);
    assert.ok(endpoint, 'Electron did not expose a loopback CDP endpoint: ' + stderr);
    const browserWs = new URL(endpoint);
    const origin = `http://127.0.0.1:${browserWs.port}`;
    let target: Target | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw new Error('Electron launch failed: ' + spawnError.message);
      if (exit) throw new Error('Electron exited during target discovery: ' + JSON.stringify(exit));
      const response = await fetch(origin + '/json/list', { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (response?.ok) {
        const targets = await withTimeout(response.json() as Promise<Target[]>, 1000, 'CDP target response body');
        target = targets.find((entry) =>
          entry.type === 'page' && entry.url?.startsWith('file://')
          && entry.url.replaceAll('\\\\', '/').endsWith('/dist/index.html')
          && entry.webSocketDebuggerUrl);
      }
      if (target) break;
      await delay(200);
    }
    if (exit) throw new Error('Electron exited before renderer ready: ' + JSON.stringify(exit));
    assert.ok(target?.webSocketDebuggerUrl, 'Expected the bundled local renderer');
    const trustedUrl = target.url!;
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');

    async function evaluate<T>(expression: string): Promise<T> {
      if (spawnError) throw new Error('Electron launch failed: ' + spawnError.message);
      if (exit) throw new Error('Electron exited prematurely: ' + JSON.stringify(exit));
      const response = await cdp!.call('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true,
      });
      if (response.exceptionDetails) throw new Error('Renderer evaluation failed: ' + JSON.stringify(response.exceptionDetails));
      const value = response.result as { value?: T } | undefined;
      return value?.value as T;
    }

    await t.test('trusted main frame has only the allowlisted bridge, not Node or raw IPC', async () => {
      const state = await evaluate<{ info: { version: string }; node: string; ipc: string; generic: string }>(`(async () => ({
        info: await window.ussm.getAppInfo(),
        node: typeof window.require,
        ipc: typeof window.ipcRenderer,
        generic: typeof window.ussm.invoke
      }))()`);
      assert.match(state.info.version, /^\d+\.\d+\.\d+/);
      assert.equal(state.node, 'undefined');
      assert.equal(state.ipc, 'undefined');
      assert.equal(state.generic, 'undefined');
    });

    await t.test('iframe must load marker and have an executable CDP context', async () => {
      const outcome = await evaluate<{loaded:boolean;marker:string;bridge:string;ipc:string;node:string}>(`(async()=>{
        const frame=document.createElement('iframe');
        frame.id='usshm-security-probe';
        frame.srcdoc='<!doctype html><html><body><span id="proof">FRAME_MARKER_44</span></body></html>';
        const done=new Promise((resolve,reject)=>{
          frame.addEventListener('load',()=>resolve(true),{once:true});
          frame.addEventListener('error',()=>reject(new Error('iframe load error')),{once:true});
          setTimeout(()=>reject(new Error('iframe load timeout or CSP denial')),3000);
        });
        document.body.append(frame);
        await done;
        if(!frame.contentWindow||!frame.contentDocument)throw new Error('iframe execution context missing');
        const marker=frame.contentDocument.getElementById('proof')?.textContent;
        if(marker!=='FRAME_MARKER_44')throw new Error('iframe content marker missing');
        return {loaded:true,marker,bridge:typeof frame.contentWindow.ussm,
          ipc:typeof frame.contentWindow.ipcRenderer,node:typeof frame.contentWindow.require};
      })()`);
      assert.equal(outcome.loaded,true);
      assert.equal(outcome.marker,'FRAME_MARKER_44');
      const tree=await cdp!.call('Page.getFrameTree');
      const mainTree=tree.frameTree as { childFrames?: Array<{frame:{id:string;url:string}}> } | undefined;
      const child=mainTree?.childFrames?.find(f=>f.frame.url==='about:srcdoc');
      assert.ok(child?.frame.id,'loaded iframe missing from CDP frame tree');
      const isolated=await cdp!.call('Page.createIsolatedWorld',{frameId:child.frame.id,worldName:'usshm-security-test'});
      assert.equal(typeof isolated.executionContextId,'number','iframe CDP execution context not created');
      const probe=await cdp!.call('Runtime.evaluate',{contextId:isolated.executionContextId,
        expression:'document.getElementById("proof")?.textContent',returnByValue:true});
      assert.equal((probe.result as {value?:string})?.value,'FRAME_MARKER_44',
        'iframe execution context could not execute isolated marker probe');
      assert.deepEqual([outcome.bridge,outcome.ipc,outcome.node],['undefined','undefined','undefined']);
      await evaluate<boolean>(`(()=>{const frame=document.getElementById('usshm-security-probe');
        if(!frame)return false;frame.remove();return true})()`);
    });
    await t.test('existing alternate local HTML is blocked (sentinel would load without guard)', async () => {
      const before=cdp!.events.length;
      await evaluate(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(pathToFileURL(alternateFile).href)};document.body.append(a);a.click();a.remove();return true})()`);
      await delay(650);
      assert.equal(await evaluate('location.href'),trustedUrl);
      assert.equal(cdp!.events.slice(before).some(e=>e.includes('Page.frameNavigated')&&e.includes(marker)),false);
      assert.equal(typeof (await evaluate('window.ussm.getAppInfo()')).version,'string');
    });

    await t.test('HTTP 302 initial/redirect destinations are both unreachable', async () => {
      const before=cdp!.events.length;
      await evaluate(`(()=>{const a=document.createElement('a');a.href=${JSON.stringify(localRedirect)};document.body.append(a);a.click();a.remove();return true})()`);
      await delay(650);
      assert.equal(await evaluate('location.href'),trustedUrl);
      assert.equal(requests.initial,0,'navigation guard absent: HTTP 302 was requested');
      assert.equal(requests.redirected,0,'redirect target unexpectedly requested');
      assert.equal(cdp!.events.slice(before).some(e=>e.includes('Page.frameNavigated')&&e.includes('/destination')),false);
      assert.equal(typeof (await evaluate('window.ussm.getAppInfo()')).version,'string');
    });
  } finally {
    const failures: Error[] = [];
    try { await cdp?.close(); } catch(e) { failures.push(new Error('CDP cleanup: '+String(e))); }
    // Failed spawn with no PID did not create a running Electron process.
    // It must not create a second cleanup failure or block removal of this test-only data.
    if (child?.pid && !exitConfirmed) {
      const processToStop = child;
      const ended = new Promise<void>((resolve, reject) => {
        processToStop.once('exit', () => resolve());
        processToStop.once('error', reject);
      });
      try {
        await withTimeout(new Promise<void>((resolve, reject) => {
          const killer = spawn('taskkill', ['/PID', String(processToStop.pid), '/T', '/F'],
            {windowsHide:true,stdio:['ignore','ignore','pipe']});
          let errorOutput = '';
          killer.stderr?.on('data', data => { errorOutput += String(data).slice(0,1024); });
          killer.once('error', reject);
          killer.once('exit', code => code === 0 ? resolve() :
            reject(new Error('taskkill failed, exit ' + code + ': ' + errorOutput)));
        }), 10000, 'taskkill');
        await withTimeout(ended, 10000, 'Electron exit');
      } catch (e) { failures.push(new Error('Electron cleanup: ' + String(e))); }
    }
    if(redirectServer?.listening) {
      try { await withTimeout(new Promise<void>((resolve,reject)=>redirectServer!.close(err=>err?reject(err):resolve())), 10000, 'HTTP close'); }
      catch(e) { failures.push(e as Error); }
    }
    if(child?.pid && !exitConfirmed) failures.push(new Error('Electron exit unconfirmed; temporary data retained: '+temporary));
    else { try { await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
      catch(e) { failures.push(new Error('Temporary directory cleanup: '+String(e))); } }
    if(failures.length) throw new AggregateError(failures,'Electron security cleanup failed');
  }
});
