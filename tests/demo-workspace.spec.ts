import { test, expect } from '@playwright/test';

test.describe('Demo Workspace', () => {
  test('loads with data on first visit', async ({ page }) => {
    await page.goto('/dashboard?workspace=demo&view=dotplot');
    
    await expect(page.locator('text=Dave')).toBeVisible();
    await expect(page.locator('text=Mia')).toBeVisible();
    
    await expect(page.locator('text=8 people')).toBeVisible();
  });

  test('demo workspace is never empty', async ({ page }) => {
    await page.goto('/?workspace=demo');
    
    const emptyState = page.locator('text=No users yet');
    await expect(emptyState).not.toBeVisible();
  });

  test('shows all five views', async ({ page }) => {
    await page.goto('/dashboard?workspace=demo&view=dotplot');
    
    await expect(page.locator('text=Dot Plot')).toBeVisible();
    await page.locator('a:has-text("Cohorts")').click();
    await expect(page.locator('text=Weekly Cohorts')).toBeVisible();
    
    await page.locator('a:has-text("WBR")').click();
    await expect(page.locator('text=Weekly Business Review')).toBeVisible();
    
    await page.locator('a:has-text("Calendar")').click();
    await expect(page.locator('text=Read-only by design')).toBeVisible();
    
    await page.locator('a:has-text("PMF+")').click();
    await expect(page.locator('text=Research Assistant')).toBeVisible();
  });

  test('calendar has no authoring controls', async ({ page }) => {
    await page.goto('/dashboard?workspace=demo&view=calendar');
    
    const addButton = page.locator('button:has-text("Add Event")');
    await expect(addButton).not.toBeVisible();
    
    const editButton = page.locator('button:has-text("Edit")');
    await expect(editButton).not.toBeVisible();
  });

  test('connect page shows both paths', async ({ page }) => {
    await page.goto('/connect');
    
    await expect(page.locator('text=Path 1: Connect Existing Tools')).toBeVisible();
    await expect(page.locator('text=Path 2: Add ANYKPI Events')).toBeVisible();
    
    await page.locator('button:has-text("Path 1")').click();
    await expect(page.locator('text=PostHog')).toBeVisible();
    await expect(page.locator('text=Mixpanel')).toBeVisible();
    await expect(page.locator('text=Amplitude')).toBeVisible();
    
    await page.locator('button:has-text("Path 2")').click();
    await expect(page.locator('text=ANYKPI SDK')).toBeVisible();
    await expect(page.locator('button:has-text("Generate Installation Snippet")')).toBeVisible();
  });

  test('can generate API key for agents', async ({ page }) => {
    await page.goto('/connect');
    
    await page.locator('button:has-text("Generate API Key")').click();
    
    await expect(page.locator('text=ak_')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=http://localhost:3000/api/mcp')).toBeVisible();
  });
});

test.describe('View State URLs', () => {
  test('dot plot filters produce shareable URLs', async ({ page }) => {
    await page.goto('/dashboard?workspace=demo&view=dotplot');
    
    const url = page.url();
    expect(url).toContain('workspace=demo');
    expect(url).toContain('view=dotplot');
  });

  test('workspace switcher works', async ({ page }) => {
    await page.goto('/dashboard?workspace=demo&view=dotplot');
    
    await page.locator('select').selectOption('live');
    
    await page.waitForURL('**/workspace=live**');
    expect(page.url()).toContain('workspace=live');
  });
});

test.describe('MCP Integration', () => {
  test('MCP endpoint is accessible', async ({ page, request }) => {
    const response = await request.post('http://localhost:3000/api/mcp', {
      data: {
        method: 'tools/list',
        params: {},
      },
    });
    
    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.tools).toBeDefined();
    expect(data.tools.length).toBeGreaterThan(0);
  });
});
