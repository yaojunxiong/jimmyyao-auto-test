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
        type: 'known issue',
        description:
          path === '/admin/visitors'
            ? '/admin/visitors 当前路由不存在（返回 404）。产品目标是管理员可查看全站访客记录，该路由后续需要补齐。'
            : '',
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

      // /admin/visitors route does not exist yet — mark as TODO, not permanent
      if (path === '/admin/visitors') {
        if (status === 404 || /not found/i.test(text) || /could not be found/.test(text)) {
          console.log(
            '⚠ /admin/visitors: route does not exist (404). If visitor log backend is needed in the future, add the route.',
          )
          expect(status).toBe(404)
          return
        }
      }

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
})
