// Shared helpers for the browser E2E scripts (scripts/*-e2e.mjs).
// - Always forces quality=low so fresh contexts skip the startup benchmark and
//   stay on the 192x192 grid.
// - No screenshots asked for (no first argument, the scripts' screenshot
//   directory): ?norender&fast by default. This skips continuous SwiftShader
//   WebGL draws while keeping CPU picking, camera matrices, the sim worker,
//   sync, and UI live. On a CPU-only machine those draws starve the page:
//   a second device's sign-in took ~27 s instead of ~0.6 s, which is what
//   made the "flaky" timeouts. E2E_RENDER=1 draws anyway; E2E_RENDER=0 never
//   draws (even with a screenshot directory).
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
  // waitForFunction defaults to polling on requestAnimationFrame, but the
  // app's frame loop stalls when rendering is off (E2E_RENDER=0 adds
  // ?norender&fast, which skips continuous WebGL draws): only a handful of
  // frames fire in 10 s, so a wait whose condition already holds still times
  // out. Poll on an interval instead, unless the caller asked for a mode.
  // (waitForApp below already used polling: 100 for the same reason.)
  const origWaitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = (fn, arg, options) => origWaitForFunction(fn, arg, { polling: 100, ...(options ?? {}) });
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

// Navigations and boots are slow on the software renderer: a goto after
// an import (new grid depth, renderer resize, service worker in the way)
// took 62 s to commit once, and a cold boot can take most of a minute.
// The defaults below are for this runner, not for a real device.
const NAV_TIMEOUT = 120000;

async function waitForApp(page, timeout = 60000) {
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

/** Give a new WebGL context time to start before resuming the other tabs. */
async function navigateApp(page, url, navigate, timeout) {
  const paused = [];
  try {
    if (!new URL(url).searchParams.has('norender')) {
      const others = page.context().browser()?.contexts().flatMap((context) => context.pages()) ?? [];
      await Promise.all(others.filter((other) => other !== page && !other.isClosed()).map(async (other) => {
        const wasRunning = await other.evaluate(() => {
          const engine = window.__beech?.engine;
          if (!engine || engine.skipFrameRender) return false;
          engine.skipFrameRender = true;
          return true;
        });
        if (wasRunning) paused.push(other);
      }));
    }
    await navigate();
    await waitForApp(page, timeout);
  } finally {
    await Promise.allSettled(paused.map((other) => other.evaluate(() => {
      if (window.__beech?.engine) window.__beech.engine.skipFrameRender = false;
    })));
  }
}

export function openApp(page, url, timeout) {
  return navigateApp(page, url, () => page.goto(url, { waitUntil: 'commit', timeout: NAV_TIMEOUT }), timeout);
}

export function reloadApp(page) {
  return navigateApp(page, page.url(), () => page.reload({ waitUntil: 'commit', timeout: NAV_TIMEOUT }));
}

export async function openBrowser() {
  const { chromium } = await loadPlaywright();
  const ws = process.env.E2E_WS_ENDPOINT;
  const launch = { args: CHROMIUM_ARGS, executablePath: process.env.E2E_CHROMIUM_PATH };
  const browser = ws ? await chromium.connect(ws) : await chromium.launch(launch);
  const contexts = new Set();
  const observeContext = (context) => {
    if (contexts.has(context)) return;
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

/** Draw frames? Only for screenshots (a first argument), unless E2E_RENDER says otherwise. */
export function e2eRenders(shots = false) {
  if (process.env.E2E_RENDER === '1') return true;
  if (process.env.E2E_RENDER === '0') return false;
  return shots || Boolean(process.argv[2]);
}

/**
 * Set low quality by default, and the faster no-draw path unless the script
 * takes screenshots (e2eRenders).
 */
export function e2eUrl(base, query = 'nointro&fixedres&seed=1&nofinds', { shots = false } = {}) {
  const parts = query.replace(/^\?/, '').split('&').filter(Boolean);
  const has = (k) => parts.some((p) => p === k || p.startsWith(`${k}=`));
  if (!has('quality')) parts.push('quality=low');
  if (!e2eRenders(shots)) {
    if (!has('norender')) parts.push('norender');
    if (!has('fast')) parts.push('fast');
  }
  return `${base}?${parts.join('&')}`;
}
