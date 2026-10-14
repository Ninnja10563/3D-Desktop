import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openWorkspace(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A new dimension to your everyday.' })).toBeVisible();
}

async function focusApp(page: Page, name: string) {
  await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Focus window F', exact: true }).click();
}

test('notes survive closing immediately after typing and reloading the desktop', async ({ page }) => {
  await openWorkspace(page);
  await focusApp(page, 'Notes');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note title', exact: true }).fill('A desktop worth keeping');
  await page.getByRole('textbox', { name: 'Note body', exact: true }).fill('Move the idea around. Keep the words.');
  await page.getByRole('button', { name: 'Close Notes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Notes window' })).toHaveCount(0);
  await page.reload();
  await focusApp(page, 'Notes');
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('A desktop worth keeping');
  await expect(page.getByRole('textbox', { name: 'Note body', exact: true })).toHaveValue('Move the idea around. Keep the words.');
  await page.getByRole('button', { name: 'Delete this note' }).click();
  await page.getByRole('button', { name: 'Keep', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('A desktop worth keeping');
});

test('minimized windows restore, depth persists, and resetting the scene keeps app content', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Flat', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Window depth' })).toBeDisabled();
  await page.getByRole('button', { name: 'Spatial', exact: true }).click();
  const depth = page.getByRole('slider', { name: 'Window depth' });
  await depth.focus();
  await depth.press('Home');
  await depth.press('ArrowRight');
  await expect(depth).toHaveValue('-495');
  await page.getByRole('button', { name: 'Focus window F', exact: true }).click();
  await page.getByRole('textbox', { name: 'Note body', exact: true }).fill('This content survives a layout reset.');
  await page.getByRole('button', { name: 'Minimize Notes', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Notes window' })).toBeHidden();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}');
    return saved.windows?.find((window: { id: string }) => window.id === 'notes');
  })).toMatchObject({ minimized: true, z: -495 });
  await page.reload();
  await expect(page.getByRole('region', { name: 'Notes window' })).toBeHidden();
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click();
  await expect(page.getByRole('slider', { name: 'Window depth' })).toHaveValue('-495');
  await page.getByRole('button', { name: 'Reset workspace' }).click();
  await expect(page.getByRole('slider', { name: 'Window depth' })).toHaveValue('100');
  await page.getByRole('button', { name: 'Focus Notes', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note body', exact: true })).toHaveValue('This content survives a layout reset.');
});

test('leaving before the layout debounce runs still saves the latest geometry', async ({ page }) => {
  const start = new Date('2026-10-14T09:00:00Z');
  await page.clock.install({ time: start });
  await openWorkspace(page);
  await page.clock.pauseAt(new Date(start.getTime() + 60_000));
  const depth = page.getByRole('slider', { name: 'Window depth' });
  await depth.focus();
  await depth.press('Home');
  await expect(depth).toHaveValue('-500');
  const latestDepth = await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    const saved = JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}');
    return saved.windows?.find((window: { id: string }) => window.id === 'notes')?.z;
  });
  expect(latestDepth).toBe(-500);
});

test('titlebar dragging, corner resizing, and background orbit change and save real scene geometry', async ({ page }) => {
  await openWorkspace(page);
  const note = page.getByRole('region', { name: 'Notes window' });
  const titlebar = note.locator('.window-titlebar');
  await titlebar.hover();
  await page.mouse.down();
  const originalPoint = await titlebar.boundingBox();
  await page.mouse.move(originalPoint!.x + originalPoint!.width / 2 - 100, originalPoint!.y + originalPoint!.height / 2 - 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}');
    return saved.windows?.find((window: { id: string }) => window.id === 'notes')?.x;
  })).toBeLessThan(-245);
  const resize = note.locator('.window-resize');
  await resize.hover();
  const corner = await resize.boundingBox();
  await page.mouse.down();
  await page.mouse.move(corner!.x + corner!.width / 2 + 80, corner!.y + corner!.height / 2 + 45, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}');
    return saved.windows?.find((window: { id: string }) => window.id === 'notes')?.width;
  })).toBeGreaterThan(530);
  await page.getByRole('button', { name: 'Orbit workspace', exact: true }).click();
  await page.mouse.move(1050, 180);
  await page.mouse.down();
  await page.mouse.move(1120, 220, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}').camera))
    .toMatchObject({ rx: 3, ry: -6 });
  await page.reload();
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}');
    return saved.windows?.find((window: { id: string }) => window.id === 'notes')?.width;
  })).toBeGreaterThan(530);
});

