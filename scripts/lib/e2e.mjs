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

const pageEvents = new WeakMap();

function observePage(page) {
  if (pageEvents.has(page)) return;
  const events = [];
  pageEvents.set(page, events);
  const record = (message) => {
    events.push(message);
    if (events.length > 15) events.shift();
  };
  page.on('pageerror', (error) => record(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') record(message.text());
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    record(`${request.method()} ${url.pathname}: ${request.failure()?.errorText}`);
  });
  page.on('response', (response) => {
    const type = response.request().resourceType();
    if (type === 'document' || type === 'script' || response.status() >= 500) {
      record(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on('worker', (worker) => record(`Worker started: ${new URL(worker.url()).pathname}`));
  page.on('crash', () => record('Page crashed'));
}

export async function waitForApp(page, timeout = 30000) {
  try {
    // A background tab can stop advancing animation frames while it boots.
    const ready = await page.waitForFunction(
      () => document.body?.dataset.ready === '1' || document.body?.dataset.bootError === '1',
      null,
      { polling: 100, timeout },
    );
    await ready.dispose();
    if (await page.locator('body[data-boot-error="1"]').count()) {
      throw new Error(await page.locator('body').innerText());
    }
  } catch (error) {
    const events = pageEvents.get(page) ?? [];
    const location = new URL(page.url());
    throw new Error(`App did not start at ${location.origin}${location.pathname}${events.length ? '\n' + events.join('\n') : ''}`, { cause: error });
  }
}

export async function openBrowser() {
  const { chromium } = await loadPlaywright();
  const ws = process.env.E2E_WS_ENDPOINT;
  const launch = { args: CHROMIUM_ARGS, executablePath: process.env.E2E_CHROMIUM_PATH };
  const browser = ws ? await chromium.connect(ws) : await chromium.launch(launch);
  const contexts = new Set();
  const observeContext = (context) => {
    contexts.add(context);
    context.on('page', observePage);
    context.once('close', () => contexts.delete(context));
  };
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...args) => {
    const context = await newContext(...args);
    observeContext(context);
    return context;
  };
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    observeContext(page.context());
    observePage(page);
    return page;
  };
  return {
    browser,
    async close() {
      await Promise.allSettled([...contexts].map((context) => context.close()));
      await browser.close();
    },
  };
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
