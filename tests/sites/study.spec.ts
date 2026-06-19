import { test, expect } from '@playwright/test'

const base = 'https://study.jimmyyao.com'
const adminPaths = ['/admin/system', '/admin/visitors', '/admin/monitor']

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

async function needsAuth(page: import('@playwright/test').Page): Promise<boolean> {
  if (page.url().includes('/login')) return true
  const text = await page.locator('body').innerText()
  return loginKeywords.some((re) => re.test(text))
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
    const text = await body.innerText()
    console.log(`Body preview (first 300 chars): ${text.slice(0, 300).replace(/\n/g, '\\n')}`)

    expect(status).toBeLessThan(400)
  })

  test('Google login button exists', async ({ page }) => {
    console.log(`\n=== Study test: Google login button ===`)

    await page.goto(`${base}/login`, { waitUntil: 'domcontentloaded' })
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const text = await body.innerText()
    console.log(`Body preview (first 300 chars): ${text.slice(0, 300).replace(/\n/g, '\\n')}`)

    const googleBtn = page.locator(
      'button:has-text("Google"), a:has-text("Google"), [data-provider="google"], .google-btn',
    )
    await expect(googleBtn.first()).toBeVisible({ timeout: 10000 })
    console.log('✓ Google login button found')
  })

  for (const path of adminPaths) {
    test(`${path} blocks unauthenticated users @study`, async ({ page }) => {
      test.info().annotations.push({
        type: 'info',
        description: '已上线并返回访客记录页面。未登录/非管理员会被正确拦截。',
      })

      console.log(`\n=== Study test: ${path} ===`)

      const response = await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
      const status = response?.status() ?? 0
      console.log(`HTTP status: ${status}`)
      console.log(`Final URL: ${page.url()}`)
      console.log(`Title: ${await page.title()}`)

      const body = page.locator('body')
      await expect(body).toBeVisible()

      const text = await body.innerText()
      console.log(`Body preview (first 300 chars): ${text.slice(0, 300).replace(/\n/g, '\\n')}`)

      // Case A: URL redirected to /login
      if (page.url().includes('/login')) {
        console.log('✓ Blocked by redirect to /login')
        expect(page.url()).toContain('/login')
        return
      }

      // Case B: page shows login / permission prompt
      const matched = loginKeywords.find((re) => re.test(text))
      if (matched) {
        console.log(`✓ Blocked by content keyword: ${matched}`)
        expect(matched.test(text)).toBe(true)
        return
      }

      // Neither redirect nor blocked content — fail
      console.log('✗ Page did not block unauthenticated access')
      expect(false).toBe(true)
    })
  }

  // ───────────────────────────────────────────────────────────
  // Admin page tests — verify correct rendering, not 404,
  // and mark auth-required when login walls are hit.
  // ───────────────────────────────────────────────────────────

  test('/admin/workflows loads correctly @study @admin', async ({ page }) => {
    const path = '/admin/workflows'
    console.log(`\n=== Admin test: ${path} ===`)

    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.innerText()
    console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)

    // Must NOT be a Next.js 404 page
    expect(/This page could not be found/i.test(bodyText)).toBe(false)

    const auth = await needsAuth(page)
    if (auth) {
      test.info().annotations.push({ type: 'skip', description: '需要管理员登录态 (auth-required)' })
      await page.screenshot({ path: `test-results/auth-required-admin-workflows.png` })
      console.log('⏭ Skipped: auth required')
    }
    test.skip(auth, '需要管理员登录态 (auth-required)')

    await expect(body).toContainText('访客流程管理')
    await expect(body).toContainText('study_visitor')
    await expect(body).toContainText('logged_in_first_visit')
    console.log('✓ All assertions passed')
  })

  test('/admin/activity loads correctly @study @admin', async ({ page }) => {
    const path = '/admin/activity'
    console.log(`\n=== Admin test: ${path} ===`)

    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.innerText()
    console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)

    // Must NOT be a Next.js 404 page
    expect(/This page could not be found/i.test(bodyText)).toBe(false)

    const auth = await needsAuth(page)
    if (auth) {
      test.info().annotations.push({ type: 'skip', description: '需要管理员登录态 (auth-required)' })
      await page.screenshot({ path: `test-results/auth-required-admin-activity.png` })
      console.log('⏭ Skipped: auth required')
    }
    test.skip(auth, '需要管理员登录态 (auth-required)')

    if (bodyText.includes('暂无访问记录')) {
      // When empty: must show diagnostic info (Admin email / userId / role)
      expect(/Admin|adminCheck/.test(bodyText)).toBe(true)
      console.log('✓ Empty state with diagnostic info')
    } else {
      // When data exists: must show the activity table
      await expect(body).toContainText(/时间|Time/)
      console.log('✓ Activity table visible')
    }
  })

  test('/admin/visitors loads correctly @study @admin', async ({ page }) => {
    const path = '/admin/visitors'
    console.log(`\n=== Admin test: ${path} ===`)

    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.innerText()
    console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)

    // Must NOT be a Next.js 404 page
    expect(/This page could not be found/i.test(bodyText)).toBe(false)

    const auth = await needsAuth(page)
    if (auth) {
      test.info().annotations.push({ type: 'skip', description: '需要管理员登录态 (auth-required)' })
      await page.screenshot({ path: `test-results/auth-required-admin-visitors.png` })
      console.log('⏭ Skipped: auth required')
    }
    test.skip(auth, '需要管理员登录态 (auth-required)')

    // Must show workflow_skip_reason or workflow status column
    await expect(body).toContainText(/流程|Workflow/)
    console.log('✓ Workflow status column present')
  })

  test('/admin/visitor-flow-rules loads correctly @study @admin', async ({ page }) => {
    const path = '/admin/visitor-flow-rules'
    console.log(`\n=== Admin test: ${path} ===`)

    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
    console.log(`Final URL: ${page.url()}`)
    console.log(`Title: ${await page.title()}`)

    const body = page.locator('body')
    await expect(body).toBeVisible()
    const bodyText = await body.innerText()
    console.log(`Body preview (first 300 chars): ${bodyText.slice(0, 300).replace(/\n/g, '\\n')}`)

    // Must NOT be a Next.js 404 page
    expect(/This page could not be found/i.test(bodyText)).toBe(false)

    const auth = await needsAuth(page)
    if (auth) {
      test.info().annotations.push({ type: 'skip', description: '需要管理员登录态 (auth-required)' })
      await page.screenshot({ path: `test-results/auth-required-admin-visitor-flow-rules.png` })
      console.log('⏭ Skipped: auth required')
    }
    test.skip(auth, '需要管理员登录态 (auth-required)')

    await expect(body).toBeVisible()
    console.log('✓ Page rendered')
  })
})
