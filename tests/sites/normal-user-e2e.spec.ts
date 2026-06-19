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

let normalUserCtx: BrowserContext | null = null
let adminCtx: BrowserContext | null = null

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

/**
 * Log in via Supabase REST API and set up the auth cookie so that both the
 * Next.js server client (reads from HTTP Cookie header) and the browser
 * Supabase client (`document.cookie` via @supabase/ssr) can recognise the
 * session.
 *
 * Steps:
 *  1. Obtain an access / refresh token pair from POST /auth/v1/token.
 *  2. Navigate to the site to establish an origin.
 *  3. Write the sb-{ref}-auth-token cookie via document.cookie (browser-side)
 *     AND via Playwright's context.addCookies (HTTP-request-side).
 *  4. Navigate to /me to verify the session is recognised.
 */
async function loginAs(
  browser: import('@playwright/test').Browser,
  email: string,
  password: string,
): Promise<BrowserContext | null> {
  // ── 1. Get tokens from Supabase ──
  const tempCtx = await browser.newContext()
  const tempPage = await tempCtx.newPage()
  let session: Record<string, unknown> | null = null

  try {
    const res = await tempPage.request.post(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        headers: {
          apikey: supabaseKey,
          'Content-Type': 'application/json',
        },
        data: { email, password },
      },
    )
    const body = await res.json()
    console.log(`Login [${email.slice(0, 4)}***]: status ${res.status()}`)
    if (body.access_token) {
      session = body
    } else {
      console.log(`✗ Login failed: ${body.error || body.error_description || 'unknown'}`)
    }
  } catch (e) {
    console.log(`✗ Login error: ${e}`)
  } finally {
    await tempCtx.close()
  }

  if (!session) return null

  // ── 2. Create fresh context and navigate to site ──
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500) // let Next.js hydration complete

  // ── 3. Build the session object that @supabase/ssr / gotrue-js expects ──
  const sessionData: Record<string, unknown> = {
    access_token: session.access_token,
    refresh_token: session.refresh_token || '',
    expires_in: session.expires_in || 3600,
    expires_at: session.expires_at || Math.floor(Date.now() / 1000) + 3600,
    token_type: session.token_type || 'bearer',
  }
  // IMPORTANT: include the user object so getUser() has the user data
  if (session.user) {
    sessionData.user = session.user
  }

  const cookieName = `sb-${projectRef}-auth-token`
  const cookieValue = JSON.stringify(sessionData)

  // ── 4a. Write cookie via document.cookie (browser-side access) ──
  await page.evaluate(
    ({ name, value }: { name: string; value: string }) => {
      document.cookie = `${name}=${encodeURIComponent(value)}; path=/; domain=study.jimmyyao.com; secure; samesite=lax; max-age=3600`
    },
    { name: cookieName, value: cookieValue },
  )

  // ── 4b. Write cookie via Playwright context (HTTP request header) ──
  await ctx.addCookies([
    {
      name: cookieName,
      value: cookieValue,
      domain: 'study.jimmyyao.com',
      path: '/',
      httpOnly: false, // must be false so document.cookie can read it
      secure: true,
      sameSite: 'Lax' as const,
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ])

  // ── 5. Verify session by visiting a page that requires auth ──
  await page.goto(`${base}/me`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1000)
  const meText = await page.locator('body').innerText()
  const loggedIn = !meText.includes('/login') && !meText.includes('请先登录') && !meText.includes('sign in')
  if (!loggedIn) {
    await saveScreenshot(page, 'login-failed-me')
    console.log('✗ Session verification FAILED: /me shows login wall')
    await ctx.close()
    return null
  }
  console.log(`✓ Session verified: /me accessible by ${email.slice(0, 4)}***`)

  return ctx
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
      normalUserCtx = await loginAs(browser, normalUserEmail, normalUserPassword)
    } else {
      console.log('⏭ Normal user login skipped: TEST_USER_EMAIL/PASSWORD not configured')
    }

    if (adminEmail && adminPassword) {
      adminCtx = await loginAs(browser, adminEmail, adminPassword)
    } else {
      console.log('⏭ Admin login skipped: ADMIN_EMAIL/PASSWORD not configured')
    }
  })

  test.afterAll(async () => {
    if (normalUserCtx) await normalUserCtx.close()
    if (adminCtx) await adminCtx.close()
  })

  test('Normal user visits home page', async () => {
    test.skip(!normalUserCtx, '普通用户登录失败或未配置 TEST_USER_EMAIL')
    const page = await visit(normalUserCtx!, '/')
    await waitForLoadComplete(page, 'normal-user-home')
    await waitForAnyKeyword(page, ['首页', '学习', 'home', 'lessons', '课程'], 'normal-user-home')
    await saveScreenshot(page, 'normal-user-home')
    expect(page.url()).not.toContain('/login')
    console.log('✓ Normal user: home page loaded')
  })

  test('Normal user visits lessons page', async () => {
    test.skip(!normalUserCtx, '普通用户登录失败或未配置 TEST_USER_EMAIL')
    const page = await visit(normalUserCtx!, '/lessons')
    await waitForLoadComplete(page, 'normal-user-lessons')
    await waitForAnyKeyword(page, ['课程', 'lesson'], 'normal-user-lessons')
    await saveScreenshot(page, 'normal-user-lessons')
    expect(page.url()).not.toContain('/login')
    console.log('✓ Normal user: lessons page loaded')
  })

  test('Admin activity shows normal user visit', async () => {
    test.skip(!adminCtx, '管理员登录失败或未配置 ADMIN_EMAIL')
    const page = await visit(adminCtx!, `/admin/activity?q=${encodeURIComponent(normalUserEmail!)}`)
    await waitForLoadComplete(page, 'admin-activity-search')
    await waitForAnyKeyword(page, [normalUserEmail!], 'admin-activity-found', 15000)
    await saveScreenshot(page, 'admin-activity-normal-user')

    const bodyText = await page.locator('body').innerText()
    const hasSkipReason = SKIP_REASON_LABELS.some((label) => bodyText.includes(label))
    const hasWorkflowLink = await page.locator('a[href*="workflows/"]').count()
    expect(hasSkipReason || hasWorkflowLink > 0).toBe(true)
    console.log(`✓ Admin activity: visit record found (skipReason=${hasSkipReason}, workflowLinks=${hasWorkflowLink})`)
  })

  test('Admin visitors shows normal user record', async () => {
    test.skip(!adminCtx, '管理员登录失败或未配置 ADMIN_EMAIL')
    const page = await visit(adminCtx!, `/admin/visitors?q=${encodeURIComponent(normalUserEmail!)}`)
    await waitForLoadComplete(page, 'admin-visitors-search')
    await waitForAnyKeyword(page, [normalUserEmail!], 'admin-visitors-found', 15000)
    await saveScreenshot(page, 'admin-visitors-normal-user')

    const bodyText = await page.locator('body').innerText()
    const hasSkipReason = SKIP_REASON_LABELS.some((label) => bodyText.includes(label))
    const hasWorkflowLink = await page.locator('a[href*="workflows/"]').count()
    expect(hasSkipReason || hasWorkflowLink > 0).toBe(true)
    console.log(`✓ Admin visitors: record found (skipReason=${hasSkipReason}, workflowLinks=${hasWorkflowLink})`)
  })

  test('logged_in_first_visit workflow instances page accessible', async () => {
    test.skip(!adminCtx, '管理员登录失败或未配置 ADMIN_EMAIL')
    const page = await visit(adminCtx!, '/admin/workflows?definition_key=logged_in_first_visit')
    await waitForLoadComplete(page, 'admin-workflows-logged-in-first-visit')
    await saveScreenshot(page, 'admin-workflows-logged-in-first-visit')

    await waitForAnyKeyword(page, [
      'logged_in_first_visit',
      '暂无流程实例',
      '访客流程管理',
    ], 'admin-workflows-logged-in-first-visit')

    const body = page.locator('body')
    await expect(body).toContainText(/访客流程管理|Workflow/)
    console.log('✓ logged_in_first_visit workflows page: accessible')
  })
})
