const { execSync, spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
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

if (!startServices && process.env.MANIFOLD_ALLOW_EXTERNAL_MUTATIONS !== '1') {
  throw new Error('External service mode mutates Core. Set MANIFOLD_ALLOW_EXTERNAL_MUTATIONS=1 explicitly.');
}

function spawnService(command, args, cwd, environment) {
  const child = spawn(command, args, { cwd, detached: true, env: { ...process.env, ...environment }, stdio: ['ignore', 'pipe', 'pipe'] });
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
  for (const port of [corePort, webPort, adminPort]) {
    if (!port) continue;
    try {
      const pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim().split('\n').filter(Boolean);
      for (const pid of pids) {
        try { process.kill(Number(pid), 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    } catch {
      // lsof finds no listener once the group kills landed
    }
  }
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

function coreResponse(response, path, method, status) {
  const url = new URL(response.url());
  return url.origin === coreUrl && url.pathname === path && response.request().method() === method && response.status() === status;
}

process.on('unhandledRejection', (reason) => {
  console.error(reason);
  void stopServices().finally(() => { process.exitCode = 1; });
});

async function main() {
  process.on('SIGINT', () => { void stopServices().finally(() => process.exit(130)); });
  process.on('SIGTERM', () => { void stopServices().finally(() => process.exit(143)); });
  if (startServices) {
    corePort ??= await freePort();
    webPort ??= await freePort();
    adminPort ??= await freePort();
    coreUrl ??= `http://127.0.0.1:${corePort}`;
    webUrl ??= `http://127.0.0.1:${webPort}`;
    adminUrl ??= `http://127.0.0.1:${adminPort}`;
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
    await web.setViewportSize({ width: 1440, height: 1000 });
    await web.goto(webUrl, { waitUntil: 'networkidle' });
    await web.getByRole('heading', { name: 'Writings and thoughts' }).waitFor({ state: 'visible' });
    await web.getByRole('heading', { name: 'My Series' }).waitFor({ state: 'visible' });
    await web.getByRole('contentinfo').getByText(/\d+ readers online/).waitFor({ state: 'visible', timeout: 5000 });
    if (await web.locator('[data-manifold-physics]').count() !== 1) throw new Error('Manifold physics canvas is missing');
    const telemetry = web.locator('[data-metadata-telemetry]');
    await telemetry.waitFor({ state: 'visible' });
    const telemetryText = await telemetry.textContent();
    if (!telemetryText?.includes('LIVE') || !telemetryText.includes('UTC+8') || !telemetryText.includes('HEAD')) {
      throw new Error(`Live status tape is incomplete: ${telemetryText}`);
    }
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
    await web.locator('[data-contact-item]').first().hover();
    const contactTooltip = web.locator('[data-contact-tooltip]');
    await contactTooltip.waitFor({ state: 'visible' });
    const contactTooltipText = await contactTooltip.textContent();
    if (!contactTooltipText?.includes('GitHub') || !contactTooltipText.includes('manifold-space')) {
      throw new Error(`Contact tooltip is missing contact details: ${contactTooltipText}`);
    }
    const contactGeometry = await web.locator('[data-contact-item]').first().evaluate((element) => {
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
    const sceneBreakCount = await web.locator('[data-scene-break]').count();
    if (sceneBreakCount < 4) throw new Error(`Expected scene transition separators between major sections, received ${sceneBreakCount}`);
    await web.mouse.move(20, 20);
    const surfaceStyles = await web.evaluate(() => [...document.querySelectorAll('[data-content-surface], [data-update-rail], [data-series-card]')].map((element) => {
      const style = getComputedStyle(element);
      return { backgroundColor: style.backgroundColor, backdropFilter: style.backdropFilter };
    }));
    if (!surfaceStyles.length || surfaceStyles.some(({ backgroundColor, backdropFilter }) => backgroundColor === 'rgba(0, 0, 0, 0)' || !backdropFilter.includes('blur(8px)'))) {
      throw new Error(`Content surfaces are not isolating text from the particle field: ${JSON.stringify(surfaceStyles)}`);
    }
    const metadataStyles = await web.evaluate(() => {
      const metadata = document.querySelector('[data-minimal-metadata]');
      const clock = metadata?.querySelector('[data-metadata-clock]');
      const canvas = document.querySelector('.backgroundCanvas');
      const markers = [...document.querySelectorAll('[data-metadata-marker]')];
      const metadataStyle = metadata ? getComputedStyle(metadata) : null;
      const clockStyle = clock ? getComputedStyle(clock) : null;
      const canvasStyle = canvas ? getComputedStyle(canvas) : null;
      return {
        visible: Boolean(metadata && metadataStyle?.display !== 'none'),
        markerCount: markers.length,
        clockText: clock?.textContent ?? '',
        writingMode: clockStyle?.writingMode ?? '',
        maskImage: canvasStyle?.maskImage ?? '',
        webkitMaskImage: canvasStyle?.webkitMaskImage ?? '',
      };
    });
    if (!metadataStyles.visible || metadataStyles.markerCount < 4 || metadataStyles.writingMode !== 'vertical-rl' || !metadataStyles.clockText.includes('UTC+8') || (!metadataStyles.maskImage.includes('linear-gradient') && !metadataStyles.webkitMaskImage.includes('linear-gradient'))) {
      throw new Error(`Minimal metadata or particle vignette is missing: ${JSON.stringify(metadataStyles)}`);
    }
    await web.locator('[data-metadata-marker]').nth(2).click();
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
    if (timelineGeometry.lineCount !== 1 || timelineGeometry.pseudoDisplay !== 'none' || timelineGeometry.railBorderTop !== '0px') {
      throw new Error(`Updates timeline should have one track line: ${JSON.stringify(timelineGeometry)}`);
    }
    if (!timelineGeometry.dateBelowDot) throw new Error(`Update date should be below its point: ${JSON.stringify(timelineGeometry)}`);
    const contribution = web.locator('[data-contribution-heatmap]');
    await contribution.waitFor({ state: 'visible' });
    const contributionYears = contribution.locator('[data-contribution-year]');
    if (await contributionYears.count() !== 1 || await contribution.locator('[data-contribution-month]').count() !== 12 || await contribution.locator('[data-contribution-cell]').count() < 365) {
      throw new Error('Contribution heatmap does not render a complete year grid');
    }
    const contributionYear = await contributionYears.inputValue();
    if (!contributionYear) throw new Error('Contribution heatmap year selector is empty');
    const contributionGeometry = await contribution.evaluate((element) => {
      const month = element.querySelector('[data-contribution-month]')?.getBoundingClientRect();
      const firstCell = element.querySelector('[data-contribution-cell]')?.getBoundingClientRect();
      return { monthLeft: month?.left ?? 0, firstCellLeft: firstCell?.left ?? 0 };
    });
    if (Math.abs(contributionGeometry.monthLeft - contributionGeometry.firstCellLeft) > 5) {
      throw new Error(`Contribution month labels are misaligned: ${JSON.stringify(contributionGeometry)}`);
    }
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
    const probeResponse = await fetch(`${coreUrl}/api/v1/admin/content`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${archiveToken}` }, body: JSON.stringify({ kind: 'THOUGHT', title: 'Archive filter probe', summary: 'Probe for archive filters.', body: 'A probe thought exercising archive filters.', tags: ['notes'], metadata: {} }) });
    if (!probeResponse.ok) throw new Error(`Probe thought creation failed: ${probeResponse.status}`);
    const probe = await probeResponse.json();
    const probePublish = await fetch(`${coreUrl}/api/v1/admin/content/${probe.id}/publish`, { method: 'POST', headers: { authorization: `Bearer ${archiveToken}` } });
    if (!probePublish.ok) throw new Error(`Probe thought publish failed: ${probePublish.status}`);

    await web.setViewportSize({ width: 1280, height: 400 });
    await web.goto(`${webUrl}/writing`, { waitUntil: 'networkidle' });
    await web.getByText('2 articles', { exact: true }).waitFor({ state: 'visible' });
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
    await web.getByText('1 articles', { exact: true }).waitFor({ state: 'visible' });
    await writingSearch.fill('');
    await web.getByText('2 articles', { exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /design \d/ }).click();
    await web.getByText('1 articles', { exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /design \d/ }).click();
    await web.getByText('2 articles', { exact: true }).waitFor({ state: 'visible' });
    await web.getByLabel('Sort writings').selectOption('oldest');
    await web.getByRole('heading', { name: 'Designing Boundaries' }).waitFor({ state: 'visible' });

    const writingPickerTrigger = web.getByRole('button', { name: 'View all tags →' });
    const writingPickerPanel = web.getByRole('group', { name: 'View all tags →' });
    await writingPickerTrigger.click();
    await writingPickerPanel.getByRole('button', { name: /design \d/ }).click();
    await writingPickerPanel.getByRole('button', { name: /systems \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').join(',') === 'design,systems');
    await web.getByText('2 articles', { exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('heading', { name: 'Writing', exact: true }).click();
    await writingPickerPanel.waitFor({ state: 'detached' });
    await web.getByRole('button', { name: /systems \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').join(',') === 'design');
    await web.getByText('1 articles', { exact: true }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /design \d/ }).click();
    await web.waitForURL((url) => url.searchParams.getAll('tag').length === 0);
    await web.getByText('2 articles', { exact: true }).waitFor({ state: 'visible' });

    await web.setViewportSize({ width: 1280, height: 400 });
    await web.goto(`${webUrl}/thoughts`, { waitUntil: 'networkidle' });
    const thoughtCount = web.getByText('1 notes', { exact: true });
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
    await web.getByText('0 notes', { exact: true }).waitFor({ state: 'visible' });
    await web.getByText('No thoughts match the current filters.').waitFor({ state: 'visible' });
    await thoughtSearch.fill('');
    await thoughtCount.waitFor({ state: 'visible' });
    await web.getByRole('button', { name: /notes \d/ }).click();
    await web.getByText('0 notes', { exact: true }).waitFor({ state: 'visible' });
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

    await web.goto(`${webUrl}/thoughts/content_2`, { waitUntil: 'networkidle' });
    await web.getByRole('heading', { name: 'A Small Signal' }).waitFor({ state: 'visible' });
    const thoughtReflection = await web.locator('[class*="thoughtReflection"]').textContent();
    if (!thoughtReflection?.includes('When is a system justified?')) throw new Error('Thought reflection quote is missing');
    const thoughtMood = await web.locator('[class*="thoughtMood"]').textContent();
    if (!thoughtMood?.includes('Curious')) throw new Error('Thought mood badge is missing');
    if (!(await web.locator('[class*="thoughtActions"]').first().textContent())?.includes('Likes')) throw new Error('Thought counts are missing');
    await web.getByRole('heading', { name: 'The thread' }).waitFor({ state: 'visible' });
    await web.getByRole('button', { name: 'Send comment' }).waitFor({ state: 'visible' });
    if (await web.locator('[class*="avatarPickerTrigger"]').count() !== 1) throw new Error('Thought composer avatar picker is missing');

    await web.setViewportSize({ width: 1280, height: 900 });
    await web.goto(`${webUrl}${contentPath}`, { waitUntil: 'networkidle' });
    const commentToggle = web.locator('[data-compact="true"]').getByRole('button', { name: 'Comment', exact: true });
    const likeButtons = await web.getByRole('button', { name: /like/i }).count();
    if (likeButtons !== 1 || await commentToggle.count() !== 1) throw new Error('Web controls are incomplete');
    await commentToggle.click();
    await web.getByRole('button', { name: 'Send comment' }).waitFor({ state: 'visible' });
    const webControlCounts = {
      inputs: await web.locator('input').count(),
      textareas: await web.locator('textarea').count(),
      sendButtons: await web.getByRole('button', { name: 'Send comment' }).count(),
      likeButtons,
    };

    const likeResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/likes', 'PUT', 200));
    await web.getByRole('button', { name: 'Add like' }).click();
    await likeResponse;
    const commentBody = `Browser acceptance ${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await web.locator('textarea').fill(commentBody);
    await web.locator('[data-compact="true"]').getByLabel(/Quick check/).fill('7');
    const commentResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/comments', 'POST', 201));
    await web.getByRole('button', { name: 'Send comment' }).click();
    await commentResponse;
    await web.getByText('Posted. Thank you for adding to the thread.').waitFor({ state: 'visible', timeout: 5000 });
    const postedBubble = web.locator('[class*="commentBubble"]').filter({ hasText: commentBody }).first();
    await postedBubble.waitFor({ state: 'visible', timeout: 5000 });
    await postedBubble.hover();
    await postedBubble.getByRole('button', { name: 'Reply' }).click();
    await web.getByText(/Replying to/).first().waitFor({ state: 'visible', timeout: 5000 });
    const replyBody = `Reply acceptance ${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await web.locator('#comment-composer textarea').fill(replyBody);
    await web.locator('#comment-composer').getByLabel(/Quick check/).fill('7');
    const replyResponse = web.waitForResponse((response) => coreResponse(response, '/api/v1/content/designing-boundaries/comments', 'POST', 201));
    await web.locator('#comment-composer').getByRole('button', { name: 'Send comment' }).click();
    await replyResponse;
    await web.locator('[class*="commentNest"]').filter({ hasText: replyBody }).waitFor({ state: 'visible', timeout: 5000 });

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
    await admin.getByRole('heading', { name: 'Dashboard' }).waitFor({ state: 'visible', timeout: 5000 });
    const commentsResponse = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await admin.getByRole('button', { name: 'Comments' }).click();
    await commentsResponse;
    await admin.getByText('Manage comments.').waitFor({ state: 'visible', timeout: 5000 });
    const targetRow = admin.locator('.moderation-row').filter({ hasText: replyBody });
    await targetRow.waitFor({ state: 'visible', timeout: 5000 });
    const deleteResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+$/.test(new URL(response.url()).pathname) && response.request().method() === 'DELETE' && response.status() === 204);
    const refreshedAfterDelete = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await targetRow.getByRole('button', { name: /^Delete comment from/ }).click();
    await deleteResponse;
    await refreshedAfterDelete;
    await targetRow.getByRole('button', { name: /^Restore comment from/ }).waitFor({ state: 'visible', timeout: 5000 });
    const restoreResponse = admin.waitForResponse((response) => /\/api\/v1\/admin\/comments\/[^/]+\/restore$/.test(new URL(response.url()).pathname) && response.request().method() === 'POST' && response.status() === 204);
    const refreshedAfterRestore = admin.waitForResponse((response) => coreResponse(response, '/api/v1/admin/comments', 'GET', 200));
    await targetRow.getByRole('button', { name: /^Restore comment from/ }).click();
    await restoreResponse;
    await refreshedAfterRestore;
    await targetRow.getByRole('button', { name: /^Delete comment from/ }).waitFor({ state: 'visible', timeout: 5000 });
    if (await admin.locator('.moderation-row').count() !== 2) throw new Error('Admin comment list does not show both comments');
    if (webErrors.length || adminErrors.length) throw new Error(JSON.stringify({ webErrors, adminErrors }));
    console.log(JSON.stringify({ webControlCounts, adminControlCounts, webErrors, adminErrors }));
  } finally {
    await browser.close();
    await stopServices();
  }
}

main().catch(async (error) => { console.error(error); await stopServices(); process.exitCode = 1; });
