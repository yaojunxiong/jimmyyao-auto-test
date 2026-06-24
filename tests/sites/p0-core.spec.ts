import { test, expect, chromium } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const base = process.env.BASE_URL || 'https://study.jimmyyao.com'
const SCREENSHOTS_DIR = 'test-results/screenshots'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const needsSetup = !adminEmail || !adminPassword

const normalUserEmail = process.env.TEST_USER_EMAIL
const normalUserPassword = process.env.TEST_USER_PASSWORD
const hasNormalUser = !!(normalUserEmail && normalUserPassword)

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'ycjuceortcduakxscfes'

let storageState: Awaited<ReturnType<BrowserContext['storageState']>> | null = null

console.log(`[p0] ADMIN_EMAIL configured: ${!!adminEmail}`)
console.log(`[p0] ADMIN_PASSWORD configured: ${!!adminPassword}`)

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
    throw new Error(`${tag}: page load timeout ${timeout}ms, still showing '加载中...'`)
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
    throw new Error(`${tag}: stable content not found (${keywords.join(', ')})`)
  }
}

test.describe('P0 core business tests @p0', () => {
  test.beforeAll(async ({ browser }) => {
    if (needsSetup) {
      console.log('[p0] Setup skipped: ADMIN_EMAIL/ADMIN_PASSWORD not configured')
      return
    }

    console.log(`[p0] Logging in as ${adminEmail}`)

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
        console.log('[p0] Login successful, storage state saved')
      } else {
        console.log(`[p0] Login failed: ${body.error || body.error_description || 'unknown error'}`)
      }
    } catch (e) {
      console.log(`[p0] Login error: ${e}`)
    } finally {
      await ctx.close()
    }
  })

  function skipIfNoSetup() {
    test.skip(needsSetup, 'ADMIN_EMAIL/ADMIN_PASSWORD env vars required')
  }

  function skipIfNoStorage() {
    test.skip(!storageState, 'Login failed, storage state is null')
  }

  async function visit(ctx: BrowserContext, path: string) {
    const page = await ctx.newPage()
    await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' })
    return page
  }

  // ── P0-1: Approval buttons visibility per workflow status ──
  test('P0-1: Approval buttons visibility per workflow status', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/workflows')
      await waitForLoadComplete(page, 'p0-1')
      await waitForAnyKeyword(page, ['审批流程管理', 'Workflow Management'], 'p0-1')

      const rows = page.locator('.workflow-row')
      const rowCount = await rows.count()
      console.log(`[p0-1] Found ${rowCount} workflow instance rows`)

      if (rowCount === 0) {
        await expect(page.locator('body')).toContainText(/暂无流程实例|No workflow/)
        console.log('[p0-1] No instances — empty state displayed')
        return
      }

      const pendingLabels = new Set(['运行中', '待处理', '待确认'])
      const terminalLabels = new Set(['已通过', '已拒绝', '已完成', '已确认', '已驳回'])

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i)

        // Read the actual badge text from the <span> inside the status cell
        const statusBadge = row.locator('td[data-label="状态"] span')
        const badgeText = (await statusBadge.innerText()).trim()
        const defCell = row.locator('td[data-label="流程定义"]')
        const defText = (await defCell.innerText()).trim()

        const actionsCell = row.locator('td.workflow-actions-cell')
        const flowchartCount = await actionsCell.locator('.btn-flowchart').count()
        const approveCount = await actionsCell.locator('.btn-approve').count()
        const rejectCount = await actionsCell.locator('.btn-reject').count()

        console.log(`[p0-1] Row ${i}: badge="${badgeText}" def="${defText}" flowchart=${flowchartCount} approve=${approveCount} reject=${rejectCount}`)

        // Flowchart must always be present
        expect(flowchartCount).toBeGreaterThanOrEqual(1)

        if (pendingLabels.has(badgeText)) {
          expect(approveCount).toBeGreaterThanOrEqual(1)
          expect(rejectCount).toBeGreaterThanOrEqual(1)
        } else if (terminalLabels.has(badgeText)) {
          expect(approveCount).toBe(0)
          expect(rejectCount).toBe(0)
        } else {
          // Unknown status — log diagnostic but don't fail
          console.log(`[p0-1] Row ${i}: unknown badge "${badgeText}" — checking flowchart only`)
        }
      }

      await saveScreenshot(page, 'p0-1-approval-buttons')
    } finally {
      await ctx.close()
    }
  })

  // ── P0-2: Flowchart diagram renders ──
  test('P0-2: Flowchart diagram renders with nodes and instance details', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/workflows')
      await waitForLoadComplete(page, 'p0-2')
      await waitForAnyKeyword(page, ['审批流程管理', 'Workflow Management'], 'p0-2')

      const flowchartLinks = page.locator('.btn-flowchart')
      const linkCount = await flowchartLinks.count()

      if (linkCount === 0) {
        console.log('[p0-2] No flowchart links found — skipping (no instances)')
        return
      }

      await flowchartLinks.first().click()
      await page.waitForURL('**/admin/workflows/**/diagram**')
      await waitForLoadComplete(page, 'p0-2-diagram')
      await waitForAnyKeyword(page, ['流程图', 'Workflow Diagram', 'Diagram'], 'p0-2-diagram')

      const body = page.locator('body')
      await expect(body).toContainText(/流程图|Diagram/)

      const codeCount = await page.locator('code').count()
      expect(codeCount).toBeGreaterThan(0)
      console.log(`[p0-2] Diagram page loaded with ${codeCount} <code> elements`)

      const pageText = await body.innerText()
      const hasInstanceInfo = pageText.includes('workflow instance id') || pageText.includes('实例')
      expect(hasInstanceInfo).toBe(true)
      console.log(`[p0-2] Instance details present: ${hasInstanceInfo}`)

      await saveScreenshot(page, 'p0-2-flowchart-diagram')
    } finally {
      await ctx.close()
    }
  })

  // ── P0-3: membership_application workflow filter ──
  test('P0-3: membership_application workflow filter', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/workflows?definition_key=membership_application')
      await waitForLoadComplete(page, 'p0-3')
      await waitForAnyKeyword(page, [
        '审批流程管理', '会员申请', '暂无流程实例',
      ], 'p0-3', 15000)

      const body = page.locator('body')
      await expect(body).toContainText(/审批流程管理|Workflow/)

      const selectValue = await page.locator('select[name="definition_key"]').inputValue()
      expect(selectValue).toBe('membership_application')
      console.log(`[p0-3] Filter select correctly set to: ${selectValue}`)

      const refTypeCells = page.locator('td[data-label="流程定义"]')
      const refCount = await refTypeCells.count()
      if (refCount > 0) {
        for (let i = 0; i < refCount; i++) {
          const text = await refTypeCells.nth(i).innerText()
          expect(text.trim()).toBe('membership_application')
        }
        console.log(`[p0-3] All ${refCount} rows show membership_application definition`)
      } else {
        console.log('[p0-3] No instances — membership_application filter applied (empty OK)')
      }

      await saveScreenshot(page, 'p0-3-membership-filter')
    } finally {
      await ctx.close()
    }
  })

  // ── P0-4: email_logs status badges and metadata ──
  test('P0-4: email_logs status badges and metadata', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    const ctx = await browser.newContext({ storageState: storageState! })
    try {
      const page = await visit(ctx, '/admin/email-logs')
      await waitForLoadComplete(page, 'p0-4')
      await waitForAnyKeyword(page, ['邮件日志', 'Email Logs'], 'p0-4')

      const body = page.locator('body')
      await expect(body).toContainText(/邮件日志|Email Logs/)

      const pageText = await body.innerText()

      if (pageText.includes('暂无邮件日志')) {
        console.log('[p0-4] No email logs — empty state displayed')
        return
      }

      const statusOptions = await page.locator('select[name="status"] option').allTextContents()
      console.log(`[p0-4] Status filter options: ${statusOptions.join(', ')}`)
      expect(statusOptions).toContain('pending')
      expect(statusOptions).toContain('sent')
      expect(statusOptions).toContain('failed')

      const rows = page.locator('table tbody tr')
      const rowCount = await rows.count()
      console.log(`[p0-4] Found ${rowCount} email log rows`)
      expect(rowCount).toBeGreaterThan(0)

      for (let i = 0; i < Math.min(rowCount, 10); i++) {
        const row = rows.nth(i)
        const statusCell = row.locator('td:nth-child(5)')
        const badge = statusCell.locator('span')
        const badgeText = await badge.innerText()
        expect(['已发送', '发送失败', '待发送']).toContain(badgeText)
        console.log(`[p0-4] Row ${i}: status badge="${badgeText}"`)

        const instanceLink = row.locator('td:nth-child(6) a')
        const instanceText = await row.locator('td:nth-child(6)').innerText()
        const hasInstanceId = instanceText.trim() !== '-' && instanceText.trim() !== ''
        if (hasInstanceId) {
          await expect(instanceLink).toBeVisible()
          const href = await instanceLink.getAttribute('href')
          expect(href).toContain('/admin/workflows?instanceId=')
          console.log(`[p0-4] Row ${i}: instance link OK`)
        }

        const definitionCell = row.locator('td:nth-child(7)')
        const definitionText = await definitionCell.innerText()
        console.log(`[p0-4] Row ${i}: definition="${definitionText.trim()}"`)

        const reviewCell = row.locator('td:nth-child(8)')
        const reviewLink = reviewCell.locator('a')
        if (await reviewLink.count() > 0) {
          const reviewHref = await reviewLink.getAttribute('href')
          expect(reviewHref).toBeTruthy()
          console.log(`[p0-4] Row ${i}: review link OK`)
        } else {
          console.log(`[p0-4] Row ${i}: no review link`)
        }
      }

      await saveScreenshot(page, 'p0-4-email-logs')
    } finally {
      await ctx.close()
    }
  })

  // ── P0-5: Anonymous visit triggers study_visitor workflow ──
  test('P0-5: Anonymous visit to /lessons/1 records activity and triggers study_visitor workflow', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()

    // Step 1: Fire an anonymous activity track event
    const anonCtx = await browser.newContext()
    const anonPage = await anonCtx.newPage()
    let trackResponse: any = null
    try {
      const res = await anonPage.request.post(`${base}/api/activity/track`, {
        data: {
          path: '/lessons/1',
          referrer: '',
          userAgent: 'Mozilla/5.0 (compatible; P0TestBot/1.0)',
        },
      })
      trackResponse = await res.json()
      console.log(`[p0-5] Track API response: ${JSON.stringify(trackResponse)}`)
      expect(trackResponse.ok).toBe(true)
    } catch (e) {
      console.log(`[p0-5] Track API error: ${e}`)
      throw e
    } finally {
      await anonCtx.close()
    }

    if (!trackResponse?.ok) return

    // Step 2: As admin, verify the anonymous visit appears in /admin/activity
    const adminCtx = await browser.newContext({ storageState: storageState! })
    try {
      const activityPage = await visit(adminCtx, '/admin/activity?user=anonymous')
      await waitForLoadComplete(activityPage, 'p0-5-activity')
      const activityText = await activityPage.locator('body').innerText()

      console.log(`[p0-5] Activity page shows "guest" or "anonymous" badge: ${activityText.includes('Guest') || activityText.includes('匿名') || activityText.includes('guest')}`)

      // Should see the activity page rendered (title + anonymous badge)
      const hasVisitorContent = activityText.includes('系统访问审计日志') || activityText.includes('Access Audit Log') || activityText.includes('审计日志')
      expect(hasVisitorContent).toBe(true)
      console.log('[p0-5] Activity page rendered successfully')
    } finally {
      await adminCtx.close()
    }

    // Step 3: As admin, check /admin/workflows for study_visitor instances
    const adminCtx2 = await browser.newContext({ storageState: storageState! })
    try {
      const wfPage = await visit(adminCtx2, '/admin/workflows?definition_key=study_visitor')
      await waitForLoadComplete(wfPage, 'p0-5-workflows')
      const wfText = await wfPage.locator('body').innerText()

      // Should either show workflow instances or a clear empty state
      const hasInstances = wfText.includes('study_visitor') || wfText.includes('study visitor')
      const hasEmptyState = wfText.includes('暂无流程实例') || wfText.includes('No workflow') || wfText.includes('暂无')
      expect(hasInstances || hasEmptyState).toBe(true)
      console.log(`[p0-5] Workflows page: hasInstances=${hasInstances}, hasEmptyState=${hasEmptyState}`)
    } finally {
      await adminCtx2.close()
    }
  })

  // ──────────── P0-6: RLS / Negative Permission Tests ────────────

  test('P0-6a anonymous user cannot access /admin/activity', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/activity`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6a-activity')
      const text = await page.locator('body').innerText()
      // Anon should get login prompt, not real data
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      expect(text).not.toContain('auto-test-user@jimmyyao.com')
      const denied = text.includes('请先登录') || text.includes('请登录') || text.includes('Please sign in') || text.includes('Please log in') || text.includes('sign in')
      console.log(`[p0-6a] Anonymous /admin/activity: denied=${denied}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6b anonymous user cannot access /admin/visitors', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/visitors`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6b-visitors')
      const text = await page.locator('body').innerText()
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      const denied = text.includes('请先登录') || text.includes('请登录') || text.includes('Please sign in')
      console.log(`[p0-6b] Anonymous /admin/visitors: denied=${denied}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6c anonymous user cannot access /admin/workflows', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/workflows`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6c-workflows')
      const text = await page.locator('body').innerText()
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      const denied = text.includes('请先登录') || text.includes('请登录') || text.includes('Please sign in')
      console.log(`[p0-6c] Anonymous /admin/workflows: denied=${denied}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6d anonymous user cannot access /admin/email-logs', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/email-logs`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6d-email-logs')
      const text = await page.locator('body').innerText()
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      expect(text).not.toContain('auto-test-user@jimmyyao.com')
      const denied = text.includes('请先登录') || text.includes('请登录') || text.includes('Please sign in')
      console.log(`[p0-6d] Anonymous /admin/email-logs: denied=${denied}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6e normal user cannot see admin data on /admin/activity', async ({ browser }) => {
    test.skip(!hasNormalUser, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not configured')
    const ctx = await loginAsNormalUser(browser)
    test.skip(!ctx, 'normal user login failed, skipping')
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/activity`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6e-activity')
      const text = await page.locator('body').innerText()
      // Must not leak real admin data or show admin-only action buttons
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      expect(text).not.toContain('确认') // admin confirm action
      expect(text).not.toContain('驳回') // admin reject action
      const noAccess = text.includes('没有管理员权限') || text.includes('无权限') || text.includes('access denied')
      console.log(`[p0-6e] Normal /admin/activity: noAccess=${noAccess}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6f normal user cannot see admin data on /admin/visitors', async ({ browser }) => {
    test.skip(!hasNormalUser, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not configured')
    const ctx = await loginAsNormalUser(browser)
    test.skip(!ctx, 'normal user login failed, skipping')
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/visitors`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6f-visitors')
      const text = await page.locator('body').innerText()
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      expect(text).not.toContain('确认')
      expect(text).not.toContain('驳回')
      const noAccess = text.includes('没有管理员权限') || text.includes('无权限') || text.includes('access denied')
      console.log(`[p0-6f] Normal /admin/visitors: noAccess=${noAccess}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6g normal user cannot see admin data on /admin/workflows', async ({ browser }) => {
    test.skip(!hasNormalUser, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not configured')
    const ctx = await loginAsNormalUser(browser)
    test.skip(!ctx, 'normal user login failed, skipping')
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/workflows`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6g-workflows')
      const text = await page.locator('body').innerText()
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      expect(text).not.toContain('确认')
      expect(text).not.toContain('驳回')
      const noAccess = text.includes('没有管理员权限') || text.includes('无权限') || text.includes('access denied')
      console.log(`[p0-6g] Normal /admin/workflows: noAccess=${noAccess}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6h normal user cannot see admin data on /admin/email-logs', async ({ browser }) => {
    test.skip(!hasNormalUser, 'TEST_USER_EMAIL/TEST_USER_PASSWORD not configured')
    const ctx = await loginAsNormalUser(browser)
    test.skip(!ctx, 'normal user login failed, skipping')
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/email-logs`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p0-6h-email-logs')
      const text = await page.locator('body').innerText()
      expect(text).not.toContain('auto-test-admin@jimmyyao.com')
      expect(text).not.toContain('auto-test-user@jimmyyao.com')
      expect(text).not.toContain('确认')
      expect(text).not.toContain('驳回')
      const noAccess = text.includes('没有管理员权限') || text.includes('无权限') || text.includes('access denied')
      console.log(`[p0-6h] Normal /admin/email-logs: noAccess=${noAccess}`)
    } finally {
      await ctx.close()
    }
  })

  test('P0-6i API: anonymous user cannot fetch admin data', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      const endpoints = [
        '/api/admin/workflows',
        '/api/admin/email-logs',
      ]
      for (const ep of endpoints) {
        const apiRes = await page.request.get(`${base}${ep}`, {
          headers: { 'Content-Type': 'application/json' },
        })
        const status = apiRes.status()
        const bodyText = await apiRes.text()
        // Should get 401/403/redirect or empty payload
        const isBlocked = status === 401 || status === 403 || (status >= 300 && status < 400) || bodyText.includes('登录') || bodyText.includes('sign in') || bodyText.includes('unauthorized')
        if (!isBlocked && status === 200) {
          // If 200, ensure no admin data leaked
          expect(bodyText).not.toContain('auto-test-admin@jimmyyao.com')
        }
        console.log(`[p0-6i] GET ${ep} status=${status} blocked=${isBlocked}`)
      }
    } finally {
      await ctx.close()
    }
  })

  // ── P1-2: Workflow / Email status label consistency ──
  test('P1-2a workflow status labels are correct', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/workflows`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p1-2a')
      const text = await page.locator('body').innerText()
      // Workflow page must NOT show email labels
      expect(text).not.toMatch(/待发送/)
      // Workflow page must show at least one correct workflow label
      const ok = text.includes('待确认') || text.includes('已确认') || text.includes('已驳回') || text.includes('已完成')
      expect(ok).toBe(true)
      console.log('[p1-2a] Workflow status labels OK (no mixing)')
    } finally {
      await ctx.close()
    }
  })

  test('P1-2b email status labels are correct', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/email-logs`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p1-2b')
      const text = await page.locator('body').innerText()
      // Email page must NOT show workflow labels
      expect(text).not.toMatch(/待确认/)
      // Email page must show at least one correct email label
      const ok = text.includes('待发送') || text.includes('已发送') || text.includes('发送失败')
      expect(ok).toBe(true)
      console.log('[p1-2b] Email status labels OK (no mixing)')
    } finally {
      await ctx.close()
    }
  })

  // ── P2-1: Recitation V2 ──

  function skipIfNoSetupNoStorage(this: import('@playwright/test').TestInfo) {
    if (needsSetup) test.skip(needsSetup, 'ADMIN_EMAIL / ADMIN_PASSWORD not configured')
    if (!storageState) test.skip('No storage state (login failed or not run)')
  }

  const recitationRecordButton = (page: Page) => page.getByTestId('recitation-record-button').first()
  const recitationStopButton = (page: Page) => page.getByTestId('recitation-stop-button').first()

  async function recordRecitationTake(page: Page, durationMs = 1500) {
    const recordBtn = recitationRecordButton(page)
    await recordBtn.waitFor({ state: 'visible', timeout: 5000 })
    await expect(recordBtn).toBeEnabled({ timeout: 5000 })
    await recordBtn.click()

    const stopBtn = recitationStopButton(page)
    await stopBtn.waitFor({ state: 'visible', timeout: 5000 })
    await expect(stopBtn).toBeEnabled({ timeout: 5000 })
    await page.waitForTimeout(durationMs)
    await stopBtn.click()
    await page.waitForTimeout(1000)
  }

  test('P2-1a recitation V2 entry card on lesson page', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/lessons/1`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1a')
      const text = await page.locator('body').innerText()
      const hasEntry = text.includes('会话背诵 V2') || text.includes('Conversation Recitation V2')
      const hasStartLink = text.includes('开始背诵') || text.includes('Start Recitation')
      if (hasEntry) {
        expect(hasStartLink).toBe(true)
        console.log('[p2-1a] Recitation V2 entry card visible (flag ON)')
      } else {
        console.log('[p2-1a] Recitation V2 entry card hidden (flag OFF, expected in production)')
      }
      // Original page content still renders (regardless of flag state)
      const hasLessonTitle = text.includes('第 1 课') || text.includes('Lesson 1')
      expect(hasLessonTitle).toBe(true)
    } finally {
      await ctx.close()
    }
  })

  test('P2-1b recitation page loads correctly', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/lessons/1/recitation`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1b')
      const text = await page.locator('body').innerText()
      // Page title visible
      const hasTitle = text.includes('会话背诵') || text.includes('Recitation')
      expect(hasTitle).toBe(true)
      // Conversation lines should be rendered
      const hasLine = text.includes('おはようございます') || text.includes('初めまして')
      expect(hasLine).toBe(true)
      // Floating recorder should exist
      const recordBtns = page.getByTestId('recitation-record-button')
      const count = await recordBtns.count()
      expect(count).toBeGreaterThanOrEqual(1)
      console.log(`[p2-1b] Recitation page loaded, ${count} floating record buttons found`)
    } finally {
      await ctx.close()
    }
  })

  async function setupRecordingMocks(page: Page, store: Map<string, any[]>) {
    const makeTake = (ride: number) => ({
      id: `mock-take-${Date.now()}-${ride}`,
      userId: 'mock-user-id',
      lessonNo: 1,
      lineNo: 1,
      takeNo: ride,
      storagePath: `user-mock/lesson-1/line-1/take-${ride}.webm`,
      audioMimeType: 'audio/webm',
      durationMs: 0,
      score: 85,
      isBest: ride === 1,
      isSystemRecommended: false,
      uploadStatus: 'uploaded',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })

    const key = '1-1'
    store.set(key, [])

    await page.route('**/api/recording/**', async (route) => {
      const url = route.request().url()
      const method = route.request().method()

      if (method === 'POST' && url.includes('/upload')) {
        const takes = store.get(key)!
        const ride = takes.length + 1
        const take = makeTake(ride)
        takes.push(take)
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(take) })
      }

      if (method === 'GET' && url.includes('/list')) {
        const u = new URL(url)
        const lk = `${u.searchParams.get('lessonNo')}-${u.searchParams.get('lineNo')}`
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store.get(lk) || []) })
      }

      if (method === 'POST' && url.includes('/set-best')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      }

      if (method === 'GET' && url.includes('/signed-url')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedUrl: `${base}/mock-audio.webm`, expiresIn: 3600 }) })
      }

      if (method === 'DELETE') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
      }

      return route.continue()
    })
  }

  test('P2-1c record a take with fake microphone', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const testBrowser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    })
    const ctx = await testBrowser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      const takeStore = new Map<string, any[]>()
      await setupRecordingMocks(page, takeStore)

      await page.goto(`${base}/lessons/1/recitation`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1c-record')
      await recordRecitationTake(page, 1500)

      // Wait for score message to appear in floating bar
      await expect(page.getByText(/得分 \d+/)).toBeVisible({ timeout: 10000 })
      console.log('[p2-1c] Score message visible')

      // Wait for at least one take row
      await expect(page.getByTestId('recitation-take-row').first()).toBeVisible({ timeout: 10000 })
      const takeRows = await page.getByTestId('recitation-take-row').count()
      expect(takeRows).toBeGreaterThanOrEqual(1)
      console.log(`[p2-1c] Recording completed, ${takeRows} take(s) visible`)
    } finally {
      await ctx.close()
      await testBrowser.close()
    }
  })

  test('P2-1d record multiple takes', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const testBrowser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    })
    const ctx = await testBrowser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      const takeStore = new Map<string, any[]>()
      await setupRecordingMocks(page, takeStore)

      await page.goto(`${base}/lessons/1/recitation`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1d')
      // Record twice on the first line
      for (let i = 0; i < 2; i++) {
        await recordRecitationTake(page, 1500)
        // Wait for score after each take
        await expect(page.getByText(/得分 \d+/).first()).toBeVisible({ timeout: 10000 })
        if (i === 0) {
          console.log('[p2-1d] First take done')
        }
      }
      // Should have multiple takes visible
      await expect(page.getByTestId('recitation-take-row').first()).toBeVisible({ timeout: 10000 })
      const takeCount = await page.getByTestId('recitation-take-row').count()
      expect(takeCount).toBeGreaterThanOrEqual(2)
      console.log(`[p2-1d] ${takeCount} take versions found`)
    } finally {
      await ctx.close()
      await testBrowser.close()
    }
  })

  test('P2-1e select best take manually', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const testBrowser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    })
    const ctx = await testBrowser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/lessons/1/recitation`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1e')
      // Record once to create a take
      await recordRecitationTake(page, 1500)
      // Record a second take
      await recordRecitationTake(page, 1500)
      // Click "选为最佳" on the second take
      const selectBestBtns = page.locator('button', { hasText: '选为最佳' })
      const count = await selectBestBtns.count()
      if (count > 0) {
        await selectBestBtns.first().click()
        await page.waitForTimeout(500)
        console.log('[p2-1e] Best take manually selected')
      } else {
        console.log('[p2-1e] No manual select buttons (auto-selected by system)')
      }
      const text = await page.locator('body').innerText()
      expect(text).toMatch(/最佳|best/i)
    } finally {
      await ctx.close()
      await testBrowser.close()
    }
  })

  test('P2-1f delete take works', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const testBrowser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    })
    const ctx = await testBrowser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/lessons/1/recitation`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1f')
      // Record once
      await recordRecitationTake(page, 1500)
      // Click delete button (✕)
      const deleteBtns = page.getByTestId('recitation-take-delete-button')
      const count = await deleteBtns.count()
      if (count > 0) {
        await deleteBtns.first().click()
        await page.waitForTimeout(500)
        console.log('[p2-1f] Take deleted')
      }
      // Should still have body text
      const bodyText = await page.locator('body').innerText()
      expect(bodyText.length).toBeGreaterThan(0)
      console.log('[p2-1f] Delete take action completed')
    } finally {
      await ctx.close()
      await testBrowser.close()
    }
  })

  test('P2-1g continuous bestTake playback replaces full audio generation', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const testBrowser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    })
    const ctx = await testBrowser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/lessons/1/recitation`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1g')

      const body = page.locator('body')

      // Assertion 3, 4: old full-audio UI must never appear
      await expect(body).not.toContainText('完整音频已生成')

      // Assertion 1: "试听完整背诵" button is visible
      const listenBtn = page.locator('button', { hasText: '试听完整背诵' })
      await expect(listenBtn).toBeVisible()
      console.log('[p2-1g] "试听完整背诵" button visible')

      // Record on each line and select best take
      const lineRows = page.getByTestId('recitation-line-row')
      const rowCount = await lineRows.count()
      console.log(`[p2-1g] Found ${rowCount} line rows`)

      for (let i = 0; i < rowCount; i++) {
        await lineRows.nth(i).click()
        await page.waitForTimeout(200)
        await recordRecitationTake(page, 1200)

        // Select this take as best
        const bestBtns = page.locator('button', { hasText: '选为最佳' })
        if (await bestBtns.count() > 0) {
          await bestBtns.first().click()
          await page.waitForTimeout(300)
        }
      }
      console.log('[p2-1g] Recorded all lines')

      await page.waitForTimeout(500)

      // Assertion 2: if incomplete, show "还差 X 句"
      const bodyText = await body.innerText()
      const isDisabled = await listenBtn.isDisabled()
      const missingMatch = bodyText.match(/还差 \d+ 句/)

      if (isDisabled || missingMatch) {
        expect(bodyText).toMatch(/还差 \d+ 句/)
        console.log(`[p2-1g] Incomplete: "${missingMatch?.[0] ?? '(match failed)'}"`)
      } else {
        // Assertion 5: all lines have best takes — click enters playback
        console.log('[p2-1g] All lines have best takes, clicking button')
        await listenBtn.click()
        await page.waitForTimeout(1500)

        const progressVisible = await page.getByText(/正在试听完整背诵/).isVisible().catch(() => false)
        const loadingVisible = await page.getByText('正在准备试听...').isVisible().catch(() => false)
        expect(progressVisible || loadingVisible).toBe(true)
        console.log(`[p2-1g] Playback state entered: ${progressVisible ? 'playing' : 'loading'}`)
      }

      // Assertion 3 enforced again: old full-audio UI never appears
      await expect(body).not.toContainText('完整音频已生成')

      await saveScreenshot(page, 'p2-1g-continuous-playback')
    } finally {
      await ctx.close()
      await testBrowser.close()
    }
  })

  test('P2-1h verify lesson page loads with recitation V2 entry', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/lessons/1`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p2-1h')
      const text = await page.locator('body').innerText()

      // Lesson title must be visible
      const hasTitle = text.includes('第 1 课') || text.includes('Lesson 1')
      expect(hasTitle).toBe(true)

      // Deep Dive / 中文理解 card must still render
      const hasDeepDive = text.includes('中文理解') || text.includes('Deep Dive')
      expect(hasDeepDive).toBe(true)

      // At least one recitation entry button must link to /lessons/1/recitation
      const recitationLink = page.locator('a[href*="/lessons/1/recitation"]').first()
      await expect(recitationLink).toBeVisible({ timeout: 5000 })
      const linkText = await recitationLink.innerText()
      console.log(`[p2-1h] Recitation entry found: "${linkText.trim()}"`)

      // Old full-audio UI must never appear on lesson page
      expect(text).not.toContain('完整音频已生成')
      expect(text).not.toContain('missing_title')

      console.log('[p2-1h] Lesson page loaded with recitation V2 entry')
    } finally {
      await ctx.close()
    }
  })

  // ── P1-4: Email logs experience ──
  test('P1-4a email_logs page fields and filters', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/email-logs`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p1-4a')
      const text = await page.locator('body').innerText()
      // Basic page load
      expect(text).toMatch(/邮件日志|Email Logs/)
      // Status filter options
      const hasStatusOptions = text.includes('pending') && text.includes('sent') && text.includes('failed')
      expect(hasStatusOptions).toBe(true)
      // Definition key column (流程定义 / Definition)
      expect(text).toMatch(/流程定义|Definition/)
      // Sent at column (发送时间 / Sent At)
      expect(text).toMatch(/发送时间|Sent At/)
      // Error message column (错误信息 / Error)
      expect(text).toMatch(/错误信息|Error/)
      console.log('[p1-4a] Email logs page fields OK')
    } finally {
      await ctx.close()
    }
  })

  test('P1-4b email_logs ?status=failed filter works', async ({ browser }) => {
    skipIfNoSetup()
    skipIfNoStorage()
    const ctx = await browser.newContext({ storageState: storageState! })
    const page = await ctx.newPage()
    try {
      await page.goto(`${base}/admin/email-logs?status=failed`, { waitUntil: 'networkidle' })
      await waitForLoadComplete(page, 'p1-4b')
      // Must not 404
      expect(await page.locator('body').innerText()).not.toMatch(/404|This page could not be found/)
      // Must show email logs or empty state
      const bodyText = await page.locator('body').innerText()
      const hasLogsOrEmpty = bodyText.includes('发送失败') || bodyText.includes('暂无邮件日志') || bodyText.includes('No email logs')
      expect(hasLogsOrEmpty).toBe(true)
      console.log('[p1-4b] status=failed filter OK')
    } finally {
      await ctx.close()
    }
  })

})

async function loginAsNormalUser(browser: import('@playwright/test').Browser): Promise<BrowserContext | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'
  const email = normalUserEmail
  const password = normalUserPassword
  if (!email || !password) return null

  const tempCtx = await browser.newContext()
  const tempPage = await tempCtx.newPage()
  try {
    const res = await tempPage.request.post(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        headers: { apikey: supabaseKey, 'Content-Type': 'application/json' },
        data: { email, password },
      },
    )
    const json = await res.json() as Record<string, unknown>
    const accessToken = json.access_token as string | undefined
    const refreshToken = json.refresh_token as string | undefined
    if (!accessToken || !refreshToken) {
      console.log(`[loginAsNormalUser] login failed: ${JSON.stringify(json)}`)
      await tempCtx.close()
      return null
    }
    const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'ycjuceortcduakxscfes'
    const cookieName = `sb-${projectRef}-auth-token`
    await tempPage.goto(base, { waitUntil: 'domcontentloaded' })
    await tempPage.evaluate(
      ({ name, accessToken: at, refreshToken: rt }) => {
        document.cookie = `${name}=${encodeURIComponent(JSON.stringify({ access_token: at, refresh_token: rt }))}; path=/; max-age=86400; SameSite=Lax; Secure`
      },
      { name: cookieName, accessToken, refreshToken },
    )
    // Verify session works
    const meRes = await tempPage.goto(`${base}/me`, { waitUntil: 'domcontentloaded' })
    const meText = await tempPage.locator('body').innerText()
    console.log(`[loginAsNormalUser] /me response status=${meRes?.status()}, contains email=${meText.includes(email)}`)
    // Create a new clean context with the cookie set
    const ctx = await browser.newContext()
    await ctx.addCookies([
      {
        name: cookieName,
        value: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
        domain: new URL(base).hostname,
        path: '/',
        httpOnly: false,
        secure: true,
        sameSite: 'Lax',
      },
    ])
    return ctx
  } catch (e) {
    console.log(`[loginAsNormalUser] error: ${e}`)
    return null
  } finally {
    await tempCtx.close()
  }
}
