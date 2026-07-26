import { expect, test, type Page } from '@playwright/test'

const base = (process.env.BASE_URL || 'https://study.jimmyyao.com').replace(/\/$/, '')

const routes = [
  { path: '/lessons/1/ai-simulation', kind: 'lesson' },
  { path: '/lessons/2/ai-simulation', kind: 'lesson' },
  { path: '/lessons/25/ai-simulation', kind: 'lesson' },
  { path: '/lessons/50/ai-simulation', kind: 'lesson' },
  { path: '/ai-simulation/history', kind: 'history' },
  { path: '/admin/ai-simulation-observations', kind: 'admin' },
] as const

function collectBrowserErrors(page: Page) {
  const errors: string[] = []

  page.on('pageerror', error => {
    errors.push(`pageerror: ${error.message}`)
  })
  page.on('console', message => {
    if (message.type() === 'error') errors.push(`console.error: ${message.text()}`)
  })

  return errors
}

async function expectStableRouteContract(page: Page, kind: typeof routes[number]['kind']) {
  if (kind === 'lesson') {
    const simulation = page.getByTestId('ai-simulation-navigation')
    const locked = page.getByRole('heading', { name: /课程暂未解锁|Lesson Locked/i })
    await expect(simulation.or(locked)).toBeVisible()
    return
  }

  if (kind === 'history') {
    await expect(page.getByRole('heading', { name: /我的 AI 模拟记录|我的模拟记录/ })).toBeVisible()
    return
  }

  await expect(page.getByRole('heading', { name: /AI 会话模拟审核/ })).toBeVisible()
}

test.describe('AI Simulation production routes @smoke @ai-simulation', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  for (const route of routes) {
    test(`${route.path} renders without console errors or horizontal overflow`, async ({ page }) => {
      const browserErrors = collectBrowserErrors(page)
      const response = await page.goto(`${base}${route.path}`, { waitUntil: 'domcontentloaded' })

      expect(response, `${route.path} should return a document response`).not.toBeNull()
      expect(response!.status(), `${route.path} returned HTTP ${response!.status()}`).toBeLessThan(400)

      await expect(page.locator('body')).toBeVisible()
      await expectStableRouteContract(page, route.kind)
      await page.waitForLoadState('load')
      await page.waitForTimeout(1000)

      const layout = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: Math.max(
          document.documentElement.scrollWidth,
          document.body?.scrollWidth || 0,
        ),
      }))

      expect(
        layout.scrollWidth,
        `${route.path} overflows horizontally at 375px (${layout.scrollWidth}px > ${layout.clientWidth}px)`,
      ).toBeLessThanOrEqual(layout.clientWidth)
      expect(browserErrors, `${route.path} emitted browser errors`).toEqual([])
    })
  }
})