test('files import, preview, download unchanged, persist, and delete only after confirmation', async ({ page }) => {
  await openWorkspace(page);
  await focusApp(page, 'Files');
  await expect(page.getByRole('button', { name: 'Import', exact: true })).toBeEnabled();
  const contents = 'Depth file persistence check.\nA small file with real contents.\n';
  await page.getByLabel('Import files', { exact: true }).setInputFiles({
    name: 'depth-check.txt', mimeType: 'text/plain', buffer: Buffer.from(contents),
  });
  const file = page.getByRole('button', { name: /^depth-check\.txt/ });
  await file.click();
  await expect(page.locator('.app-text-preview')).toHaveText(contents);
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download depth-check.txt', exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe('depth-check.txt');
  expect(await readFile((await download.path())!, 'utf8')).toBe(contents);
  await page.reload();
  await focusApp(page, 'Files');
  await expect(file).toBeVisible();
  await page.getByRole('button', { name: 'Remove depth-check.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel removal' }).click();
  await expect(file).toBeVisible();
  await page.getByRole('button', { name: 'Remove depth-check.txt', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm remove depth-check.txt' }).click();
  await expect(file).toHaveCount(0);
  await page.reload();
  await focusApp(page, 'Files');
  await expect(file).toHaveCount(0);
  await expect(page.getByText('Bring a few things with you.', { exact: true })).toBeVisible();
});

test('focus timer counts wall time, pauses across reload, and resets to the chosen duration', async ({ page }) => {
  await page.clock.install();
  await openWorkspace(page);
  await focusApp(page, 'Focus');
  await page.getByRole('button', { name: '5 min', exact: true }).click();
  await page.getByRole('button', { name: 'Start session', exact: true }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('timer')).toHaveText('03:59');
  await page.getByRole('button', { name: 'Pause session', exact: true }).click();
  await page.reload();
  await focusApp(page, 'Focus');
  await expect(page.getByRole('timer')).toHaveText('03:59');
  await expect(page.getByRole('button', { name: 'Resume session', exact: true })).toBeVisible();
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('timer')).toHaveText('03:59');
  await page.getByRole('button', { name: 'Reset timer', exact: true }).click();
  await expect(page.getByRole('timer')).toHaveText('05:00');
});

test('calculator supports keyboard calculations and recovers from an invalid operation', async ({ page }) => {
  await openWorkspace(page);
  await focusApp(page, 'Calculator');
  const expression = page.getByRole('textbox', { name: 'Calculation', exact: true });
  await expression.fill('12 / 0');
  await expression.press('Enter');
  await expect(page.getByText('Cannot divide by zero.', { exact: true })).toBeVisible();
  await expression.fill('(7 + 5) × 4');
  await expression.press('Enter');
  await expect(expression).toHaveValue('48');
  await page.getByRole('button', { name: 'Clear calculation', exact: true }).click();
  await page.getByRole('button', { name: '7', exact: true }).click();
  await page.getByRole('button', { name: 'Multiply', exact: true }).click();
  await page.getByRole('button', { name: '6', exact: true }).click();
  await page.getByRole('button', { name: 'Equals', exact: true }).click();
  await expect(expression).toHaveValue('42');
});

test('the launcher filters apps and an invalid saved workspace still opens safely', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('depth.workspace.v1', JSON.stringify({
    windows: [{ type: ['notes'] }, { type: { toString: null } }, { type: 'calculator', x: 0, y: 0 }],
    camera: { zoom: 'broken' },
  })));
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Open app launcher', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search apps' }).fill('notes');
  const launcher = page.getByRole('dialog');
  await expect(launcher.getByRole('button', { name: 'Calculator', exact: true })).toHaveCount(0);
  await launcher.getByRole('button', { name: 'Notes', exact: true }).click();
  await expect(launcher).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Notes window' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('live views preserve their stream while minimized and release capture on close', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320; canvas.height = 180;
      canvas.getContext('2d')!.fillRect(0, 0, 320, 180);
      const stream = canvas.captureStream(1);
      const track = stream.getVideoTracks()[0];
      Object.defineProperty(track, 'label', { value: 'Test live view' });
      const state = { stream, stopCount: 0 };
      (window as unknown as { depthTestCapture: typeof state }).depthTestCapture = state;
      const stop = track.stop.bind(track);
      track.stop = () => { state.stopCount++; stop(); };
      return stream;
    } });
  });
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Bring an app', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a window', exact: true }).click();
  const liveWindow = page.getByRole('region', { name: 'Test live view window' });
  await expect(liveWindow).toBeVisible();
  await page.getByRole('button', { name: 'Focus Test live view', exact: true }).click();
  await expect(liveWindow.getByText('Live views are view-only. Use the original app to interact.')).toBeVisible();
  await page.getByRole('button', { name: 'Minimize Test live view', exact: true }).click();
  await expect(liveWindow).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as { depthTestCapture: { stopCount: number } }).depthTestCapture.stopCount)).toBe(0);
  await page.getByRole('button', { name: 'Restore Test live view', exact: true }).click();
  await page.getByRole('button', { name: 'Close Test live view', exact: true }).click();
  await expect(liveWindow).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { depthTestCapture: { stopCount: number } }).depthTestCapture.stopCount)).toBe(1);
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('depth.workspace.v1') || '{}');
    return saved.windows?.some((window: { type: string }) => window.type === 'capture');
  })).toBe(false);
});

test('canceling screen sharing gives a useful recovery message without creating an empty live view', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => {
      throw new DOMException('User cancelled', 'NotAllowedError');
    } });
  });
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Bring an app', exact: true }).click();
  await page.getByRole('button', { name: 'Choose a window', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Sharing wasn’t started.');
  await expect(page.getByRole('button', { name: 'Choose a window', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.locator('.live-app').count()).toBe(0);
});
