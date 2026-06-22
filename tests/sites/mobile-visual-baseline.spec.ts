import { test, expect } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import { mkdirSync } from 'fs'
import { join } from 'path'

const base = process.env.BASE_URL || 'https://study.jimmyyao.com'
const SCREENSHOTS_DIR = 'test-results/screenshots'
const MOBILE_DIR = join(SCREENSHOTS_DIR, 'mobile')

const MOBILE_VIEWPORT = { width: 390, height: 844 }

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'

const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const needsSetup = !adminEmail || !adminPassword

const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'ycjuceortcduakxscfes'

let adminCtx: BrowserContext | null = null

interface PageDef {
  path: string
  label: string
  auth: boolean
}

const PUBLIC_PAGES: PageDef[] = [
  { path: '/lessons', label: 'lessons', auth: false },
  { path: '/lessons/1', label: 'lessons-1', auth: false },
  { path: '/toolbox', label: 'toolbox', auth: false },
]

const ADMIN_PAGES: PageDef[] = [
  { path: '/admin/workflows', label: 'admin-workflows', auth: true },
  { path: '/admin/activity', label: 'admin-activity', auth: true },
  { path: '/admin/visitors', label: 'admin-visitors', auth: true },
  { path: '/admin/email-logs', label: 'admin-email-logs', auth: true },
]

const ALL_PAGES = [...PUBLIC_PAGES, ...ADMIN_PAGES]

