import { useEffect, useState } from 'react';
import type { UssmBridge, AppInfo } from '../preload/index';

declare global {
  interface Window {
    ussm?: Readonly<UssmBridge>;
  }
}

export function App(): JSX.Element {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    const bridge = window.ussm;
    if (!bridge) {
      setError(true);
      return;
    }
    void bridge.getAppInfo()
      .then((value) => { if (active) setInfo(value); })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 720, margin: '4rem auto', padding: '0 1rem' }}>
      <h1>Userscript Self-Healing Manager</h1>
      {error ? <p role="alert">无法读取本地应用信息。</p> : (
        <p aria-live="polite">{info ? `${info.name} · v${info.version}` : '正在读取本地应用信息…'}</p>
      )}
      <p>Phase 1 安全桌面基座。尚未执行脚本、浏览器连接或自动修复。</p>
    </main>
  );
}
