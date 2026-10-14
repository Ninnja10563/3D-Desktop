import { expect, test } from '@playwright/test';

test('3D Desktop branding fits the Mac header and preserves the original saved notes', async ({ page }) => {
  await page.addInitScript(() => {
    window.depthNative = {
      platform: 'darwin',
      getApps: async () => [],
      openApp: async () => undefined,
      getSources: async () => [],
      selectSource: async () => undefined,
      getScreenPermission: async () => 'granted',
      openScreenPrivacySettings: async () => undefined,
      toggleFullscreen: async () => undefined,
    };
    localStorage.setItem('depth-notes-v1', JSON.stringify([{
      id: 'existing-note', title: 'Kept through the rename',
      body: 'My original notes still belong in this workspace.', updatedAt: Date.now(),
    }]));
  });
  await page.goto('/');
  await expect(page).toHaveTitle('3D Desktop — Your spatial desktop');
  await expect(page.locator('.brand')).toContainText('3D Desktop');
  await page.setViewportSize({ width: 1024, height: 680 });
  const brand = await page.locator('.brand').boundingBox();
  const view = await page.locator('.view-switch').boundingBox();
  const actions = await page.locator('.top-actions').boundingBox();
  expect(brand!.x).toBeGreaterThanOrEqual(100);
  expect(brand!.x + brand!.width).toBeLessThan(view!.x);
  expect(view!.x + view!.width).toBeLessThan(actions!.x);
  await page.getByRole('button', { name: 'Open Notes', exact: true }).click();
  await page.getByRole('button', { name: 'Focus window F', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note title', exact: true })).toHaveValue('Kept through the rename');
  await expect(page.getByRole('textbox', { name: 'Note body', exact: true })).toHaveValue('My original notes still belong in this workspace.');
  await page.getByRole('button', { name: 'Workspace settings', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('3D Desktop 1.0');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Help and shortcuts', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('3D Desktop gives your everyday apps room to breathe.');
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.getByRole('button', { name: 'Bring an app', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bring your world into 3D Desktop', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('Allow 3D Desktop to record the screen');
  await expect(page.locator('body')).not.toContainText(/Depth gives|into Depth|Allow Depth|reopen Depth|Depth 1\.0/);
});
