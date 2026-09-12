const { execSync, spawn } = require('node:child_process');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { get } = require('node:http');
const net = require('node:net');
const { join, resolve } = require('node:path');
const { chromium } = require('playwright');

const root = resolve(__dirname, '..');
const startServices = process.env.MANIFOLD_START_SERVICES !== '0';
let corePort = process.env.MANIFOLD_CORE_PORT;
let webPort = process.env.MANIFOLD_WEB_PORT;
let adminPort = process.env.MANIFOLD_ADMIN_PORT;
let coreUrl = process.env.MANIFOLD_CORE_URL;
let webUrl = process.env.MANIFOLD_WEB_URL;
let adminUrl = process.env.MANIFOLD_ADMIN_URL;
const contentPath = process.env.MANIFOLD_CONTENT_PATH ?? '/writing/designing-boundaries';
const username = process.env.MANIFOLD_ADMIN_USERNAME ?? 'admin';
const password = process.env.MANIFOLD_ADMIN_PASSWORD ?? 'password';
const testPasswordHash = '$2a$04$cBGlIsF54naKZob1XF7AOOoNHedqhmrHMXcgNd7p1Phvn24o3CF2m';
const chromePath = process.env.MANIFOLD_CHROME_PATH;
const children = [];
let temporaryDirectory;
// next dev syncs its distDir types into app/web/tsconfig.json. With a custom
// NEXT_DIST_DIR that rewrite points at the throwaway temp dir, so we back the
// file up before spawning and restore it on teardown to keep the worktree clean.
const webTsconfigPath = join(root, 'app/web/tsconfig.json');
let webTsconfigBackup = null;

if (!startServices && process.env.MANIFOLD_ALLOW_EXTERNAL_MUTATIONS !== '1') {
  throw new Error('External service mode mutates Core. Set MANIFOLD_ALLOW_EXTERNAL_MUTATIONS=1 explicitly.');
}

// A run must not inherit the developer's own Core/Web/Admin configuration: a
// shell with CORE_SEED_FILE, CORE_ENV or a stale CORE_ADMIN_PASSWORD_HASH set
// would silently change what this fixture exercises, and the resulting failures
// would look like product bugs. Only these three prefixes are dropped —
// everything else (PATH, HOME, …) has to survive for the children to start.
// Each spawn below re-supplies the values it needs explicitly.
const SERVICE_ENV_PREFIXES = ['CORE_', 'NEXT_PUBLIC_', 'VITE_'];

function serviceEnvironment(environment) {
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !SERVICE_ENV_PREFIXES.some((prefix) => key.startsWith(prefix))
  )));
  return { ...inherited, ...environment };
}

function spawnService(command, args, cwd, environment) {
  const child = spawn(command, args, { cwd, detached: true, env: serviceEnvironment(environment), stdio: ['ignore', 'pipe', 'pipe'] });
  const output = [];
  const collect = (chunk) => { output.push(chunk.toString()); if (output.length > 40) output.shift(); };
  child.stdout.on('data', collect);
  child.stderr.on('data', collect);
  child.getRecentOutput = () => output.join('');
  children.push(child);
  return child;
}

function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('Could not determine an available local port'));
        return;
      }
      server.close((error) => error ? reject(error) : resolvePort(String(address.port)));
    });
  });
}

function waitForUrl(url, timeout = 90_000) {
  const started = Date.now();
  return new Promise((resolveReady, reject) => {
    const poll = () => {
      const request = get(url, (response) => {
        response.resume();
        // 4xx is not "ready": the three probes below are `/healthz`, a real
        // content route and the Admin index, and a 404 used to satisfy this
        // check while the service it probed was plainly broken. Redirects still
        // count (Next dev may answer with one), server errors do not.
        if (response.statusCode && response.statusCode < 400) {
          resolveReady();
          return;
        }
        retry();
      });
      request.on('error', retry);
      request.setTimeout(2_000, () => { request.destroy(); retry(); });
    };
    const retry = () => {
      if (Date.now() - started > timeout) {
        const diagnostics = children.map((child) => child.getRecentOutput?.()).filter(Boolean).join("\n--- service ---\n");
        reject(new Error(`Timed out waiting for ${url}${diagnostics ? `\nService output:\n${diagnostics}` : ""}`));
      }
      else setTimeout(poll, 250);
    };
    poll();
  });
}