async function saveScreenshot(page: import('@playwright/test').Page, name: string) {
  try { mkdirSync(MOBILE_DIR, { recursive: true }) } catch {}
  const filePath = join(MOBILE_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
  console.log(`Screenshot saved: ${filePath}`)
}

async function waitForLoadComplete(page: import('@playwright/test').Page, tag: string, timeout = 15000) {
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

const projectRef_ = projectRef
const supabaseUrl_ = supabaseUrl
const supabaseKey_ = supabaseKey

test.describe('P1-1 Mobile visual baseline @mobile-visual', () => {
  test.beforeAll(async ({ browser }) => {
    if (needsSetup) {
      console.log('[mobile-visual] Admin login skipped: credentials not configured')
      return
    }
    const ctx = await browser.newContext()
    const page = await ctx.newPage()
    try {
      const res = await page.request.post(
        `${supabaseUrl_}/auth/v1/token?grant_type=password`,
        {
          headers: { apikey: supabaseKey_, 'Content-Type': 'application/json' },
          data: { email: adminEmail, password: adminPassword },
        },
      )
      const body = await res.json()
      if (body.access_token) {
        const expiresDate = body.expires_at
          ? new Date(body.expires_at * 1000)
          : new Date(Date.now() + 3600 * 1000)
        await ctx.addCookies([
          {
            name: `sb-${projectRef_}-auth-token`,
            value: JSON.stringify({
              access_token: body.access_token,
              refresh_token: body.refresh_token || '',
              token_type: body.token_type || 'bearer',
              expires_in: body.expires_in || 3600,
              expires_at: body.expires_at || Math.floor(Date.now() / 1000) + 3600,
            }),
            domain: new URL(base).hostname,
            path: '/',
            httpOnly: true,
            secure: true,
            sameSite: 'Lax' as const,
            expires: expiresDate.getTime() / 1000,
          },
        ])
        // Verify session works
        const meRes = await page.goto(`${base}/me`, { waitUntil: 'domcontentloaded' })
        const ok = meRes?.status() === 200
        console.log(`[mobile-visual] Admin login: access_token=${!!body.access_token}, /me status=${meRes?.status()}`)
        if (ok) {
          adminCtx = ctx
        } else {
          await ctx.close()
        }
      } else {
        console.log(`[mobile-visual] Admin login failed: ${body.error || 'unknown'}`)
        await ctx.close()
      }
    } catch (e) {
      console.log(`[mobile-visual] Admin login error: ${e}`)
      await ctx.close()
    }
  })

  test.afterAll(async () => {
    if (adminCtx) await adminCtx.close()
  })

  async function checkPage(page: import('@playwright/test').Page, def: PageDef) {
    const { path, label } = def
    const warnings: string[] = []

    // 1. Navigate
    const resp = await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 20000 })
    await waitForLoadComplete(page, label)

    // 2. Not 404
    const status = resp?.status() ?? 0
    const bodyText = await page.locator('body').innerText()
    if (status === 404 || bodyText.includes('404') && bodyText.includes('Not Found')) {
      await saveScreenshot(page, `${label}-404`)
      expect(status).not.toBe(404)
      expect(bodyText).not.toContain('Not Found')
    }
    console.log(`[${label}] status=${status}`)

    // 3. Content visible — page should contain some text beyond blanks
    const textLen = bodyText.replace(/\s+/g, '').length
    expect(textLen).toBeGreaterThan(0)

    // 4. Check bottom navigation overlap
    const viewportH = page.viewportSize()?.height || 844
    // Look for common bottom nav selectors
    const navSelectors = ['nav:last-of-type', '[role="navigation"]:last-of-type', '.bottom-nav', '.tab-bar', 'footer:last-of-type']
    for (const sel of navSelectors) {
      const el = page.locator(sel).first()
      if (await el.isVisible().catch(() => false)) {
        const box = await el.boundingBox()
        if (box) {
          // Nav is at the bottom if its top is near or below the viewport bottom
          if (box.y + box.height > viewportH - 10) {
            // Bottom nav found — check last interactive element
            const lastInteractive = page.locator('button, a:visible, [role="button"]:visible, input:visible').last()
            if (await lastInteractive.isVisible().catch(() => false)) {
              const btnBox = await lastInteractive.boundingBox()
              if (btnBox && btnBox.y + btnBox.height > box.y) {
                warnings.push(`bottom-nav: last interactive element (y=${btnBox.y + btnBox.height}) overlaps nav (y=${box.y})`)
              }
            }
          }
        }
        break
      }
    }

    // 5. Check table horizontal overflow
    const tables = page.locator('table')
    const tableCount = await tables.count()
    for (let i = 0; i < tableCount; i++) {
      const tBox = await tables.nth(i).boundingBox()
      if (tBox && tBox.width > MOBILE_VIEWPORT.width + 5) {
        warnings.push(`table-${i}: width ${tBox.width}px > viewport ${MOBILE_VIEWPORT.width}px`)
      }
    }

    // 6. Check for horizontal scrollbar on body
    const hasHScroll = await page.evaluate(() => document.body.scrollWidth > document.documentElement.clientWidth + 5)
    if (hasHScroll) {
      warnings.push(`horizontal scroll detected (body scrollWidth > clientWidth)`)
    }

    // 7. Take screenshot
    await saveScreenshot(page, label)

    // 8. Report warnings (don't fail)
    if (warnings.length > 0) {
      console.log(`⚠️ [${label}] Visual warnings:`)
      for (const w of warnings) {
        console.log(`  ⚠️ ${w}`)
      }
    }
  }

  // ── Public pages (no auth) ──
  for (const def of PUBLIC_PAGES) {
    test(`P1-1 mobile ${def.label} @mobile-visual`, async ({ browser }) => {
      const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT })
      const page = await ctx.newPage()
      try {
        await checkPage(page, def)
      } finally {
        await ctx.close()
      }
    })
  }

  // ── Admin pages (auth required) ──
  for (const def of ADMIN_PAGES) {
    test(`P1-1 mobile ${def.label} @mobile-visual`, async ({ browser }) => {
      test.skip(needsSetup || !adminCtx, 'ADMIN_EMAIL/PASSWORD not configured or login failed')
      const ctx = await browser.newContext({ viewport: MOBILE_VIEWPORT, storageState: await adminCtx!.storageState() })
      const page = await ctx.newPage()
      try {
        await checkPage(page, def)
      } finally {
        await ctx.close()
      }
    })
  }
})
