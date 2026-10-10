import { beforeEach, describe, expect, it, vi } from 'vitest';

const { BrowserWindowMock, loadFile, setWindowOpenHandler, onWebContents, onWindow } = vi.hoisted(() => ({
  BrowserWindowMock: vi.fn(),
  loadFile: vi.fn().mockResolvedValue(undefined),
  setWindowOpenHandler: vi.fn(),
  onWebContents: vi.fn(),
  onWindow: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: BrowserWindowMock,
}));

import { createSecureWindow } from '../src/main/window';

describe('createSecureWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    BrowserWindowMock.mockImplementation(function (_opts: unknown) {
      return {
        webContents: {
          setWindowOpenHandler,
          on: onWebContents,
          getURL: () => 'file:///safe/index.html',
          stop: vi.fn(),
        },
        on: onWindow,
        once: onWindow,
        show: vi.fn(),
        close: vi.fn(),
        loadFile,
      };
    });
  });

  it('locks down Electron renderer privileges and loads local HTML', () => {
    createSecureWindow({ preloadPath: '/safe/preload.js', rendererPath: '/safe/index.html' });
    const options = BrowserWindowMock.mock.calls[0][0];
    expect(options.webPreferences).toMatchObject({
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
    });
    expect(loadFile).toHaveBeenCalledWith('/safe/index.html');
    expect(setWindowOpenHandler.mock.calls[0][0]({ url: 'https://example.org' })).toEqual({ action: 'deny' });
    for (const name of ['will-navigate', 'will-redirect']) {
      const handler = onWebContents.mock.calls.find(([event]) => event === name)?.[1];
      const preventDefault = vi.fn();
      handler({ preventDefault });
      expect(preventDefault).toHaveBeenCalledOnce();
    }
  });
});
