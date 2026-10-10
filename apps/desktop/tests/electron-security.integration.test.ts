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
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';

const enabled = process.platform === 'win32'
  && process.env.USSHM_ELECTRON_SECURITY_INTEGRATION === '1';

interface Target { type?: string; url?: string; webSocketDebuggerUrl?: string }
interface CdpReply { id?: number; result?: Record<string, unknown>; error?: { message: string } }

async function connectCdp(url: string): Promise<{
  call(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}> {
  const ws = new WebSocket(url);
  await Promise.race([new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done(), { once: true });
    ws.addEventListener('error', () => fail(new Error('CDP WebSocket failed')), { once: true });
  }), new Promise<never>((_, fail) => setTimeout(() => { ws.close(); fail(new Error('CDP WebSocket open timed out')); }, 5000))]);
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
      await Promise.race([closed, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('CDP close timeout')), 5000))]);
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
    await new Promise<void>((done, fail) => {
      redirectServer!.once('error', fail);
      redirectServer!.listen(0, '127.0.0.1', done);
    });
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
    child.on('exit', (code, signal) => { exit = { code, signal }; exitConfirmed = true; });
    child.stderr?.on('data', (data: Buffer) => { stderr = (stderr + String(data)).slice(-8000); });

    // Chrome chooses a free debugging port; parse its stderr endpoint.
    let endpoint: string | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      endpoint = stderr.match(/DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+)/)?.[1];
      if (endpoint) break;
      if (exit) throw new Error('Electron exited before CDP became available: ' + JSON.stringify(exit));
      await delay(200);
    }
    assert.ok(endpoint, 'Electron did not expose a loopback CDP endpoint: ' + stderr);
    const browserWs = new URL(endpoint);
    const origin = `http://127.0.0.1:${browserWs.port}`;
    let target: Target | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      const response = await fetch(origin + '/json/list', { signal: AbortSignal.timeout(1000) }).catch(() => null);
      if (response?.ok) {
        const targets = await response.json() as Target[];
        target = targets.find((entry) =>
          entry.type === 'page' && entry.url?.startsWith('file://')
          && entry.url.replaceAll('\\\\', '/').endsWith('/dist/index.html')
          && entry.webSocketDebuggerUrl);
      }
      if (target) break;
      await delay(200);
    }
    assert.ok(target?.webSocketDebuggerUrl, 'Expected the bundled local renderer');
    const trustedUrl = target.url!;
    cdp = await connectCdp(target.webSocketDebuggerUrl);
    await cdp.call('Runtime.enable');
    await cdp.call('Page.enable');

    async function evaluate<T>(expression: string): Promise<T> {
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

    await t.test('iframe load, sentinel and JS execution must all succeed before checking bridge', async () => {
      const result = await evaluate<{loaded: boolean; marker: string; executed: string; bridge: string; ipc: string; require: string}>(`(async()=>{
        const frame=document.createElement('iframe');
        frame.srcdoc='<!doctype html><html><body><span id="proof">FRAME_MARKER_44</span><script>document.body.dataset.executed="yes"<\/script></body></html>';
        const loaded=new Promise((resolve,reject)=>{
          frame.addEventListener('load',()=>resolve(true),{once:true});
          frame.addEventListener('error',()=>reject(new Error('iframe failed to load')),{once:true});
          setTimeout(()=>reject(new Error('iframe load/CSP timeout')),3000);
        });
        document.body.append(frame);
        try {
          await loaded;
          if(!frame.contentWindow||!frame.contentDocument)throw new Error('iframe execution context unavailable');
          const marker=frame.contentDocument.getElementById('proof')?.textContent;
          const executed=frame.contentDocument.body.dataset.executed;
          if(marker!=='FRAME_MARKER_44'||executed!=='yes')throw new Error('iframe content or script execution blocked');
          return {loaded:true,marker,executed,bridge:typeof frame.contentWindow.ussm,
            ipc:typeof frame.contentWindow.ipcRenderer,require:typeof frame.contentWindow.require};
        } finally {frame.remove();}
      })()`);
      assert.equal(result.loaded,true);
      assert.equal(result.marker,'FRAME_MARKER_44');
      assert.equal(result.executed,'yes');
      assert.deepEqual([result.bridge,result.ipc,result.require],['undefined','undefined','undefined']);
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
    if (child?.pid && !exitConfirmed) {
      const ended = new Promise<void>(resolve=>child!.once('exit',()=>resolve()));
      const killed = spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],
        {stdio:'pipe',encoding:'utf8',timeout:10000,windowsHide:true});
      if(killed.error||killed.status!==0) failures.push(new Error('taskkill failed: '+String(killed.error??killed.stderr)));
      try { await Promise.race([ended,new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Electron exit timed out')),10000))]); }
      catch(e) { failures.push(e as Error); }
    }
    if(redirectServer?.listening) {
      try { await Promise.race([new Promise<void>((resolve,reject)=>redirectServer!.close(err=>err?reject(err):resolve())),
        new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('HTTP close timed out')),10000))]); }
      catch(e) { failures.push(e as Error); }
    }
    if(child && !exitConfirmed) failures.push(new Error('Electron exit unconfirmed; temporary data retained: '+temporary));
    else { try { await rm(temporary,{recursive:true,force:true,maxRetries:5,retryDelay:200}); }
      catch(e) { failures.push(new Error('Temporary directory cleanup: '+String(e))); } }
    if(failures.length) throw new AggregateError(failures,'Electron security cleanup failed');
  }
});
