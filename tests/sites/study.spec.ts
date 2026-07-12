import { test, expect } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join } from 'path'

const base = process.env.BASE_URL || 'https://study.jimmyyao.com'
const SCREENSHOTS_DIR = 'test-results/screenshots'

const adminPaths = [
  '/admin/system',
  '/admin/activity',
  '/admin/visitors',
  '/admin/monitor',
  '/admin/workflows',
  '/admin/visitor-flow-rules',
  '/admin/checkins',
]

const adminWallPatterns = [
  /请先登录后访问管理员页面。/,
  /Please sign in before opening Admin\./i,
  /你没有管理员权限。/,
  /You do not have admin access\./i,
]

const notFoundPatterns = [
  /This page could not be found/,
  /page not found/i,
]

function assertNo404(text: string) {
  for (const p of notFoundPatterns) {
    expect(text).not.toMatch(p)
  }
}

async function needsAuth(page: import('@playwright/test').Page): Promise<boolean> {
  if (page.url().includes('/login')) return true
  const text = await page.locator('body').innerText()
  return adminWallPatterns.some((re) => re.test(text))
}

async function saveScreenshot(page: import('@playwright/test').Page, name: string) {
  try { mkdirSync(SCREENSHOTS_DIR, { recursive: true }) } catch {}
  await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}.png`), fullPage: true })
  console.log(`📸 Screenshot saved: ${SCREENSHOTS_DIR}/${name}.png`)
}

test.describe('Study system tests @study', () => {
  test('/login page is accessible', async ({ page }) => {
    console.log(`\n=== Study test: /login ===`)
    const response = await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
    const status = response?.status() ?? 0
    console.log(`HTTP status: ${status}`)
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.innerText()
    console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)
    assertNo404(bodyText)
    expect(status).toBeLessThan(400)
    console.log('✓ Login page accessible')
  })

  test('Google login button exists', async ({ page }) => {
    console.log(`\n=== Study test: Google login button ===`)
    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.innerText()
    console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)
    assertNo404(bodyText)

    const googleBtn = page.locator(
      'button:has-text("Google"), a:has-text("Google"), [data-provider="google"], .google-btn',
    )
    await expect(googleBtn.first()).toBeVisible({ timeout: 10000 })
    console.log('✓ Google login button found')
  })

  for (const path of adminPaths) {
    test(`${path} renders correctly (unauthenticated) @study`, async ({ page }) => {
      console.log(`\n=== Study test (unauthenticated): ${path} ===`)

      const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
      const status = response?.status() ?? 0
      console.log(`HTTP status: ${status}`)
      console.log(`Final URL: ${page.url()}`)

      const body = page.locator('body')
      await expect(body).toBeVisible()

      const bodyText = await body.innerText()
      console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)

      // HARD assertion: page must NOT show 404 or Next.js not-found page
      assertNo404(bodyText)
      expect(/This page could not be found/i.test(bodyText)).toBe(false)
      expect(status).toBeLessThan(500)
      console.log('✓ No 404 or error page')

      // Every Admin route must render an authentication/authorization wall.
      // Authenticated page behavior is covered separately by @admin-auth.
      await expect.poll(() => needsAuth(page), { timeout: 10000 }).toBe(true)
      if (path === '/admin/visitor-flow-rules') {
        await expect(body).not.toContainText('新增规则')
        await expect(body).not.toContainText('规则值')
      }
      await saveScreenshot(page, `auth-required-${path.replace(/\//g, '-')}`)
      console.log('✓ Auth required')
    })
  }
})
