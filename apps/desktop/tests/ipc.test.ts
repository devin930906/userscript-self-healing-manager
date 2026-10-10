import { beforeEach, describe, expect, it, vi } from 'vitest';

const { handle, removeHandler, getName, getVersion } = vi.hoisted(() => ({
  handle: vi.fn(), removeHandler: vi.fn(),
  getName: vi.fn(() => 'USSM'), getVersion: vi.fn(() => '0.1.0'),
}));
vi.mock('electron', () => ({ ipcMain: { handle, removeHandler }, app: { getName, getVersion } }));
import { APP_INFO_CHANNEL, registerIpcHandlers } from '../src/main/ipc';

describe('registerIpcHandlers_rejectsInvalidSenderAndArgs', () => {
  beforeEach(() => vi.clearAllMocks());

  function setup() {
    const frame = { url: 'file:///app/index.html' };
    const webContents = {
      isDestroyed: () => false,
      mainFrame: frame,
      getURL: () => frame.url,
    };
    const window = { isDestroyed: () => false, webContents };
    registerIpcHandlers({ window: window as never });
    expect(handle).toHaveBeenCalledWith(APP_INFO_CHANNEL, expect.any(Function));
    const invoke = handle.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => unknown;
    return { frame, webContents, invoke };
  }

  it('allows only main-frame no-payload requests', () => {
    const { frame, webContents, invoke } = setup();
    expect(invoke({ sender: webContents, senderFrame: frame })).toEqual({
      name: 'USSM', version: '0.1.0',
    });
  });

  it('rejects other webContents, subframes, and arguments', () => {
    const { frame, webContents, invoke } = setup();
    expect(() => invoke({ sender: {}, senderFrame: frame })).toThrow();
    expect(() => invoke({ sender: webContents, senderFrame: { url: frame.url } })).toThrow();
    expect(() => invoke({ sender: webContents, senderFrame: frame }, { command: 'run' })).toThrow();
    frame.url = 'https://example.org';
    expect(() => invoke({ sender: webContents, senderFrame: frame })).toThrow();
  });

  it('rejects invalid app-info response schema', () => {
    const frame = { url: 'file:///app/index.html' };
    const webContents = { isDestroyed: () => false, mainFrame: frame, getURL: () => frame.url };
    registerIpcHandlers({
      window: { isDestroyed: () => false, webContents } as never,
      getAppInfo: () => ({ name: '', version: 'wrong' }),
    });
    const invoke = handle.mock.calls[0][1];
    expect(() => invoke({ sender: webContents, senderFrame: frame })).toThrow('Invalid');
  });
});
