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
]

const loginKeywords = [
  /登录/,
  /请先登录/,
  /sign in/i,
  /Google/,
  /无权限/,
  /管理员/,
  /unauthorized/i,
  /permission/i,
]

const notFoundPatterns = [
  /404/,
  /This page could not be found/,
  /page not found/i,
]

async function waitForLoadComplete(page: import('@playwright/test').Page, tag: string, timeout = 10000) {
  try {
    await page.waitForFunction(
      () => !document.body.innerText.includes('加载中...'),
      { timeout },
    )
  } catch {
    await saveScreenshot(page, `${tag}-loading-timeout`)
    throw new Error(`${tag}: 页面加载超时 ${timeout}ms，仍在显示"加载中..."`)
  }
}

async function waitForAnyKeyword(page: import('@playwright/test').Page, keywords: string[], tag: string, timeout = 10000) {
  try {
    await page.waitForFunction(
      (keys: string[]) => keys.some((k) => document.body.innerText.includes(k)),
      keywords,
      { timeout },
    )
  } catch {
    await saveScreenshot(page, `${tag}-content-timeout`)
    throw new Error(`${tag}: 未出现稳定内容（${keywords.join('、')}）`)
  }
}

function assertNo404(text: string) {
  for (const p of notFoundPatterns) {
    expect(text).not.toMatch(p)
  }
}

async function needsAuth(page: import('@playwright/test').Page): Promise<boolean> {
  if (page.url().includes('/login')) return true
  const text = await page.locator('body').innerText()
  return loginKeywords.some((re) => re.test(text))
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
      console.log('✓ No 404 or error page')

      // Check if auth-blocked → mark skip + screenshot
      const auth = await needsAuth(page)
      if (auth) {
        test.info().annotations.push({ type: 'skip', description: '需要管理员登录态 (auth-required)' })
        await saveScreenshot(page, `auth-required-${path.replace(/\//g, '-')}`)
        console.log('⏭ Auth required, taking screenshot')
      }
      test.skip(auth, '需要管理员登录态 (auth-required)')

      // ── Authenticated assertions (only runs when page renders without login wall) ──
      await waitForLoadComplete(page, `admin-${path}`)
      await saveScreenshot(page, `admin-${path.replace(/\//g, '-')}`)

      if (path === '/admin/workflows') {
        await expect(body).toContainText('访客流程管理')
        await expect(body).toContainText('study_visitor')
        await expect(body).toContainText('logged_in_first_visit')
        console.log('✓ Workflows page: all definitions present')
      } else if (path === '/admin/activity') {
        if (bodyText.includes('暂无访问记录')) {
          // Must show diagnostic info when empty
          expect(/Admin|adminCheck|userEmail|userId/.test(bodyText)).toBe(true)
          console.log('✓ Activity page: empty with diagnostic info')
        } else {
          // Must show activity table or search/filter when data exists
          await expect(body).toContainText(/最近访问记录|查询与筛选|时间|Time/)
          console.log('✓ Activity page: table or search visible')
        }
      } else if (path === '/admin/visitors') {
        await expect(body).toContainText('访客记录')
        await expect(body).toContainText(/流程|Workflow/)
        console.log('✓ Visitors page: title and workflow column present')
      } else if (path === '/admin/visitor-flow-rules') {
        await waitForAnyKeyword(page, ['新增规则', '规则列表', '暂无规则', '保存', '启用'], `admin-${path}`)
        console.log('✓ Visitor flow rules page: stable content visible')
      } else if (path === '/admin/system') {
        await expect(body).toContainText(/系统检测|system/i)
        console.log('✓ System page: content visible')
      } else if (path === '/admin/monitor') {
        await expect(body).toContainText(/系统监控|monitor/i)
        console.log('✓ Monitor page: content visible')
      }
    })
  }
})
