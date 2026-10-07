import { isTauri } from '../db/open';

/**
 * In the desktop app requests go through tauri-plugin-http (Rust side), which avoids
 * browser CORS rules for the webview's tauri:// origin. In the browser preview and in
 * Node tests the global fetch is used.
 */
export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri()) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, init);
  }
  return fetch(url, init);
}
