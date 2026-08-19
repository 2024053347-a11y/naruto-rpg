export function readLoadedBuild(documentRef = globalThis.document) {
  const script = documentRef?.querySelector?.('script[src*="app.js?v="]');
  const source = String(script?.src || script?.getAttribute?.('src') || '');
  if (!source) return '';
  try {
    return new URL(source, globalThis.location?.href || 'http://localhost/').searchParams.get('v') || '';
  } catch {
    return source.match(/[?&]v=([^&#]+)/)?.[1] || '';
  }
}

export async function inspectRuntimeBuild({
  fetchImpl = globalThis.fetch,
  documentRef = globalThis.document,
  locationRef = globalThis.location
} = {}) {
  const loadedBuild = readLoadedBuild(documentRef);
  if (typeof fetchImpl !== 'function' || !locationRef?.href) {
    return Object.freeze({ loadedBuild, latestBuild: '', stale: false, manifest: null });
  }
  const url = new URL('./version.json', locationRef.href);
  url.searchParams.set('_runtime_check', String(Date.now()));
  const response = await fetchImpl(url.href, {
    cache: 'no-store',
    headers: { Accept: 'application/json' }
  });
  if (!response?.ok) throw new Error(`version.json HTTP ${response?.status || 0}`);
  const manifest = await response.json();
  const latestBuild = String(manifest?.build || '').trim();
  return Object.freeze({
    loadedBuild,
    latestBuild,
    stale: Boolean(loadedBuild && latestBuild && loadedBuild !== latestBuild),
    manifest: Object.freeze({ ...manifest })
  });
}

export function showStaleBuildNotice(result, {
  documentRef = globalThis.document,
  locationRef = globalThis.location
} = {}) {
  if (!result?.stale || !documentRef?.createElement) return null;
  const existing = documentRef.getElementById?.('runtime-build-stale-notice');
  if (existing) return existing;
  const notice = documentRef.createElement('aside');
  notice.id = 'runtime-build-stale-notice';
  notice.setAttribute('role', 'alert');
  notice.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483647;max-width:min(92vw,720px);padding:12px 14px;border:1px solid #eb613f;border-radius:8px;background:rgba(20,16,14,.97);color:#f4eee5;box-shadow:0 8px 30px rgba(0,0,0,.45);font:13px/1.55 system-ui,sans-serif;display:flex;align-items:center;gap:12px;';
  const message = documentRef.createElement('span');
  message.textContent = `测试站已有新版本（当前 ${result.loadedBuild || '未知'}，最新 ${result.latestBuild || '未知'}）。请刷新后再验证预设适配。`;
  const refresh = documentRef.createElement('button');
  refresh.type = 'button';
  refresh.textContent = '立即刷新';
  refresh.style.cssText = 'flex:none;border:1px solid #eb613f;border-radius:5px;background:#eb613f;color:white;padding:6px 12px;cursor:pointer;';
  refresh.addEventListener('click', () => locationRef?.reload?.());
  notice.append(message, refresh);
  (documentRef.body || documentRef.documentElement)?.appendChild(notice);
  return notice;
}
