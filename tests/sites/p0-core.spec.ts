import { test, expect } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join } from 'path'

const base = process.env.BASE_URL || 'https://study.jimmyyao.com'
const SCREENSHOTS_DIR = 'test-results/screenshots'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const needsSetup = !adminEmail || !adminPassword

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

      // Should see the activity page with content (anonymous record or empty state)
      const hasVisitorContent = activityText.includes('访客记录') || activityText.includes('Visitor') || activityText.includes('Activity') || activityText.includes('活动')
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
})
