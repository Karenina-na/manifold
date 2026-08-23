const fs = require('node:fs');
const { chromium } = require('playwright');

const webUrl = process.env.MANIFOLD_WEB_URL ?? 'http://127.0.0.1:13001';
const adminUrl = process.env.MANIFOLD_ADMIN_URL ?? 'http://127.0.0.1:15174';
const contentPath = process.env.MANIFOLD_CONTENT_PATH ?? '/writing/designing-boundaries';
const username = process.env.MANIFOLD_ADMIN_USERNAME ?? 'admin';
const password = process.env.MANIFOLD_ADMIN_PASSWORD ?? 'password';
const chromePath = process.env.MANIFOLD_CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const browserOptions = { headless: true, args: ['--no-sandbox', '--disable-gpu'] };

if (fs.existsSync(chromePath)) browserOptions.executablePath = chromePath;

async function main() {
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
    const commentBody = `Browser acceptance ${Date.now()}`;
    await web.locator('textarea').fill(commentBody);
    await web.getByRole('button', { name: 'Send for review' }).click();
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
    await admin.getByRole('button', { name: 'Enter workspace' }).click();
    await admin.getByText('Good morning, operator.').waitFor({ state: 'visible', timeout: 5000 });
    await admin.getByRole('button', { name: 'Comments' }).click();
    await admin.getByText('Keep the conversation kind.').waitFor({ state: 'visible', timeout: 5000 });
    const targetRow = admin.locator('.moderation-row').filter({ hasText: commentBody });
    await targetRow.waitFor({ state: 'visible', timeout: 5000 });
    await targetRow.getByRole('button', { name: 'Approve comment from Anonymous' }).click();
    await targetRow.waitFor({ state: 'detached', timeout: 5000 });
    await admin.getByText('0 pending').waitFor({ state: 'visible', timeout: 5000 });
    if (await admin.locator('.moderation-row').count() !== 0) throw new Error('Moderation rows remain visible after approval');
    if (webErrors.length || adminErrors.length) throw new Error(JSON.stringify({ webErrors, adminErrors }));
    console.log(JSON.stringify({ webControlCounts, adminControlCounts, webErrors, adminErrors }));
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