async function stopServices() {
  // Only the process groups this run spawned are ours to reap. Children are
  // spawned detached (process-group leaders), so killing each group covers go
  // run's compiled server and next/vite descendants. Never lsof-kill a port:
  // the developer may be serving their own instance on 3000/8080/5173, and a
  // port-sweeping kill would take that process down with the test run.
  for (const child of children.slice().reverse()) {
    if (child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  await new Promise((resolveDone) => setTimeout(resolveDone, 1_000));
  for (const child of children) {
    if (child.pid && child.exitCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  if (webTsconfigBackup !== null) {
    try { writeFileSync(webTsconfigPath, webTsconfigBackup); } catch { /* leave it; next run backs up again */ }
  }
}

function coreResponse(response, path, method, status) {
  const url = new URL(response.url());
  return url.origin === coreUrl && url.pathname === path && response.request().method() === method && response.status() === status;
}

async function closeBrowser(browser) {
  await Promise.race([browser.close(), new Promise((resolveDone) => setTimeout(resolveDone, 5_000))]).catch(() => undefined);
  try { browser.process()?.kill('SIGKILL'); } catch { /* process already gone */ }
}

process.on('unhandledRejection', (reason) => {
  console.error(reason);
  void stopServices().finally(() => { process.exitCode = 1; });
});

async function main() {
  process.on('SIGINT', () => { void stopServices().finally(() => process.exit(130)); });
  process.on('SIGTERM', () => { void stopServices().finally(() => process.exit(143)); });
  if (startServices) {
    webTsconfigBackup = readFileSync(webTsconfigPath, 'utf8');
    corePort ??= await freePort();
    webPort ??= await freePort();
    adminPort ??= await freePort();
    coreUrl ??= `http://127.0.0.1:${corePort}`;
    webUrl ??= `http://127.0.0.1:${webPort}`;
    adminUrl ??= `http://127.0.0.1:${adminPort}`;
    temporaryDirectory = mkdtempSync(join('/tmp', 'manifold-browser-'));
    execSync(`node ${JSON.stringify(join(root, 'app/admin/scripts/sync-vditor.mjs'))}`);
    spawnService('go', ['run', './cmd/server'], join(root, 'app/core'), {
      CORE_ADDR: `:${corePort}`,
      CORE_DATABASE_PATH: join(temporaryDirectory, 'manifold.db'),
      CORE_ALLOWED_ORIGINS: `${webUrl},${adminUrl}`,
      CORE_ADMIN_PASSWORD_HASH: process.env.CORE_ADMIN_PASSWORD_HASH ?? testPasswordHash,
    });
    spawnService('pnpm', ['exec', 'next', 'dev', '--hostname', '127.0.0.1', '--port', webPort], join(root, 'app/web'), {
      // Isolate this instance's .next dev lock so it never collides with a
      // developer's own `pnpm dev` running in the same directory.
      NEXT_DIST_DIR: join(temporaryDirectory, 'web-dist'),
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
    await web.setViewportSize({ width: 1440, height: 1000 });
    await web.goto(webUrl, { waitUntil: 'networkidle' });
    await web.getByRole('heading', { name: 'Writings and thoughts' }).waitFor({ state: 'visible' });
    await web.getByRole('heading', { name: 'My Series' }).waitFor({ state: 'visible' });
    await web.getByRole('contentinfo').getByText(/\d+ readers online/).waitFor({ state: 'visible', timeout: 5000 });
    if (await web.locator('[data-manifold-physics]').count() !== 1) throw new Error('Manifold physics canvas is missing');
    const firstMetadataMarker = web.locator('[data-metadata-marker]').first();
    await firstMetadataMarker.hover();
    const metadataPreview = firstMetadataMarker.locator('[data-metadata-preview]');
    await metadataPreview.waitFor({ state: 'visible' });
    if (!(await metadataPreview.textContent())?.includes('Profile')) throw new Error('Mini-map preview does not identify its section');
    const repl = web.locator('[data-floating-repl]');
    await repl.getByRole('button', { name: /Open command line/i }).click();
    const replDialog = repl.getByRole('dialog');
    await replDialog.waitFor({ state: 'visible' });
    const replInput = replDialog.getByRole('textbox', { name: 'Command line' });
    await replInput.fill('whoami');
    await replInput.press('Enter');
    if (!(await replDialog.locator('[data-repl-output]').last().textContent())?.includes('Manifold')) throw new Error('REPL whoami command did not return the profile');
    await replInput.fill('papers');
    await replInput.press('Enter');
    if ((await replDialog.locator('[data-repl-output]').last().textContent())?.includes('No papers')) throw new Error('REPL papers command returned an empty result unexpectedly');
    await replInput.fill('ascii');
    await replInput.press('Enter');
    if (!(await replDialog.locator('[data-repl-output]').last().textContent())?.includes('manifold runtime initialized')) throw new Error('REPL ASCII easter egg did not return its output');
    await replDialog.getByRole('button', { name: /Close command line/i }).click();
    await web.keyboard.press('Control+j');
    await repl.getByRole('dialog').waitFor({ state: 'visible' });
    await repl.getByRole('button', { name: /Close command line/i }).click();
    const canvasMetrics = await web.evaluate(() => {
      const canvas = document.querySelector('[data-manifold-physics]');
      if (!(canvas instanceof HTMLCanvasElement)) return { width: 0, height: 0, energy: 0 };
      const context = canvas.getContext('2d');
      if (!context) return { width: canvas.width, height: canvas.height, energy: 0 };
      const sample = context.getImageData(0, 0, Math.min(canvas.width, 320), Math.min(canvas.height, 180)).data;
      return { width: canvas.width, height: canvas.height, energy: sample.reduce((total, value) => total + value, 0) };
    });
    if (!canvasMetrics.width || !canvasMetrics.height || canvasMetrics.energy === 0) throw new Error(`Manifold physics canvas is blank: ${JSON.stringify(canvasMetrics)}`);
    const seriesCard = web.locator('[data-series-card]').first();
    await seriesCard.waitFor({ state: 'visible' });
    await seriesCard.hover();
    const seriesTooltip = web.locator('[data-series-tooltip]');
    await seriesTooltip.waitFor({ state: 'visible' });
    const seriesTooltipText = await seriesTooltip.textContent();
    if (!seriesTooltipText?.includes('API relay') || !seriesTooltipText.includes('Infrastructure') || !seriesTooltipText.includes('api.weizixiang.dev')) {
      throw new Error(`My Series tooltip is missing complete content: ${seriesTooltipText}`);
    }
    const seriesCardGeometry = await seriesCard.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const tooltip = document.querySelector('[data-series-tooltip]');
      const tooltipStyle = tooltip ? getComputedStyle(tooltip) : null;
      const tooltipRect = tooltip?.getBoundingClientRect();
      return { height: rect.height, tooltipVisible: Boolean(tooltipRect && tooltipRect.width > 0 && tooltipRect.height > 0), tooltipLayer: tooltipStyle?.zIndex ?? '' };
    });
    if (seriesCardGeometry.height > 150 || !seriesCardGeometry.tooltipVisible || seriesCardGeometry.tooltipLayer !== '1000') {
      throw new Error(`My Series card is not compact or its tooltip is hidden: ${JSON.stringify(seriesCardGeometry)}`);
    }
    const githubContact = web.locator('[data-contact-item][aria-label="GitHub"]');
    await githubContact.hover();
    const contactTooltip = web.locator('[data-contact-tooltip]');
    await contactTooltip.waitFor({ state: 'visible' });
    const contactTooltipText = await contactTooltip.textContent();
    if (!contactTooltipText?.includes('GitHub') || !contactTooltipText.includes('manifold-space')) {
      throw new Error(`Contact tooltip is missing contact details: ${contactTooltipText}`);
    }
    const contactGeometry = await githubContact.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const tooltip = document.querySelector('[data-contact-tooltip]');
      const tooltipRect = tooltip?.getBoundingClientRect();
      const linkId = element.getAttribute('aria-describedby');
      return {
        width: rect.width,
        height: rect.height,
        tooltipInViewport: Boolean(tooltipRect && tooltipRect.left >= 0 && tooltipRect.right <= window.innerWidth && tooltipRect.top >= 0 && tooltipRect.bottom <= window.innerHeight),
        tooltipLayer: tooltip ? getComputedStyle(tooltip).zIndex : '',
        describedByResolved: Boolean(linkId && document.getElementById(linkId)),
      };
    });
    if (contactGeometry.width !== 42 || contactGeometry.height !== 42 || !contactGeometry.tooltipInViewport || contactGeometry.tooltipLayer !== '1000' || !contactGeometry.describedByResolved) {
      throw new Error(`Contact icon rail or tooltip layering is incorrect: ${JSON.stringify(contactGeometry)}`);
    }
    await web.mouse.move(20, 20);
    const surfaceStyles = await web.evaluate(() => [...document.querySelectorAll('[data-content-surface], [data-update-rail], [data-series-card], [data-background-surface]')].map((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, backdropFilter: style.backdropFilter };
    }));
    if (!surfaceStyles.length || !surfaceStyles.some(({ backgroundColor }) => backgroundColor !== 'rgba(0, 0, 0, 0)')) {
      throw new Error(`Content surfaces are not isolating text from the particle field: ${JSON.stringify(surfaceStyles)}`);
    }
    const metadataStyles = await web.evaluate(() => {
      const metadata = document.querySelector('[data-minimal-metadata]');
      const canvas = document.querySelector('.backgroundCanvas');
      const markers = [...document.querySelectorAll('[data-metadata-marker]')];
      const metadataStyle = metadata ? getComputedStyle(metadata) : null;
      const canvasStyle = canvas ? getComputedStyle(canvas) : null;
      return {
        visible: Boolean(metadata && metadataStyle?.display !== 'none'),
        markerCount: markers.length,
        maskImage: canvasStyle?.maskImage ?? '',
        webkitMaskImage: canvasStyle?.webkitMaskImage ?? '',
      };
    });
    if (!metadataStyles.visible || metadataStyles.markerCount < 4 || (!metadataStyles.maskImage.includes('linear-gradient') && !metadataStyles.webkitMaskImage.includes('linear-gradient'))) {
      throw new Error(`Minimal metadata or particle vignette is missing: ${JSON.stringify(metadataStyles)}`);
    }
    await web.locator('[data-metadata-marker][href="#updates-section"]').click();
    if (!web.url().endsWith('#updates-section')) throw new Error(`Section marker did not navigate to Updates: ${web.url()}`);
    const updateNodes = web.locator('[data-update-node]');
    const updateNodeCount = await updateNodes.count();
    if (updateNodeCount < 1 || updateNodeCount > 10) throw new Error(`Expected 1-10 home update nodes, received ${updateNodeCount}`);
    if (await web.locator('[data-update-month]').count() < 1) throw new Error('Home update timeline has no month markers');
    const firstUpdate = updateNodes.first();
    await firstUpdate.hover();
    await firstUpdate.locator('[data-update-preview]').waitFor({ state: 'visible' });
    if (await firstUpdate.locator('[data-update-preview] a').count() < 1) throw new Error('Update preview does not list individual updates');
    const timelineGeometry = await web.evaluate(() => {
      const rail = document.querySelector('[data-update-rail]');
      const line = document.querySelector('[data-update-track-line]');
      const firstNode = document.querySelector('[data-update-node]');
      const pseudo = firstNode?.parentElement;
      const firstDate = firstNode?.querySelector('[data-update-date]');
      const firstDot = firstNode?.querySelector('[data-update-dot]');
      const lineRect = line?.getBoundingClientRect();
      const railStyle = rail ? getComputedStyle(rail) : null;
      const pseudoStyle = pseudo ? getComputedStyle(pseudo, '::before') : null;
      const dateRect = firstDate?.getBoundingClientRect();
      const dotRect = firstDot?.getBoundingClientRect();
      return {
        lineCount: document.querySelectorAll('[data-update-track-line]').length,
        lineWidth: lineRect?.width ?? 0,
        railBorderTop: railStyle?.borderTopWidth ?? '',
        pseudoDisplay: pseudoStyle?.display ?? '',
        dateBelowDot: Boolean(dateRect && dotRect && dateRect.top >= dotRect.bottom),
      };
    });
    if (timelineGeometry.lineCount !== 1 || timelineGeometry.pseudoDisplay !== 'none' || timelineGeometry.railBorderTop !== '1px') {
      throw new Error(`Updates timeline should have one track line: ${JSON.stringify(timelineGeometry)}`);
    }
    if (!timelineGeometry.dateBelowDot) throw new Error(`Update date should be below its point: ${JSON.stringify(timelineGeometry)}`);
    await firstUpdate.locator('[data-update-trigger]').click();
    await firstUpdate.locator('[data-update-preview]').waitFor({ state: 'visible' });
    await web.locator('[data-update-rail]').hover({ position: { x: 10, y: 10 } });
    const previewStyle = await firstUpdate.locator('[data-update-preview]').evaluate((element) => {
      const style = getComputedStyle(element);
      return { pointerEvents: style.pointerEvents, overflowY: style.overflowY, maxHeight: style.maxHeight };
    });
    if (previewStyle.pointerEvents !== 'auto' || previewStyle.overflowY !== 'auto' || previewStyle.maxHeight === 'none') {
      throw new Error(`Pinned update preview is not interactive/scrollable: ${JSON.stringify(previewStyle)}`);
    }
    const updateLink = firstUpdate.locator('[data-update-preview] a').first();
    const updateHref = await updateLink.getAttribute('href');
    if (!updateHref) throw new Error('Update preview link has no href');
    await updateLink.click();
    await web.waitForURL((url) => url.pathname === updateHref);
    await web.goto(webUrl, { waitUntil: 'networkidle' });
    await web.getByRole('heading', { name: 'Writings and thoughts' }).waitFor({ state: 'visible' });
    if (await web.locator('[data-timeline-pin]').filter({ hasText: /\d/ }).count()) throw new Error('Recent content timeline pins still contain overlapping numbers');
    const desktopOverflow = await web.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (desktopOverflow) throw new Error('Home page overflows horizontally at desktop width');

    await web.setViewportSize({ width: 390, height: 844 });
    await web.reload({ waitUntil: 'networkidle' });
    if (await web.locator('[data-minimal-metadata]').evaluate((element) => getComputedStyle(element).display) !== 'none') throw new Error('Minimal metadata should be hidden on mobile');
    const mobileOverflow = await web.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (mobileOverflow) {
      const overflowDetails = await web.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        elements: [...document.querySelectorAll('*')].map((element) => {
          const rect = element.getBoundingClientRect();
          return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', left: rect.left, right: rect.right, width: rect.width };
        }).filter((element) => element.left < -1 || element.right > document.documentElement.clientWidth + 1).slice(0, 12),
      }));
      throw new Error(`Home page overflows horizontally at mobile width: ${JSON.stringify(overflowDetails)}`);
    }
    await web.getByRole('contentinfo').waitFor({ state: 'attached' });

    const adminSessionResponse = await fetch(`${coreUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (!adminSessionResponse.ok) throw new Error(`Admin session for archive checks failed: ${adminSessionResponse.status}`);
    const { accessToken: archiveToken } = await adminSessionResponse.json();
    const probeResponse = await fetch(`${coreUrl}/api/v1/admin/content`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${archiveToken}` }, body: JSON.stringify({ kind: 'THOUGHT', slug: 'archive-filter-probe', title: 'Archive filter probe', summary: 'Probe for archive filters.', body: 'A probe thought exercising archive filters.', tags: ['notes'], metadata: { mood: null, question: null, context: null, source: null } }) });
    if (!probeResponse.ok) throw new Error(`Probe thought creation failed: ${probeResponse.status}`);
    const probe = await probeResponse.json();
    const probePublish = await fetch(`${coreUrl}/api/v1/admin/content/${probe.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${archiveToken}` } });
    if (!probePublish.ok) throw new Error(`Probe thought publish failed: ${probePublish.status}`);
    for (let index = 0; index < 10; index += 1) {
      const fillerResponse = await fetch(`${coreUrl}/api/v1/content/designing-boundaries/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ authorName: `Filler ${index + 1}`, body: `Pagination filler comment ${index + 1}.` }) });
      if (!fillerResponse.ok) throw new Error(`Filler comment creation failed: ${fillerResponse.status}`);
    }

    // 1x1 red PNG upload used by the media rendering checks below
    const probeImage = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const mediaUpload = await fetch(`${coreUrl}/api/v1/admin/media?filename=probe.png`, { method: 'POST', headers: { 'content-type': 'image/png', authorization: `Bearer ${archiveToken}` }, body: probeImage });
    if (!mediaUpload.ok) throw new Error(`Media upload failed: ${mediaUpload.status}`);
    const media = await mediaUpload.json();
    const mediaServed = await fetch(media.url);
    if (!mediaServed.ok || mediaServed.headers.get('content-type') !== 'image/png' || !mediaServed.headers.get('etag')) throw new Error(`Media serving failed: ${mediaServed.status}`);

    await web.setViewportSize({ width: 1280, height: 400 });
    await web.goto(`${webUrl}/writing`, { waitUntil: 'networkidle' });
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    const writingScrollHint = web.locator('[class*="scrollHint"]');
    await writingScrollHint.waitFor({ state: 'visible' });
    const writingRevealed = await web.locator('[class*="writingCollection"]').evaluate((el) => el.closest('[data-revealed]')?.getAttribute('data-revealed'));
    if (writingRevealed !== 'false') throw new Error('Writing list should stay hidden until manual scroll');
    await writingScrollHint.click();
    await writingScrollHint.waitFor({ state: 'detached' });
    await web.setViewportSize({ width: 1280, height: 900 });
    const writingSearch = web.getByRole('textbox', { name: 'Search writings' });
    await writingSearch.fill('boundary');
    await web.waitForURL((url) => url.searchParams.get('q') === 'boundary');
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    await writingSearch.fill('');
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /design \d/ }).click();
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /design \d/ }).click();
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    await web.getByLabel('Sort writings').selectOption('oldest');
    await web.getByRole('heading', { name: 'Designing Boundaries' }).waitFor({ state: 'visible' });

    const writingPickerTrigger = web.getByRole('button', { name: 'View all tags →' });
    const writingPickerPanel = web.getByRole('group', { name: 'View all tags →' });
    await writingPickerTrigger.click();
    await writingPickerPanel.getByRole('button', { name: /design \d/ }).click();
    await writingPickerPanel.getByRole('button', { name: /systems \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').join(',') === 'design,systems');
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    await web.getByRole('heading', { name: 'Writing', exact: true }).click();
    await writingPickerPanel.waitFor({ state: 'detached' });
    await web.getByRole('button', { name: /systems \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').join(',') === 'design');
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /design \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').length === 0);
    await web.locator('[class*="writingToolbar"]').getByText(/\d+ articles/).waitFor({ state: 'visible' });

    await web.setViewportSize({ width: 1280, height: 400 });
    await web.goto(`${webUrl}/thoughts`, { waitUntil: 'networkidle' });
    const thoughtCount = web.locator('[class*="thoughtSectionHeading"]').getByText(/\d+ notes/);
    await thoughtCount.waitFor({ state: 'visible' });
    const thoughtScrollHint = web.locator('[class*="scrollHint"]');
    await thoughtScrollHint.waitFor({ state: 'visible' });
    const thoughtRevealed = await web.locator('[class*="thoughtCollection"]').evaluate((el) => el.closest('[data-revealed]')?.getAttribute('data-revealed'));
    if (thoughtRevealed !== 'false') throw new Error('Thoughts list should stay hidden until manual scroll');
    await thoughtScrollHint.click();
    await thoughtScrollHint.waitFor({ state: 'detached' });
    await web.setViewportSize({ width: 1280, height: 900 });
    const thoughtSearch = web.getByRole('textbox', { name: 'Search thoughts' });
    await thoughtSearch.fill('probe');
    await web.waitForURL((url) => url.searchParams.get('q') === 'probe');
    await web.locator('[class*="thoughtSectionHeading"]').getByText('1 notes', { exact: true }).waitFor({ state: 'visible' });
    await thoughtSearch.fill('');
    await thoughtCount.waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /notes \d/ }).click();
    await web.locator('[class*="thoughtSectionHeading"]').getByText('1 notes', { exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /notes \d/ }).click();
    await thoughtCount.waitFor({ state: 'visible' });

    const thoughtPickerTrigger = web.getByRole('button', { name: 'View all tags', exact: true });
    const thoughtPickerPanel = web.getByRole('group', { name: 'View all tags' });
    await thoughtPickerTrigger.click();
    await thoughtPickerPanel.getByRole('button', { name: /thinking \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').join(',') === 'thinking');
    await thoughtCount.waitFor({ state: 'visible' });
    await web.getByRole('heading', { name: 'Thoughts', exact: true }).click();
    await thoughtPickerPanel.waitFor({ state: 'detached' });
    await web.getByRole('button', { name: /thinking \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').length === 0);
    await thoughtCount.waitFor({ state: 'visible' });

    await web.goto(`${webUrl}/thoughts/a-small-signal`, { waitUntil: 'networkidle' });
    await web.getByRole('heading', { name: 'A Small Signal' }).waitFor({ state: 'visible' });
    const thoughtReflection = await web.locator('[class*="thoughtReflection"]').textContent();
    if (!thoughtReflection?.includes('When is a system justified?')) throw new Error('Thought reflection quote is missing');
    const thoughtMood = await web.locator('[class*="thoughtMood"]').textContent();
    if (!thoughtMood?.includes('Curious')) throw new Error('Thought mood badge is missing');
    if (!(await web.locator('[class*="thoughtActions"]').first().textContent())?.includes('Likes')) throw new Error('Thought counts are missing');
    await web.getByRole('heading', { name: 'The thread' }).waitFor({ state: 'visible' });
    // the composer opens on the identity gate; pick Guest to reveal the visitor form
    await web.getByRole('button', { name: 'Guest', exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: 'Guest', exact: true }).click();
    await web.getByRole('button', { name: 'Post comment' }).waitFor({ state: 'visible' });
    if (await web.locator('[class*="avatarPickerTrigger"]').count() !== 1) throw new Error('Thought composer avatar picker is missing');
    // reading-shell blocks keep the thought thread column-aligned with the body
    await web.locator('.thoughtDetail .articleDiscussionBlock').waitFor({ state: 'visible', timeout: 5000 });
    await web.locator('.thoughtDetail .articleComposerBlock').waitFor({ state: 'visible', timeout: 5000 });

    await web.setViewportSize({ width: 1280, height: 900 });
    await web.goto(`${webUrl}${contentPath}`, { waitUntil: 'networkidle' });
    const commentToggle = web.locator('[data-compact="true"]').getByRole('button', { name: 'Comment', exact: true });
    const likeButtons = await web.getByRole('button', { name: /like/i }).count();
    if (likeButtons !== 1 || await commentToggle.count() !== 1) throw new Error('Web controls are incomplete');
    await commentToggle.click();
    await web.getByRole('button', { name: 'Guest', exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: 'Guest', exact: true }).click();
    await web.getByRole('button', { name: 'Post comment' }).waitFor({ state: 'visible' });
    if (await web.locator('[aria-label="Comment pages"]').count() !== 0) throw new Error('Comment pager should stay hidden on a single page');
    const webControlCounts = {
      inputs: await web.locator('input').count(),
      textareas: await web.locator('textarea').count(),
      sendButtons: await web.getByRole('button', { name: 'Post comment' }).count(),
      likeButtons,
    };

    const likeResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/likes', 'PUT', 200));
    await web.getByRole('button', { name: 'Add like' }).click();
    await likeResponse;
    const commentBody = `Browser acceptance ${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // the quick-check prompt is randomized per open, so parse the current one
    const solveCaptcha = async (scope) => {
      // getByLabel resolves to the input control; the prompt lives on the label itself.
      const label = scope.locator('label').filter({ hasText: /Quick check/ });
      await label.filter({ hasText: /\d+\s*\+\s*\d+/ }).waitFor({ state: 'visible', timeout: 5000 });
      const text = await label.textContent();
      const match = text?.match(/(\d+)\s*\+\s*(\d+)/);
      if (!match) throw new Error(`Could not parse captcha prompt: ${text}`);
      return String(Number(match[1]) + Number(match[2]));
    };
    await web.locator('textarea').fill(commentBody);
    await web.locator('[data-compact="true"]').getByLabel(/Quick check/).fill(await solveCaptcha(web.locator('[data-compact="true"]')));
    const commentResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/comments', 'POST', 201));
    const commentVeil = web.locator('[class*="commentSpinner"]').waitFor({ state: 'visible', timeout: 2000 });
    await web.getByRole('button', { name: 'Post comment' }).click();
    await commentVeil;
    await commentResponse;
    await web.getByText('Your comment has been posted.').waitFor({ state: 'visible', timeout: 5000 });
    const commentPager = web.locator('[aria-label="Comment pages"]');
    await commentPager.getByText('Page 2 of 2').waitFor({ state: 'visible', timeout: 5000 });
    const postedBubble = web.locator('[class*="commentBubble"]').filter({ hasText: commentBody }).first();
    await postedBubble.waitFor({ state: 'visible', timeout: 5000 });
    await web.getByRole('button', { name: 'View your comment' }).click();
    await postedBubble.waitFor({ state: 'visible', timeout: 5000 });
    await web.getByRole('button', { name: 'Comment again' }).click();
    // View your comment scrolled up past the activation line, which unmounts the
    // bottom composer; scroll back to the end so the editor reappears.
    await web.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }));
    await web.waitForTimeout(1000);
    // the remount lands on the sign-in gate, so accept guest mode again
    await web.getByRole('button', { name: 'Guest', exact: true }).click();
    await web.getByRole('region', { name: 'Add a comment' }).locator('#comment-body').waitFor({ state: 'visible', timeout: 5000 });
    await postedBubble.hover();
    await postedBubble.getByRole('button', { name: 'Reply' }).click();
    await web.getByText(/Replying to/).first().waitFor({ state: 'visible', timeout: 5000 });
    const replyBody = `Reply acceptance ${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await web.locator('#comment-composer textarea').fill(replyBody);
    await web.locator('#comment-composer').getByLabel(/Quick check/).fill(await solveCaptcha(web.locator('#comment-composer')));
    const replyResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/comments', 'POST', 201));
    const replyVeil = web.locator('[class*="commentSpinner"]').waitFor({ state: 'visible', timeout: 2000 });
    await web.locator('#comment-composer').getByRole('button', { name: 'Post comment' }).click();
    await replyVeil;
    await replyResponse;
    await web.getByText('Your comment has been posted.').waitFor({ state: 'visible', timeout: 5000 });
    await web.locator('[class*="commentNest"]').filter({ hasText: replyBody }).waitFor({ state: 'visible', timeout: 5000 });
    await web.getByRole('button', { name: 'View your comment' }).click();
    await web.locator('[class*="commentBubble"]:not([class*="commentBubbleWrap"])').filter({ hasText: replyBody }).waitFor({ state: 'visible', timeout: 5000 });
    await commentPager.getByRole('button', { name: 'Previous' }).click();
    await commentPager.getByText('Page 1 of 2').waitFor({ state: 'visible', timeout: 5000 });
    await web.locator('[class*="commentBubble"]').filter({ hasText: 'Pagination filler comment 10.' }).first().waitFor({ state: 'visible', timeout: 5000 });

    const admin = await browser.newPage();
    const adminErrors = [];
    // The media-in-use probe intentionally triggers a 409; the browser logs
    // that as a "Failed to load resource" console error, so ignore 409s.
    admin.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('409 (Conflict)')) adminErrors.push(`console:${message.text()}`); });
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
    const overviewResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/overview', 'GET', 200));
    const dashboardCommentsResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await admin.getByRole('button', { name: 'Enter workspace' }).click();
    await loginResponse;
    // Capture the browser's own session token from its storage so the
    // logout-all probe can verify the current session survives.
    const browserToken = await admin.evaluate(() => JSON.parse(sessionStorage.getItem('manifold.admin.session')).accessToken);
    await overviewResponse;
    await dashboardCommentsResponse;
    await admin.getByRole('heading', { name: 'Dashboard' }).waitFor({ state: 'visible', timeout: 5000 });

    // Dashboard panels: paging between pages of different length must not
    // clamp the window scroll to the bottom of the page.
    {
      // The fixture writes far more than one page of audit events, so the
      // activity panel always has a second page. If that button is ever
      // disabled the scroll-clamp check below would assert nothing at all, so a
      // missing second page is a fixture failure rather than a silent skip.
      const activityNext = admin.locator('section[aria-label="Recent activity"]').getByRole('button', { name: 'Next page' });
      if (!(await activityNext.isEnabled())) throw new Error('Dashboard activity panel has no second page, so the scroll-clamp check cannot run');
      await activityNext.scrollIntoViewIfNeeded();
      const scrollBefore = await admin.evaluate(() => window.scrollY);
      const auditPage2 = admin.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/audit' && new URL(response.url()).searchParams.get('page') === '2' && response.status() === 200);
      await activityNext.click();
      await auditPage2;
      await admin.waitForTimeout(300);
      const scrollAfter = await admin.evaluate(() => window.scrollY);
      if (scrollAfter > scrollBefore + 80) {
        throw new Error(`Dashboard paging jumps the page to the bottom: ${scrollBefore} -> ${scrollAfter}`);
      }
    }

    await admin.getByRole('button', { name: 'Comments' }).click();
    await admin.getByText('Manage comments.').waitFor({ state: 'visible', timeout: 5000 });
    const targetRow = admin.locator('.moderation-row').filter({ hasText: replyBody });
    await targetRow.waitFor({ state: 'visible', timeout: 5000 });
    const deleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    const refreshedAfterDelete = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await targetRow.getByRole('button', { name: /^Delete comment from/ }).click();
    await admin.getByText('Soft-delete this comment? It leaves the public site immediately.').waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await deleteResponse;
    await refreshedAfterDelete;
    await targetRow.getByRole('button', { name: /^Restore comment from/ }).waitFor({ state: 'visible', timeout: 5000 });
    const restoreResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+\/restore$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST' && response.status() === 204);
    const refreshedAfterRestore = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await targetRow.getByRole('button', { name: /^Restore comment from/ }).click();
    await restoreResponse;
    await refreshedAfterRestore;
    await targetRow.getByRole('button', { name: /^Delete comment from/ }).waitFor({ state: 'visible', timeout: 5000 });
    if (await admin.locator('.moderation-row').count() !== 12) throw new Error('Admin comment list does not show all comments');

    // server-side search narrows the moderation list to matching threads
    const adminCommentSearch = admin.getByRole('textbox', { name: 'Search comments' });
    await adminCommentSearch.fill('Filler 3');
    await admin.locator('.moderation-row').filter({ hasText: 'Filler 3' }).first().waitFor({ state: 'visible', timeout: 5000 });
    await admin.waitForFunction(() => document.querySelectorAll('.moderation-row').length === 1, undefined, { timeout: 5000 });
    if (!(await admin.locator('.moderation-row').first().textContent())?.includes('Designing Boundaries')) throw new Error('Moderation rows are missing the content title');
    await adminCommentSearch.fill('');

    // row click jumps into the editor Comments tab at the focused thread
    const jumpRow = admin.locator('.moderation-row').filter({ hasText: commentBody });
    await jumpRow.waitFor({ state: 'visible', timeout: 5000 });
    await jumpRow.click();
    await admin.waitForFunction(() => window.location.hash.startsWith('#/writings/content_1/comments?focus='), undefined, { timeout: 5000 });
    await admin.locator('.comment-node').first().waitFor({ state: 'visible', timeout: 10000 });
    await admin.locator('.comment-focus').waitFor({ state: 'visible', timeout: 5000 });
    if (await admin.locator('.comment-node').filter({ hasText: commentBody }).count() !== 1) throw new Error('Focused comment is missing from the editor Comments tab');
    await admin.waitForFunction(() => !window.location.hash.includes('focus='), undefined, { timeout: 5000 });
    const composerAuthor = await admin.getByRole('textbox', { name: 'Author', exact: true }).inputValue();
    if (!composerAuthor.trim()) throw new Error('Comment composer author is not prefilled from the profile');

    // composer posts as the operator, replies nest under the thread, deletes confirm
    const adminNote = `Admin note ${process.pid}-${Date.now()}`;
    await admin.getByRole('textbox', { name: 'Comment', exact: true }).fill(adminNote);
    const adminCommentResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/content\/[^/]+\/comments$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST' && response.status() === 201);
    await admin.getByRole('button', { name: 'Post comment' }).click();
    await adminCommentResponse;
    const adminNoteNode = admin.locator('.comment-node').filter({ hasText: adminNote });
    await adminNoteNode.waitFor({ state: 'visible', timeout: 5000 });
    await adminNoteNode.getByRole('button', { name: 'Reply' }).click();
    await admin.getByText(/Replying to/).waitFor({ state: 'visible', timeout: 5000 });
    const adminReplyNote = `Admin reply ${process.pid}-${Date.now()}`;
    await admin.getByRole('textbox', { name: 'Reply', exact: true }).fill(adminReplyNote);
    await admin.getByRole('button', { name: 'Post reply' }).click();
    await adminNoteNode.locator('.comment-reply').filter({ hasText: adminReplyNote }).waitFor({ state: 'visible', timeout: 5000 });

    await adminNoteNode.locator('.comment-reply').filter({ hasText: adminReplyNote }).getByRole('button', { name: 'Delete', exact: true }).click();
    await admin.getByText('Delete this comment? It leaves the public site immediately.').waitFor({ state: 'visible', timeout: 5000 });
    const replyDeleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await replyDeleteResponse;
    await adminNoteNode.locator('.comment-reply-deleted').filter({ hasText: adminReplyNote }).waitFor({ state: 'visible', timeout: 5000 });
    await adminNoteNode.getByRole('button', { name: 'Delete', exact: true }).click();
    await admin.getByText('Delete this comment? It leaves the public site immediately.').waitFor({ state: 'visible', timeout: 5000 });
    const noteDeleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await noteDeleteResponse;
    await admin.locator('.comment-node-deleted, .comment-node.comment-focus, .comment-node').filter({ hasText: adminNote }).locator('.deleted-tag').first().waitFor({ state: 'visible', timeout: 5000 });

    await admin.getByRole('button', { name: 'Writings', exact: true }).click();
    await admin.getByText('Writings worth returning to.').waitFor({ state: 'visible', timeout: 5000 });
    const adminWritingSearch = admin.getByRole('textbox', { name: 'Search writings' });
    await adminWritingSearch.waitFor({ state: 'visible', timeout: 5000 });
    await adminWritingSearch.fill('boundary');
    await admin.locator('.content-row').filter({ hasText: 'Designing Boundaries' }).first().waitFor({ state: 'visible', timeout: 5000 });
    await adminWritingSearch.fill('');

    // list-row publish confirmation popover on the probe thought from the archive section
    // (kept simple: covered in the thoughts flow below)

    await admin.getByRole('button', { name: 'New writing' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/writings/new', undefined, { timeout: 5000 });
    await admin.getByLabel('Title').fill('Browser check writing');
    await admin.getByLabel('Summary').fill('A probe writing created by the browser check.');
    await admin.waitForFunction(() => document.querySelector('input[placeholder="a-readable-url"]')?.value === 'browser-check-writing', undefined, { timeout: 5000 });

    // Context tab: vditor instant-rendering editor (3.11.x renders a
    // pre.vditor-reset contenteditable inside the ir pane)
    await admin.getByRole('tab', { name: 'Context' }).click();
    await admin.locator('.vditor-ir .vditor-reset[contenteditable="true"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await admin.locator('.vditor-ir .vditor-reset[contenteditable="true"]').first().click();
    await admin.keyboard.type('## Browser check heading');
    await admin.keyboard.press('Enter');
    await admin.keyboard.type('Probe body paragraph.');

    const writingCreateResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/content', 'POST', 201));
    await admin.getByRole('button', { name: 'Save draft' }).click();
    const writingCreated = await writingCreateResponse;
    const writingBody = await writingCreated.json();
    if (!writingBody.body.includes('## Browser check heading') || !writingBody.body.includes('Probe body paragraph.')) throw new Error('vditor input was not saved as markdown: ' + JSON.stringify(writingBody.body));
    await admin.waitForFunction(() => window.location.hash.startsWith('#/writings/'), undefined, { timeout: 5000 });

    // Render tab mirrors the web reading surface
    await admin.getByRole('tab', { name: 'Render' }).click();
    await admin.locator('.editor-render .articleTitleBlock h1').filter({ hasText: 'Browser check writing' }).waitFor({ state: 'visible', timeout: 8000 });
    await admin.locator('.editor-render .markdown h2').filter({ hasText: 'Browser check heading' }).waitFor({ state: 'visible', timeout: 8000 });
    if (await admin.locator('.editor-render .articleToc nav a').count() < 1) throw new Error('Render TOC is missing');

    // detail-page publish popover flow
    await admin.getByRole('tab', { name: 'Meta' }).click();
    await admin.getByRole('button', { name: 'Publish', exact: false }).first().click();
    await admin.getByText('Publish this writing to the public site?').waitFor({ state: 'visible', timeout: 5000 });
    const writingPublishResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/content\/[^/]+\/publish$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST' && response.status() === 200);
    await admin.getByRole('button', { name: 'Publish now' }).click();
    await writingPublishResponse;

    // lock/unlock with dirty guard
    await admin.getByRole('button', { name: 'Lock' }).click();
    await admin.locator('fieldset.editor-locked[disabled]').first().waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('button', { name: 'Edit' }).click();
    await admin.getByLabel('Summary').fill('A probe writing with unsaved edits.');
    await admin.getByRole('button', { name: 'Back to writings' }).click();
    await admin.getByRole('dialog').waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('dialog').getByRole('button', { name: 'Discard and leave' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/writings', undefined, { timeout: 5000 });
    const writingRow = admin.locator('.content-row').filter({ hasText: 'Browser check writing' });
    await writingRow.waitFor({ state: 'visible', timeout: 5000 });

    // list-row delete popover flow
    await writingRow.getByRole('button', { name: 'Delete Browser check writing' }).click();
    await admin.getByText('Delete this piece? It leaves the public site immediately.').waitFor({ state: 'visible', timeout: 5000 });
    const writingDeleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/content\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await writingDeleteResponse;
    // A list-row delete must remove the row and leave the list route in place.
    // The old form waited for the hash to *not* contain "writings/", which was
    // already true while sitting on the list, and swallowed the timeout — so it
    // passed no matter what the delete did.
    await writingRow.waitFor({ state: 'detached', timeout: 5000 });
    if (await admin.evaluate(() => window.location.hash) !== '#/writings') throw new Error('A list-row delete navigated away from the writings list');

    await admin.getByRole('button', { name: 'Thoughts' }).click();
    await admin.getByText('Capture as you go.').waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('button', { name: 'New thought' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/thoughts/new', undefined, { timeout: 5000 });
    await admin.getByLabel('Slug').fill('browser-check-thought');
    await admin.getByLabel('Summary').fill('Probe summary for the thought workbench.');
    await admin.getByLabel('Mood', { exact: true }).fill('focused');
    await admin.getByRole('tab', { name: 'Context' }).click();
    await admin.locator('.vditor-ir .vditor-reset[contenteditable="true"]').first().waitFor({ state: 'visible', timeout: 15000 });
    await admin.locator('.vditor-ir .vditor-reset[contenteditable="true"]').first().click();
    await admin.keyboard.type('Probe body for the thought workbench.');
    const thoughtCreateResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/content', 'POST', 201));
    await admin.getByRole('button', { name: 'Save draft' }).click();
    const thoughtCreated = await thoughtCreateResponse;
    const thoughtBody = await thoughtCreated.json();
    if (!thoughtBody.body.includes('Probe body for the thought workbench.')) throw new Error('Thought body missing from vditor: ' + JSON.stringify(thoughtBody.body));
    await admin.waitForFunction(() => window.location.hash.startsWith('#/thoughts/'), undefined, { timeout: 5000 });
    await admin.getByRole('button', { name: 'Back to thoughts' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/thoughts', undefined, { timeout: 5000 });
    const thoughtRow = admin.locator('.content-row').filter({ hasText: 'Probe summary for the thought workbench.' });
    await thoughtRow.waitFor({ state: 'visible', timeout: 5000 });
    await thoughtRow.getByRole('button', { name: /^Delete/ }).click();
    await admin.getByText('Delete this piece? It leaves the public site immediately.').waitFor({ state: 'visible', timeout: 5000 });
    const thoughtDeleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/content\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await thoughtDeleteResponse;
    // The confirm popover has to close once the delete lands. Waiting on the
    // generic `role=dialog` with a swallowed timeout hid both a popover that
    // stayed open and a strict-mode violation from matching several dialogs.
    await admin.getByText('Delete this piece? It leaves the public site immediately.').waitFor({ state: 'hidden', timeout: 5000 });

    // media library: a published probe writing embeds the uploaded image and
    // renders it on both the admin Render tab and the public writing page
    const mediaWritingResponse = await fetch(`${coreUrl}/api/v1/admin/content`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${archiveToken}` }, body: JSON.stringify({ kind: 'ARTICLE', slug: 'media-render-probe', title: 'Media render probe', summary: 'Probe writing rendering an uploaded image.', body: `## With image\n\n![probe image](${media.url})`, tags: ['design'], metadata: { language: null, aiAssisted: false } }) });
    if (!mediaWritingResponse.ok) throw new Error(`Probe writing creation failed: ${mediaWritingResponse.status}`);
    const mediaWriting = await mediaWritingResponse.json();
    const mediaWritingPublish = await fetch(`${coreUrl}/api/v1/admin/content/${mediaWriting.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${archiveToken}` } });
    if (!mediaWritingPublish.ok) throw new Error(`Probe writing publish failed: ${mediaWritingPublish.status}`);
    await admin.goto(`${adminUrl}/#/writings/${mediaWriting.id}`, { waitUntil: 'networkidle' });
    await admin.getByRole('tab', { name: 'Render' }).click();
    await admin.locator('.editor-render .markdown img[src*="/api/v1/media/"]').first().waitFor({ state: 'visible', timeout: 10000 });
    if (await admin.locator('.editor-render .markdown img[src*="/api/v1/media/"]').count() !== 1) throw new Error('Render tab should show exactly one uploaded image');
    await admin.locator('.editor-render .markdown img[src*="/api/v1/media/"]').first().evaluate((element) => new Promise((done, fail) => {
      const finish = () => element.naturalWidth > 0 ? done(null) : fail(new Error('uploaded image decoded with zero width'));
      if (element.complete) return finish();
      element.scrollIntoView({ block: 'center' });
      element.addEventListener('load', () => finish(), { once: true });
      element.addEventListener('error', () => fail(new Error('uploaded image failed to load')), { once: true });
    }));
    await web.setViewportSize({ width: 1280, height: 900 });
    await web.goto(`${webUrl}/writing/media-render-probe`, { waitUntil: 'networkidle' });
    const publicImage = web.locator('.markdown img[src*="/api/v1/media/"]').first();
    await publicImage.waitFor({ state: 'visible', timeout: 10000 });
    await publicImage.evaluate((element) => new Promise((done, fail) => {
      const finish = () => element.naturalWidth > 0 ? done(null) : fail(new Error('uploaded image decoded with zero width'));
      if (element.complete) return finish();
      element.scrollIntoView({ block: 'center' });
      element.addEventListener('load', () => finish(), { once: true });
      element.addEventListener('error', () => fail(new Error('uploaded image failed to load')), { once: true });
    }));

    await admin.getByRole('button', { name: 'Media' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/media', undefined, { timeout: 5000 });
    const mediaCard = admin.locator('.media-card').filter({ hasText: 'probe.png' });
    await mediaCard.waitFor({ state: 'visible', timeout: 8000 });
    await mediaCard.getByRole('button', { name: 'Copy markdown' }).click();
    await admin.getByRole('button', { name: 'Copied' }).waitFor({ state: 'visible', timeout: 3000 });
    // Media detail page: enter #/media/{id}, verify the basic-info card and
    // the published reference row, then follow the reference into the editor.
    await mediaCard.getByRole('button', { name: 'Details' }).click();
    await admin.waitForFunction((id) => window.location.hash === `#/media/${id}`, media.id, { timeout: 5000 });
    await admin.getByRole('heading', { name: 'probe.png', level: 1 }).waitFor({ state: 'visible', timeout: 5000 });
    await admin.locator('.media-detail-info').waitFor({ state: 'visible', timeout: 5000 });
    const mediaRefRow = admin.locator('.media-ref-row').filter({ hasText: 'Media render probe' });
    await mediaRefRow.waitFor({ state: 'visible', timeout: 5000 });
    if (await mediaRefRow.locator('.status-dot.published').count() !== 1) throw new Error('Reference row should show a published status dot');
    await mediaRefRow.click();
    await admin.waitForFunction((id) => window.location.hash === `#/writings/${id}`, mediaWriting.id, { timeout: 5000 });
    await admin.getByRole('button', { name: 'Back to writings' }).waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('button', { name: 'Media' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/media', undefined, { timeout: 5000 });
    await mediaCard.waitFor({ state: 'visible', timeout: 8000 });
    await mediaCard.getByRole('button', { name: 'Details' }).click();
    await admin.waitForFunction((id) => window.location.hash === `#/media/${id}`, media.id, { timeout: 5000 });
    await admin.getByRole('button', { name: 'Back to media' }).click();
    await admin.waitForFunction(() => window.location.hash === '#/media', undefined, { timeout: 5000 });
    await mediaCard.waitFor({ state: 'visible', timeout: 8000 });
    // The published media-render-probe writing embeds this image, so deletion
    // is blocked with 409 MEDIA_IN_USE and the Alert surfaces the reason.
    await mediaCard.getByRole('button', { name: 'Delete probe.png' }).click();
    await admin.getByText('Delete this file? Anything referencing it will show as broken.').waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await admin.getByText('This file is used in published or draft content. Remove those references first.').waitFor({ state: 'visible', timeout: 5000 });
    // Remove the reference by deleting the probe writing, then retry deletion.
    const mediaWritingDelete = await fetch(`${coreUrl}/api/v1/admin/content/${mediaWriting.id}`, { method: 'DELETE', headers: { authorization: `Bearer ${archiveToken}` } });
    if (!mediaWritingDelete.ok) throw new Error(`Probe writing delete failed: ${mediaWritingDelete.status}`);
    await mediaCard.getByRole('button', { name: 'Delete probe.png' }).click();
    await admin.getByText('Delete this file? Anything referencing it will show as broken.').waitFor({ state: 'visible', timeout: 5000 });
    const mediaDeleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/media\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    await admin.getByRole('button', { name: 'Delete', exact: true }).last().click();
    await mediaDeleteResponse;
    await admin.getByText('No files uploaded yet — drop images or PDFs above or paste into the editor.').waitFor({ state: 'visible', timeout: 5000 });

    // Security: logout-all revokes the browser's other sessions server-side.
    // The browser session and archiveToken are separate logins, so logging out
    // everything except the browser's current session kills archiveToken.
    const logoutAll = await fetch(`${coreUrl}/api/v1/admin/session/logout-all`, { method: 'POST', headers: { authorization: `Bearer ${browserToken}` } });
    if (logoutAll.status !== 204) throw new Error(`Logout-all failed: ${logoutAll.status}`);
    const archiveCheck = await fetch(`${coreUrl}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${archiveToken}` } });
    if (archiveCheck.status !== 401) throw new Error(`Expected logout-all to revoke the archive session, got ${archiveCheck.status}`);
    const browserStillValid = await fetch(`${coreUrl}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${browserToken}` } });
    if (browserStillValid.status !== 200) throw new Error(`Expected browser session to stay valid after logout-all, got ${browserStillValid.status}`);

    // Settings round-trip: identity, navigation, comments toggle
    await admin.getByRole('button', { name: 'Settings' }).click();
    await admin.getByRole('heading', { name: 'Site settings.' }).waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByLabel('Site title').fill('Garden Settings Probe');
    await admin.getByLabel('Footer text').fill('Notes anchored in the garden.');
    await admin.locator('#site-navigation').getByRole('button', { name: 'Add navigation link' }).click();
    const navRow = admin.locator('#site-navigation .list-row').last();
    await navRow.getByPlaceholder('Label', { exact: true }).fill('Garden Home');
    await navRow.getByPlaceholder('Label or /path, or full URL').fill('/garden');
    await admin.locator('#site-comments').getByRole('switch').click();
    const siteSaveResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/site', 'PUT', 200));
    await admin.getByRole('button', { name: 'Save site settings' }).click();
    await siteSaveResponse;
    await admin.locator('.save-bar').waitFor({ state: 'detached', timeout: 5000 });

    await web.goto(`${webUrl}/`, { waitUntil: 'networkidle' });
    const publicTitle = await web.title();
    if (!publicTitle.includes('Garden Settings Probe')) throw new Error('Site title did not reach the web document title: ' + publicTitle);
    await web.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Garden Home' }).waitFor({ state: 'visible', timeout: 5000 });
    await web.locator('[class*="siteFooterBottom"]').getByText('Notes anchored in the garden.').waitFor({ state: 'visible', timeout: 5000 });

    await web.goto(`${webUrl}/writing/designing-boundaries`, { waitUntil: 'networkidle' });
    if (await web.locator('#comments').count() !== 0) throw new Error('Discussion block should disappear when comments are disabled');

    await admin.locator('#site-comments').getByRole('switch').click();
    const siteRestoreResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/site', 'PUT', 200));
    await admin.getByRole('button', { name: 'Save site settings' }).click();
    await siteRestoreResponse;
    await web.goto(`${webUrl}/writing/designing-boundaries`, { waitUntil: 'networkidle' });
    await web.locator('#comments').waitFor({ state: 'visible', timeout: 10000 });

    // Archive pins: toggle from each list, verify the public archive featured card, clear via the editor switch
    await admin.getByRole('button', { name: 'Writings', exact: true }).click();
    await admin.getByText('Writings worth returning to.').waitFor({ state: 'visible', timeout: 5000 });
    const pinButton = admin.getByRole('button', { name: 'Pin Designing Boundaries' });
    await pinButton.waitFor({ state: 'visible', timeout: 5000 });
    const writingPinResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/writings/config', 'PUT', 200));
    await pinButton.click();
    await writingPinResponse;
    await admin.getByRole('button', { name: 'Unpin Designing Boundaries' }).waitFor({ state: 'visible', timeout: 5000 });

    await web.goto(`${webUrl}/writing`, { waitUntil: 'networkidle' });
    await web.getByText('Designing Boundaries').first().waitFor({ state: 'visible', timeout: 5000 });

    await admin.getByRole('button', { name: 'Thoughts' }).click();
    await admin.getByText('Capture as you go.').waitFor({ state: 'visible', timeout: 5000 });
    const thoughtPinButton = admin.getByRole('button', { name: 'Pin A Small Signal' });
    await thoughtPinButton.waitFor({ state: 'visible', timeout: 5000 });
    const thoughtPinResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/thoughts/config', 'PUT', 200));
    await thoughtPinButton.click();
    await thoughtPinResponse;
    await admin.getByRole('button', { name: 'Unpin A Small Signal' }).waitFor({ state: 'visible', timeout: 5000 });

    await web.goto(`${webUrl}/thoughts`, { waitUntil: 'networkidle' });
    await web.getByText('A Small Signal').first().waitFor({ state: 'visible', timeout: 5000 });

    await admin.getByRole('button', { name: 'Unpin A Small Signal' }).click();
    await admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/thoughts/config', 'PUT', 200));

    // Active sessions: signing out one session from the list revokes it
    // server-side and soft-deletes the row (the list does not linger).
    {
      const extraLogin = await fetch(`${coreUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (extraLogin.status !== 200) throw new Error(`Extra session creation failed: ${extraLogin.status}`);
      const { accessToken: extraToken } = await extraLogin.json();
      await admin.setViewportSize({ width: 1440, height: 1000 });
      await admin.getByRole('button', { name: 'Settings' }).click();
      await admin.getByRole('heading', { name: 'Site settings.' }).waitFor({ state: 'visible', timeout: 5000 });
      const sessionRows = admin.locator('.security-session-row');
      await sessionRows.filter({ hasText: 'Active' }).first().waitFor({ state: 'visible', timeout: 5000 });
      const rowsBefore = await sessionRows.count();
      if (rowsBefore < 2) throw new Error(`Expected the current plus the extra session in the list, got ${rowsBefore}`);
      // The extra session row carries the Sign out button; the current one shows "This device".
      const extraRow = sessionRows.filter({ hasNotText: 'This device' }).first();
      const revokeResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/session\/[^/]+\/logout$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST' && response.status() === 204);
      await extraRow.getByRole('button', { name: /^Sign out session / }).click();
      const confirmBody = admin.getByText('Sign out this session? Its token stops working immediately.');
      await confirmBody.waitFor({ state: 'visible', timeout: 5000 });
      // The popover portals to document.body; scope to the body's dropdown.
      await confirmBody.locator('..').getByRole('button', { name: 'Sign out', exact: true }).click();
      await revokeResponse;
      await admin.waitForFunction((expected) => document.querySelectorAll('.security-session-row').length === expected, rowsBefore - 1, { timeout: 5000 });
      const extraTokenGone = await fetch(`${coreUrl}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${extraToken}` } });
      if (extraTokenGone.status !== 401) throw new Error(`Expected the targeted session revoked, got ${extraTokenGone.status}`);
      const browserTokenAlive = await fetch(`${coreUrl}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${browserToken}` } });
      if (browserTokenAlive.status !== 200) throw new Error(`Expected the current session to stay valid, got ${browserTokenAlive.status}`);
    }

    // Security section: change password revokes other sessions; sign-out
    // revokes the current session server-side.
    await admin.setViewportSize({ width: 1440, height: 1000 });
    await admin.getByRole('button', { name: 'Settings' }).click();
    await admin.getByRole('heading', { name: 'Site settings.' }).waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByLabel('Current password').fill(password);
    await admin.getByLabel('New password', { exact: true }).fill('rotated-pass-1');
    await admin.getByLabel('Confirm new password').fill('rotated-pass-1');
    await admin.getByRole('button', { name: 'Change password' }).click();
    await admin.getByRole('button', { name: 'Password updated' }).waitFor({ state: 'visible', timeout: 5000 });
    const otherSession = await fetch(`${coreUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) });
    if (otherSession.status !== 401) throw new Error(`Expected old password rejected after change, got ${otherSession.status}`);
    const rotatedLogin = await fetch(`${coreUrl}/api/v1/admin/session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password: 'rotated-pass-1' }) });
    if (rotatedLogin.status !== 200) throw new Error(`Expected rotated password to authenticate, got ${rotatedLogin.status}`);
    await admin.getByRole('button', { name: 'Sign out', exact: true }).click();
    await admin.getByRole('button', { name: 'Enter workspace' }).waitFor({ state: 'visible', timeout: 5000 });
    const browserTokenGone = await fetch(`${coreUrl}/api/v1/admin/stats`, { headers: { authorization: `Bearer ${browserToken}` } });
    if (browserTokenGone.status !== 401) throw new Error(`Expected signed-out session revoked server-side, got ${browserTokenGone.status}`);

    if (webErrors.length || adminErrors.length) throw new Error(JSON.stringify({ webErrors, adminErrors }));
    console.log(JSON.stringify({ webControlCounts, adminControlCounts, webErrors, adminErrors }));
  } finally {
    await closeBrowser(browser);
    await stopServices();
  }
}

main().catch(async (error) => { console.error(error); await stopServices(); process.exitCode = 1; });
