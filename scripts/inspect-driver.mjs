// Drives the skill's official inspector with a WebGL-capable SwiftShader
// launch (the inspector's own channel:'chromium' has no GPU in this sandbox).
import { chromium, devices } from 'playwright-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const SKILL = '/home/dusan/.agents/skills/threejs-qa-release/scripts/inspect-threejs-canvas.mjs';
const inspector = await import(SKILL);

const manifestPath = process.argv[2] || 'artifacts/evidence.json';
const url = process.env.GAME_URL || 'http://127.0.0.1:5188/';
const seed = 42;
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const captures = inspector.readManifestCaptures(manifest);

const browser = await chromium.launch({
  executablePath: '/home/dusan/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--headless=new', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
});

let failed = false;
for (const capture of captures) {
  const context = await browser.newContext(
    capture.mobile
      ? { ...devices['iPhone 13'], userAgent: undefined }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }
  );
  let report;
  try {
    report = await inspector.inspectPage(await context.newPage(), {
      url,
      mobile: capture.mobile,
      state: capture.state,
      runId: manifest.runId,
      seed,
      reportPath: capture.reportPath,
      screenshotPath: capture.screenshotPath,
    });
  } finally {
    await context.close();
  }
  await mkdir(path.dirname(capture.reportPath), { recursive: true });
  await writeFile(capture.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(inspector.summarize(report, capture.reportPath));
  const ok = report.result?.ok === true && report.consoleErrorCount === 0 && report.pageErrorCount === 0;
  if (!ok) failed = true;
}
await browser.close();
process.exitCode = failed ? 1 : 0;
