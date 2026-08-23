const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { get } = require('node:http');
const { join, resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(__dirname, '..');
const startServices = process.env.MANIFOLD_START_SERVICES !== '0';
const corePort = process.env.MANIFOLD_CORE_PORT ?? '18081';
const webPort = process.env.MANIFOLD_WEB_PORT ?? '13001';
const adminPort = process.env.MANIFOLD_ADMIN_PORT ?? '15174';
const coreUrl = process.env.MANIFOLD_CORE_URL ?? `http://127.0.0.1:${corePort}`;
const webUrl = process.env.MANIFOLD_WEB_URL ?? `http://127.0.0.1:${webPort}`;
const adminUrl = process.env.MANIFOLD_ADMIN_URL ?? `http://127.0.0.1:${adminPort}`;
const contentPath = process.env.MANIFOLD_CONTENT_PATH ?? '/writing/designing-boundaries';
const username = process.env.MANIFOLD_ADMIN_USERNAME ?? 'admin';
const password = process.env.MANIFOLD_ADMIN_PASSWORD ?? 'password';
const testPasswordHash = '$2a$04$cBGlIsF54naKZob1XF7AOOoNHedqhmrHMXcgNd7p1Phvn24o3CF2m';
const chromePath = process.env.MANIFOLD_CHROME_PATH;
const children = [];
let temporaryDirectory;

if (!startServices && process.env.MANIFOLD_ALLOW_EXTERNAL_MUTATIONS !== '1') {
  throw new Error('External service mode mutates Core. Set MANIFOLD_ALLOW_EXTERNAL_MUTATIONS=1 explicitly.');
}

function spawnService(command, args, cwd, environment) {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  const collect = (chunk) => { output.push(chunk.toString()); if (output.length > 40) output.shift(); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.getRecentOutput = () => output.join('');
  children.push(child);
  return child;
}

function waitForUrl(url, timeout = 45_000) {
  const started = Date.now();
  return new Promise((resolveReady, reject) => {
    const poll = () => {
      const request = get(url, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) {
          resolveReady();
          return;
        }
        retry();
      });
      request.on('error', retry);
      request.setTimeout(2_000, () => { request.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeout) reject(new Error(`Timed out waiting for ${url}`));
      else setTimeout(poll, 250);
    };
    poll();
  });
}

async function stopServices() {
  for (const child of children.reverse()) {
    if (!child.killed) child.kill('SIGTERM');
  }
  await new Promise((resolveDone) => setTimeout(resolveDone, 500));
  for (const child of children) {
    if (!child.killed) child.kill('SIGKILL');
  }
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

function coreResponse(response, path, method, status) {
  const url = new URL(response.url());
  return url.origin === coreUrl && url.pathname === path && response.request().method() === method && response.status() === status;
}

async function main() {
  process.on('SIGINT', () => { void stopServices().finally(() => process.exit(130)); });
  process.on('SIGTERM', () => { void stopServices().finally(() => process.exit(143)); });
  if (startServices) {
    temporaryDirectory = mkdtempSync(join('/tmp', 'manifold-browser-'));
    spawnService('go', ['run', './cmd/server'], join(root, 'app/core'), {
      CORE_ADDR: `:${corePort}`,
      CORE_DATABASE_PATH: join(temporaryDirectory, 'manifold.db'),
      CORE_ALLOWED_ORIGINS: `${webUrl},${adminUrl}`,
      CORE_ADMIN_PASSWORD_HASH: process.env.CORE_ADMIN_PASSWORD_HASH ?? testPasswordHash,
    });
    spawnService('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', webPort], join(root, 'app/web'), {
      NEXT_PUBLIC_CORE_URL: coreUrl,
      NEXT_PUBLIC_SITE_URL: webUrl,
    });
    spawnService('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', adminPort], join(root, 'app/admin'), {
      VITE_CORE_URL: coreUrl,
    });
    await waitForUrl(`${coreUrl}/healthz`);
    await waitForUrl(`${webUrl}${contentPath}`);
    await waitForUrl(adminUrl);
  }

  const browserOptions = { headless: true, args: ['--no-sandbox', '--disable-gpu'] };
  if (chromePath) browserOptions.executablePath = chromePath;
  const browser = await chromium.launch(browserOptions);
  try {
    const web = await browser.newPage();
    const webErrors = [];
    web.on('console', (message) => { if (message.type() === 'error') webErrors.push(`console:${message.text()}`); });
    web.on('pageerror', (error) => webErrors.push(`pageerror:${error.message}`));
    await web.goto(`${webUrl}${contentPath}`, { waitUntil: 'networkidle' });
    const webControlCounts = {
      inputs: await web.locator('input').count(),
      textareas: await web.locator('textarea').count(),
      sendButtons: await web.getByRole('button', { name: 'Send for review' }).count(),
      reactionButtons: await web.getByRole('button', { name: /like|favorite/i }).count(),
    };
    if (webControlCounts.sendButtons !== 1 || webControlCounts.reactionButtons !== 2) throw new Error('Web controls are incomplete');

    const likeResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/reactions/LIKE', 'PUT', 200));
    await web.getByRole('button', { name: 'Add like' }).click();
    await likeResponse;
    const favoriteResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/reactions/FAVORITE', 'PUT', 200));
    await web.getByRole('button', { name: 'Add favorite' }).click();
    await favoriteResponse;

    const commentBody = `Browser acceptance ${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await web.locator('textarea').fill(commentBody);
    const commentResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/comments', 'POST', 201));
    await web.getByRole('button', { name: 'Send for review' }).click();
    await commentResponse;
    await web.getByText('Awaiting review').waitFor({ state: 'visible', timeout: 5000 });

    const admin = await browser.newPage();
    const adminErrors = [];
    admin.on('console', (message) => { if (message.type() === 'error') adminErrors.push(`console:${message.text()}`); });
    admin.on('pageerror', (error) => adminErrors.push(`pageerror:${error.message}`));
    await admin.goto(adminUrl, { waitUntil: 'networkidle' });
    const adminControlCounts = {
      username: await admin.getByLabel('Username').count(),
      password: await admin.locator('input[type="password"]').count(),
      submit: await admin.getByRole('button', { name: 'Enter workspace' }).count(),
    };
    if (adminControlCounts.username !== 1 || adminControlCounts.password !== 1 || adminControlCounts.submit !== 1) throw new Error('Admin login controls are incomplete');
    await admin.getByLabel('Username').fill(username);
    await admin.locator('input[type="password"]').fill(password);
    const loginResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/session', 'POST', 200));
    const statsResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/stats', 'GET', 200));
    await admin.getByRole('button', { name: 'Enter workspace' }).click();
    await loginResponse;
    await statsResponse;
    await admin.getByText('Good morning, operator.').waitFor({ state: 'visible', timeout: 5000 });
    const commentsResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await admin.getByRole('button', { name: 'Comments' }).click();
    await commentsResponse;
    await admin.getByText('Keep the conversation kind.').waitFor({ state: 'visible', timeout: 5000 });
    const targetRow = admin.locator('.moderation-row').filter({ hasText: commentBody });
    await targetRow.waitFor({ state: 'visible', timeout: 5000 });
    const approveResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+\/approve$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST' && response.status() === 204);
    const refreshedComments = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await targetRow.getByRole('button', { name: 'Approve comment from Anonymous' }).click();
    await approveResponse;
    await refreshedComments;
    await targetRow.waitFor({ state: 'detached', timeout: 5000 });
    await admin.getByText('0 pending').waitFor({ state: 'visible', timeout: 5000 });
    if (await admin.locator('.moderation-row').count() !== 0) throw new Error('Unexpected pre-existing moderation rows remain');
    if (webErrors.length || adminErrors.length) throw new Error(JSON.stringify({ webErrors, adminErrors }));
    console.log(JSON.stringify({ webControlCounts, adminControlCounts, webErrors, adminErrors }));
  } finally {
    await browser.close();
    await stopServices();
  }
}

main().catch(async (error) => { console.error(error); await stopServices(); process.exitCode = 1; });
