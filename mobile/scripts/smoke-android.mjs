#!/usr/bin/env node
/**
 * Android smoke test (runs in CI on an emulator): installs the debug APK,
 * opens the app, walks through the main screens, presses the Android back
 * button and writes screenshots + a report to mobile/smoke/.
 * Usage: node mobile/scripts/smoke-android.mjs path/to/app-debug.apk
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

// Playwright comes with the web app's dev dependencies.
const require = createRequire(resolve(import.meta.dirname, '..', '..', 'apps', 'web', 'package.json'));
const { _android: android } = require('@playwright/test');

const PKG = 'com.algbr.lifeos';
const apk = process.argv[2];
const out = resolve(import.meta.dirname, '..', 'smoke');
mkdirSync(out, { recursive: true });

const report = { checks: [], errors: [], screenshots: [] };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let device;
try {
  [device] = await android.devices();
  if (!device) throw new Error('no Android device');
  console.log('device', device.model(), device.serial());

  await device.installApk(apk);
  await device.shell(`am start -n ${PKG}/.MainActivity`);
  await sleep(4000);

  const shot = async (name) => {
    const file = `${String(report.screenshots.length + 1).padStart(2, '0')}-${name}.png`;
    await device.screenshot({ path: join(out, file) });
    report.screenshots.push(file);
  };
  await shot('launch');

  const webview = await device.webView({ pkg: PKG }, { timeout: 60_000 });
  const page = await webview.page();
  page.on('pageerror', (e) => report.errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') report.errors.push(m.text());
  });

  const appShown = await page
    .locator('.onboarding, .app')
    .first()
    .waitFor({ timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  check('opens on the app, not the landing page', appShown, page.url());

  // Sample week, in French, through the same deep link as the landing page.
  await page.evaluate(() => {
    location.href = '/index.html?start=demo&lang=fr';
  });
  await page.locator('#top3 .decision').first().waitFor({ timeout: 30_000 });
  check('Today shows three decisions', (await page.locator('#top3 .decision').count()) === 3);
  await sleep(800);
  await shot('today');

  for (const route of ['attention', 'plan', 'coach']) {
    await page.evaluate((r) => {
      location.hash = r;
    }, route);
    await sleep(1500);
    check(`${route} renders`, (await page.locator('h1').count()) > 0);
    await shot(route);
  }

  // Android back button: from Coach, back must return to Plan (not close the app).
  await device.shell('input keyevent 4');
  await sleep(1500);
  const afterBack = await page.evaluate(() => location.hash);
  check('back button goes back inside the app', afterBack.includes('plan'), afterBack);
  await shot('after-back');

  // Composer on a phone keyboard: type a capture and read the preview.
  await page.evaluate(() => {
    location.hash = 'today';
  });
  await sleep(1000);
  const composer = page.locator('.composer textarea, .composer input').first();
  if (await composer.count()) {
    await composer.fill('rappeler Marc demain 20min');
    await sleep(600);
    await shot('capture');
    check('capture preview shows a task', /Tâche|Task/.test(await page.locator('.composer').innerText()));
  }

  // Native Google sign-in: the phone's own account picker must open (no Google account on the emulator).
  await page.evaluate(() => {
    location.hash = 'account/cloud';
  });
  await sleep(1500);
  const google = page.getByRole('button', { name: /Google/ }).first();
  check('Google sign-in button is offered in the app', (await google.count()) > 0);
  if (await google.count()) {
    await google.click();
    await sleep(5000);
    await shot('google-native');
    const focus = await device.shell('dumpsys window | grep -E "mCurrentFocus|mFocusedApp"');
    const text = focus.toString();
    const pageText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    check(
      'Google sign-in opens a native screen (not a blocked web page)',
      !/disallowed_useragent/.test(text + pageText),
      text.trim().split('\n')[0] ?? '',
    );
    await device.shell('input keyevent 4');
    await sleep(1500);
  }

  // The test itself closes the Google screen: that cancellation is expected.
  // The emulator has no Google account: Android may answer "No credentials available".
  const errors = report.errors.filter((e) => !/Cancelled by user|\[16\]|No credentials available/.test(e));
  check('no JavaScript errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} catch (err) {
  // Never lose the report: record the crash and publish what we have.
  const msg = String((err && err.stack) || err)
    .split('\n')
    .slice(0, 4)
    .join(' | ');
  check('test ran to the end', false, msg);
  console.log(`::error title=Android smoke test::${msg}`);
  if (device)
    await device
      .screenshot({ path: join(out, '99-crash.png') })
      .then(() => report.screenshots.push('99-crash.png'))
      .catch(() => undefined);
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const md = [
  `# NEXT — test Android (${device ? device.model() : 'no device'})`,
  '',
  ...report.checks.map((c) => `- ${c.ok ? '✅' : '❌'} ${c.name}${c.detail ? ` — \`${c.detail}\`` : ''}`),
  '',
  ...report.screenshots.map((f) => `![${f}](${f})`),
].join('\n');
writeFileSync(join(out, 'README.md'), md);
await device?.close();
process.exit(report.checks.every((c) => c.ok) ? 0 : 1);
