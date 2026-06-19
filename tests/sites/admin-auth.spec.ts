import { test, expect } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join } from 'path'

const base = 'https://study.jimmyyao.com'
const SCREENSHOTS_DIR = 'test-results/screenshots'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const needsSetup = !adminEmail || !adminPassword

// Safe diagnostic (never prints full values)
console.log(`[admin-auth] ADMIN_EMAIL configured: ${adminEmail ? 'yes' : 'no'}`)
console.log(`[admin-auth] ADMIN_PASSWORD configured: ${adminPassword ? 'yes' : 'no'}`)
console.log(`[admin-auth] supabaseKey fallback available: yes`)
if (needsSetup) {
  console.log(`[admin-auth] Skipping setup — missing credentials`)
}

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'ycjuceortcduakxscfes'

let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | null = null

async function saveScreenshot(page: import('@playwright/test').Page, name: string) {
  try { mkdirSync(SCREENSHOTS_DIR, { recursive: true }) } catch {}
  await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}.png`), fullPage: true })
  console.log(` Screenshot saved: ${SCREENSHOTS_DIR}/${name}.png`)
}

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

test.describe('Admin authenticated tests @admin-auth', () => {
  test.beforeAll(async ({ browser }) => {
    if (needsSetup) {
      console.log('⏭ Admin auth setup skipped: ADMIN_EMAIL/ADMIN_PASSWORD not configured')
      return
    }

    console.log(`\n=== Admin auth: logging in as ${adminEmail} ===`)

    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    try {
      const response = await page.request.post(
        `${supabaseUrl}/auth/v1/token?grant_type=password`,
        {
          headers: {
            apikey: supabaseKey!,
            'Content-Type': 'application/json',
          },
          data: { email: adminEmail, password: adminPassword },
        },
      )

      const body = await response.json()
      console.log(`Auth API status: ${response.status()}`)
      console.log(`Auth API response: ${JSON.stringify(body).slice(0, 200)}`)

      if (body.access_token) {
        const expiresDate = body.expires_at
          ? new Date(body.expires_at * 1000)
          : new Date(Date.now() + 3600 * 1000)

        await ctx.addCookies([
          {
            name: `sb-${projectRef}-auth-token`,
            value: JSON.stringify({
              access_token: body.access_token,
              refresh_token: body.refresh_token || '',
              expires_in: body.expires_in || 3600,
              expires_at: body.expires_at || Math.floor(Date.now() / 1000) + 3600,
              token_type: body.token_type || 'bearer',
            }),
            domain: 'study.jimmyyao.com',
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax' as const,
            expires: expiresDate.getTime() / 1000,
          },
        ])

        storageState = await ctx.storageState()
        console.log('✓ Login successful, storage state saved')
      } else {
        console.log(`✗ Login failed: ${body.error || body.error_description || 'unknown error'}`)
      }
    } catch (e) {
      console.log(`✗ Login error: ${e}`)
    } finally {
      await ctx.close()
    }
  })

  // ── Helpers ──

  function skipIfNoSetup() {
    test.skip(needsSetup, '需要 ADMIN_EMAIL/ADMIN_PASSWORD 环境变量')
  }

  function skipIfNoStorage() {
    test.skip(!storageState, '登录失败，storageState 为空')
  }

  async function visit(ctx: BrowserContext, path: string) {
    const page = await ctx.newPage()
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
    return page
  }

  // ── Tests ──

  test('/admin/workflows shows study_visitor and logged_in_first_visit', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/workflows')
      await waitForLoadComplete(page, 'auth-admin-workflows')
      await waitForAnyKeyword(page, ['暂无流程实例', 'study_visitor', 'logged_in_first_visit'], 'auth-admin-workflows')
      await saveScreenshot(page, 'auth-admin-workflows')

      const body = page.locator('body')
      await expect(body).toContainText('访客流程管理')
      await expect(body).toContainText('study_visitor')
      await expect(body).toContainText('logged_in_first_visit')
      console.log('✓ Workflows: definitions present')
    } finally {
      await ctx.close()
    }
  })

  test('/admin/activity shows data or diagnostic info', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/activity')
      await waitForLoadComplete(page, 'auth-admin-activity')
      await saveScreenshot(page, 'auth-admin-activity')

      const bodyText = await page.locator('body').innerText()
      if (bodyText.includes('暂无访问记录')) {
        expect(/Admin|adminCheck|userEmail|userId/.test(bodyText)).toBe(true)
        console.log('✓ Activity: empty with diagnostic info')
      } else {
        await expect(page.locator('body')).toContainText(/最近访问记录|查询与筛选|时间|Time/)
        console.log('✓ Activity: table or search visible')
      }
    } finally {
      await ctx.close()
    }
  })

  test('/admin/visitors shows workflow status column', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/visitors')
      await waitForLoadComplete(page, 'auth-admin-visitors')
      await saveScreenshot(page, 'auth-admin-visitors')

      const body = page.locator('body')
      await expect(body).toContainText('访客记录')
      await expect(body).toContainText(/流程|Workflow/)
      console.log('✓ Visitors: title and workflow column present')
    } finally {
      await ctx.close()
    }
  })

  test('/admin/visitor-flow-rules renders', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/visitor-flow-rules')
      await waitForLoadComplete(page, 'auth-admin-visitor-flow-rules')
      await waitForAnyKeyword(page, ['新增规则', '规则列表', '暂无规则', '保存', '启用'], 'auth-admin-visitor-flow-rules')
      await saveScreenshot(page, 'auth-admin-visitor-flow-rules')

      const body = page.locator('body')
      await expect(body).toContainText(/访客流程规则|新增规则/)
      console.log('✓ Visitor flow rules page: stable content visible')
    } finally {
      await ctx.close()
    }
  })

  test('/admin/system renders', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/system')
      await waitForLoadComplete(page, 'auth-admin-system')
      await saveScreenshot(page, 'auth-admin-system')

      await expect(page.locator('body')).toContainText(/系统检测|system/i)
      console.log('✓ System page: content visible')
    } finally {
      await ctx.close()
    }
  })

  test('/admin/monitor renders', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/monitor')
      await waitForLoadComplete(page, 'auth-admin-monitor')
      await saveScreenshot(page, 'auth-admin-monitor')

      await expect(page.locator('body')).toContainText(/系统监控|monitor/i)
      console.log('✓ Monitor page: content visible')
    } finally {
      await ctx.close()
    }
  })

  // ── 404 checks (separate test for each admin page) ──

  const allAdminPaths = [
    '/admin/system',
    '/admin/activity',
    '/admin/visitors',
    '/admin/monitor',
    '/admin/workflows',
    '/admin/visitor-flow-rules',
  ]

  for (const path of allAdminPaths) {
    test(`${path} must not be 404 (authenticated) @admin-auth`, async ({ browser }) => {
      skipIfNoSetup()
      skipIfNoStorage()

      const ctx = await browser.newContext({ storageState: storageState! })
      try {
        const page = await visit(ctx, path)
        await waitForLoadComplete(page, `no404-${path}`)
        const bodyText = await page.locator('body').innerText()
        expect(/404/.test(bodyText)).toBe(false)
        expect(/This page could not be found/i.test(bodyText)).toBe(false)
        expect(/page not found/i.test(bodyText)).toBe(false)
        console.log(`✓ ${path}: no 404 detected`)
      } finally {
        await ctx.close()
      }
    })
  }
})
