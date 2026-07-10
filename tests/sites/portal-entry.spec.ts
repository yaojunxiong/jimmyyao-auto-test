import { test, expect } from '@playwright/test'

const portalBase = 'https://www.jimmyyao.com'

const publicEntries = [
  { portal: 'study', destination: 'https://study.jimmyyao.com' },
  { portal: 'forum', destination: 'https://forum.jimmyyao.com' },
  { portal: 'knowledge', destination: 'https://knowledge.jimmyyao.com' },
] as const

test.describe('Portal access matrix @smoke @portal-entry', () => {
  for (const { portal, destination } of publicEntries) {
    test(`${portal} entry is public`, async ({ page }) => {
      const response = await page.goto(`${portalBase}/entry/${portal}`, {
        waitUntil: 'domcontentloaded',
      })

      expect(response?.status() ?? 0).toBeLessThan(400)
      await expect.poll(() => new URL(page.url()).origin).toBe(destination)
      await expect(page.locator('body')).toBeVisible()
      expect(page.url()).not.toContain('/login')
    })
  }

  test('admin entry requires login', async ({ page }) => {
    const response = await page.goto(`${portalBase}/entry/admin`, {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status() ?? 0).toBeLessThan(400)
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login')
    expect(new URL(page.url()).searchParams.get('next')).toContain('/entry/admin')
    await expect(page.getByText('统一登录入口')).toBeVisible()
  })

  test('disabled AI lab stays coming soon', async ({ page }) => {
    const response = await page.goto(`${portalBase}/entry/ai-lab`, {
      waitUntil: 'domcontentloaded',
    })

    expect(response?.status() ?? 0).toBeLessThan(400)
    await expect.poll(() => new URL(page.url()).pathname).toBe('/')
    const url = new URL(page.url())
    expect(url.searchParams.get('entry')).toBe('ai-lab')
    expect(url.searchParams.get('status')).toBe('coming-soon')
  })
})
