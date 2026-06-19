import { test, expect } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join } from 'path'

const base = 'https://study.jimmyyao.com'
const SCREENSHOTS_DIR = 'test-results/screenshots'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'

const normalUserEmail = process.env.TEST_USER_EMAIL
const normalUserPassword = process.env.TEST_USER_PASSWORD
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'ycjuceortcduakxscfes'

let normalUserState: Awaited<ReturnType<BrowserContext['storageState']>> | null = null
let adminState: Awaited<ReturnType<BrowserContext['storageState']>> | null = null

// Safe diagnostics
console.log(`[normal-user-e2e] TEST_USER_EMAIL configured: ${!!normalUserEmail}`)
console.log(`[normal-user-e2e] ADMIN_EMAIL configured: ${!!adminEmail}`)

const SKIP_REASON_LABELS = [
  '24 小时内已有待确认流程',
  '流程未启用',
  '管理后台路径',
  '管理员访问',
  '命中邮箱屏蔽规则',
  '命中用户 ID 屏蔽规则',
  '命中 IP 屏蔽规则',
  '命中路径屏蔽规则',
  '命中 UA 屏蔽规则',
  '流程未创建',
  '流程创建失败',
  '匿名访客',
]

async function saveScreenshot(page: import('@playwright/test').Page, name: string) {
  try { mkdirSync(SCREENSHOTS_DIR, { recursive: true }) } catch {}
  await page.screenshot({ path: join(SCREENSHOTS_DIR, `${name}.png`), fullPage: true })
  console.log(`📸 Screenshot saved: ${SCREENSHOTS_DIR}/${name}.png`)
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

async function loginAs(
  browser: import('@playwright/test').Browser,
  email: string,
  password: string,
): Promise<Awaited<ReturnType<BrowserContext['storageState']>> | null> {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()

  try {
    const response = await page.request.post(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        headers: {
          apikey: supabaseKey,
          'Content-Type': 'application/json',
        },
        data: { email, password },
      },
    )

    const body = await response.json()
    console.log(`Login [${email.slice(0, 4)}***]: status ${response.status()}`)

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

      const state = await ctx.storageState()
      console.log(`✓ Login success`)
      return state
    }
    console.log(`✗ Login failed: ${body.error || body.error_description || 'unknown'}`)
    return null
  } catch (e) {
    console.log(`✗ Login error: ${e}`)
    return null
  } finally {
    await ctx.close()
  }
}

async function visit(ctx: BrowserContext, path: string) {
  const page = await ctx.newPage()
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
  return page
}

// ── Tests ──

test.describe('Normal user e2e @normal-user-e2e', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async ({ browser }) => {
    if (normalUserEmail && normalUserPassword) {
      normalUserState = await loginAs(browser, normalUserEmail, normalUserPassword)
    } else {
      console.log('⏭ Normal user login skipped: TEST_USER_EMAIL/PASSWORD not configured')
    }

    if (adminEmail && adminPassword) {
      adminState = await loginAs(browser, adminEmail, adminPassword)
    } else {
      console.log('⏭ Admin login skipped: ADMIN_EMAIL/PASSWORD not configured')
    }
  })

  test('Normal user visits home page', async ({ browser }) => {
    test.skip(!normalUserState, '普通用户登录失败或未配置 TEST_USER_EMAIL')

    const ctx = await browser.newContext({ storageState: normalUserState! })
    try {
      const page = await visit(ctx, '/')
      await waitForLoadComplete(page, 'normal-user-home')
      await waitForAnyKeyword(page, ['首页', '学习', 'home', 'lessons', '课程'], 'normal-user-home')
      await saveScreenshot(page, 'normal-user-home')
      expect(page.url()).not.toContain('/login')
      console.log('✓ Normal user: home page loaded')
    } finally {
      await ctx.close()
    }
  })

  test('Normal user visits lessons page', async ({ browser }) => {
    test.skip(!normalUserState, '普通用户登录失败或未配置 TEST_USER_EMAIL')

    const ctx = await browser.newContext({ storageState: normalUserState! })
    try {
      const page = await visit(ctx, '/lessons')
      await waitForLoadComplete(page, 'normal-user-lessons')
      await waitForAnyKeyword(page, ['课程', 'lesson'], 'normal-user-lessons')
      await saveScreenshot(page, 'normal-user-lessons')
      expect(page.url()).not.toContain('/login')
      console.log('✓ Normal user: lessons page loaded')
    } finally {
      await ctx.close()
    }
  })

  test('Admin activity shows normal user visit', async ({ browser }) => {
    test.skip(!adminState, '管理员登录失败或未配置 ADMIN_EMAIL')

    const ctx = await browser.newContext({ storageState: adminState! })
    try {
      // Search activity by normal user's email
      const page = await visit(ctx, `/admin/activity?q=${encodeURIComponent(normalUserEmail!)}`)
      await waitForLoadComplete(page, 'admin-activity-search')
      await waitForAnyKeyword(page, [normalUserEmail!], 'admin-activity-found', 15000)
      await saveScreenshot(page, 'admin-activity-normal-user')

      // Verify workflow status: must have instance ID or skip reason
      const bodyText = await page.locator('body').innerText()
      const hasSkipReason = SKIP_REASON_LABELS.some((label) => bodyText.includes(label))
      const hasWorkflowLink = await page.locator('a[href*="workflows/"]').count()

      expect(hasSkipReason || hasWorkflowLink > 0).toBe(true)
      console.log(`✓ Admin activity: visit record found (skipReason=${hasSkipReason}, workflowLinks=${hasWorkflowLink})`)
    } finally {
      await ctx.close()
    }
  })

  test('Admin visitors shows normal user record', async ({ browser }) => {
    test.skip(!adminState, '管理员登录失败或未配置 ADMIN_EMAIL')

    const ctx = await browser.newContext({ storageState: adminState! })
    try {
      const page = await visit(ctx, `/admin/visitors?q=${encodeURIComponent(normalUserEmail!)}`)
      await waitForLoadComplete(page, 'admin-visitors-search')
      await waitForAnyKeyword(page, [normalUserEmail!], 'admin-visitors-found', 15000)
      await saveScreenshot(page, 'admin-visitors-normal-user')

      const bodyText = await page.locator('body').innerText()
      const hasSkipReason = SKIP_REASON_LABELS.some((label) => bodyText.includes(label))
      const hasWorkflowLink = await page.locator('a[href*="workflows/"]').count()

      expect(hasSkipReason || hasWorkflowLink > 0).toBe(true)
      console.log(`✓ Admin visitors: record found (skipReason=${hasSkipReason}, workflowLinks=${hasWorkflowLink})`)
    } finally {
      await ctx.close()
    }
  })

  test('logged_in_first_visit workflow instances page accessible', async ({ browser }) => {
    test.skip(!adminState, '管理员登录失败或未配置 ADMIN_EMAIL')

    const ctx = await browser.newContext({ storageState: adminState! })
    try {
      const page = await visit(ctx, '/admin/workflows?definition_key=logged_in_first_visit')
      await waitForLoadComplete(page, 'admin-workflows-logged-in-first-visit')
      await saveScreenshot(page, 'admin-workflows-logged-in-first-visit')

      // Page should render — either show instances or "暂无流程实例"
      await waitForAnyKeyword(page, [
        'logged_in_first_visit',
        '暂无流程实例',
        '访客流程管理',
      ], 'admin-workflows-logged-in-first-visit')

      const body = page.locator('body')
      await expect(body).toContainText(/访客流程管理|Workflow/)
      console.log('✓ logged_in_first_visit workflows page: accessible')
    } finally {
      await ctx.close()
    }
  })
})
