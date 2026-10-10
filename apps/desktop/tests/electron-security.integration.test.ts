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
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  await new Promise<void>((done, fail) => {
    ws.addEventListener('open', () => done(), { once: true });
    ws.addEventListener('error', () => fail(new Error('CDP WebSocket failed')), { once: true });
  });
  let seq = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (reason: Error) => void }>();
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data)) as CdpReply;
    if (msg.id === undefined) return;
    const entry = pending.get(msg.id);
    if (!entry) return;
    pending.delete(msg.id);
    if (msg.error) entry.reject(new Error(msg.error.message));
    else entry.resolve(msg.result ?? {});
  });
  ws.addEventListener('close', () => {
    for (const entry of pending.values()) entry.reject(new Error('CDP disconnected'));
    pending.clear();
  });
  return {
    call(method, params = {}) {
      const id = ++seq;
      return new Promise((resolveCall, rejectCall) => {
        pending.set(id, { resolve: resolveCall, reject: rejectCall });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => ws.close(),
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
  try {
    await mkdir(join(temporary, 'Roaming'), { recursive: true });
    await mkdir(join(temporary, 'Local'), { recursive: true });
    redirectServer = createServer((_request, response) => {
      response.writeHead(302, { Location: 'http://127.0.0.1:1/never-open' });
      response.end();
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
    child.on('exit', (code, signal) => { exit = { code, signal }; });
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

    await t.test('subframe cannot forge main-frame bridge access', async () => {
      const result = await evaluate<{ bridge: string; ipc: string; require: string }>(`(async () => {
        const frame = document.createElement('iframe');
        frame.srcdoc = '<!doctype html><title>local synthetic untrusted frame</title>';
        document.body.append(frame);
        await new Promise(resolve => { frame.onload = resolve; setTimeout(resolve, 800); });
        const value = {
          bridge: typeof frame.contentWindow.ussm,
          ipc: typeof frame.contentWindow.ipcRenderer,
          require: typeof frame.contentWindow.require
        };
        frame.remove();
        return value;
      })()`);
      assert.deepEqual(result, { bridge: 'undefined', ipc: 'undefined', require: 'undefined' });
    });

    await t.test('cross-document file navigation is blocked and trusted IPC remains bound', async () => {
      await evaluate(`(() => {
        const link = document.createElement('a');
        link.href = 'file:///C:/__usshm_security_denied__/different.html';
        document.body.append(link);
        link.click();
        link.remove();
      })()`);
      await delay(500);
      assert.equal(await evaluate('location.href'), trustedUrl);
      assert.equal(typeof (await evaluate('window.ussm.getAppInfo()')).version, 'string');
    });

    await t.test('HTTP redirect navigation is denied before leaving the app document', async () => {
      await evaluate(`(() => {
        const link = document.createElement('a');
        link.href = ${JSON.stringify(localRedirect)};
        document.body.append(link);
        link.click();
        link.remove();
      })()`);
      await delay(500);
      assert.equal(await evaluate('location.href'), trustedUrl);
      assert.equal(typeof (await evaluate('window.ussm.getAppInfo()')).version, 'string');
    });
  } finally {
    cdp?.close();
    await new Promise<void>((done) => redirectServer?.close(() => done()) ?? done());
    if (child?.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { timeout: 15000, stdio: 'ignore' });
    await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
