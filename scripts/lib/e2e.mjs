// Shared helpers for the browser E2E scripts (scripts/*-e2e.mjs).
// - Always forces quality=low so fresh contexts skip the startup benchmark and
//   stay on the 192x192 grid.
// - E2E_RENDER=0 opts into ?norender&fast when no screenshots are requested.
//   This skips continuous SwiftShader WebGL draws while keeping CPU picking,
//   camera matrices, the sim worker, sync, and UI live.
// - When invoked through scripts/run-e2e.mjs, connects to a shared Chromium
//   server via E2E_WS_ENDPOINT instead of launching a new browser per script.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export async function loadPlaywright() {
  try {
    return require('playwright');
  } catch {
    return await import('playwright');
  }
}

export const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

export async function openBrowser() {
  const { chromium } = await loadPlaywright();
  const ws = process.env.E2E_WS_ENDPOINT;
  if (ws) {
    const browser = await chromium.connect(ws);
    const contexts = [];
    const origNewContext = browser.newContext.bind(browser);
    browser.newContext = async (...args) => {
      const ctx = await origNewContext(...args);
      contexts.push(ctx);
      return ctx;
    };
    const origNewPage = browser.newPage.bind(browser);
    browser.newPage = async (...args) => {
      const page = await origNewPage(...args);
      contexts.push(page.context());
      return page;
    };
    return {
      browser,
      async close() {
        await Promise.all(contexts.map((c) => c.close().catch(() => {})));
        await browser.close();
      },
    };
  }
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  return { browser, close: () => browser.close() };
}

/**
 * Set low quality by default. E2E_RENDER=0 enables the faster test path
 * when screenshots are disabled.
 */
export function e2eUrl(base, query = 'nointro&fixedres&seed=1&nofinds', { shots = false } = {}) {
  const parts = query.replace(/^\?/, '').split('&').filter(Boolean);
  const has = (k) => parts.some((p) => p === k || p.startsWith(`${k}=`));
  if (!has('quality')) parts.push('quality=low');
  if (!shots && process.env.E2E_RENDER === '0') {
    if (!has('norender')) parts.push('norender');
    if (!has('fast')) parts.push('fast');
  }
  return `${base}?${parts.join('&')}`;
}
