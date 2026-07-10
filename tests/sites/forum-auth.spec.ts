import { test, expect, type Browser, type BrowserContext } from '@playwright/test'

const forumOrigin = 'https://forum.jimmyyao.com'
const adminOrigin = 'https://admin.jimmyyao.com'
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ycjuceortcduakxscfes.supabase.co'
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InljanVjZW9ydGNkdWFreHNjZmVzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg4ODA4ODMsImV4cCI6MjA5NDQ1Njg4M30.DZ92IY5x24eSuxbQBrisuJOQXLKMmF2LqQap-lK11kM'
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)/)?.[1] || 'ycjuceortcduakxscfes'

const userEmail = process.env.TEST_USER_EMAIL
const userPassword = process.env.TEST_USER_PASSWORD
const adminEmail = process.env.ADMIN_EMAIL
const adminPassword = process.env.ADMIN_PASSWORD
const credentialsConfigured = Boolean(userEmail && userPassword && adminEmail && adminPassword)

async function authenticatedContext(browser: Browser, email: string, password: string) {
  const bootstrap = await browser.newContext()
  let response: Awaited<ReturnType<typeof bootstrap.request.post>> | null = null
  let session: Record<string, any> = {}

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    response = await bootstrap.request.post(
      `${supabaseUrl}/auth/v1/token?grant_type=password`,
      {
        headers: {
          apikey: supabaseKey,
          'Content-Type': 'application/json',
        },
        data: { email, password },
      },
    )
    session = await response.json()
    if (response.ok() && session.access_token) break
    if (response.status() !== 429 || attempt === 3) break
    await new Promise((resolve) => setTimeout(resolve, attempt * 5000))
  }
  await bootstrap.close()

  expect(response?.ok(), `Supabase login failed for ${email.slice(0, 4)}*** (status ${response?.status()})`).toBe(true)
  expect(session.access_token).toBeTruthy()

  const context = await browser.newContext()
  await context.addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: JSON.stringify({
        access_token: session.access_token,
        refresh_token: session.refresh_token || '',
        expires_in: session.expires_in || 3600,
        expires_at: session.expires_at || Math.floor(Date.now() / 1000) + 3600,
        token_type: session.token_type || 'bearer',
        user: session.user,
      }),
      domain: '.jimmyyao.com',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
      expires: Math.floor(Date.now() / 1000) + 3600,
    },
  ])
  return context
}

test.describe('Forum authenticated moderation closure @forum-auth', () => {
  test.describe.configure({ mode: 'serial', timeout: 120_000 })

  let userContext: BrowserContext
  let adminContext: BrowserContext

  test.beforeAll(async ({ browser }) => {
    if (!credentialsConfigured) {
      if (process.env.CI) {
        throw new Error('Forum closure requires TEST_USER_EMAIL, TEST_USER_PASSWORD, ADMIN_EMAIL, and ADMIN_PASSWORD')
      }
      return
    }

    userContext = await authenticatedContext(browser, userEmail!, userPassword!)
    adminContext = await authenticatedContext(browser, adminEmail!, adminPassword!)
  })

  test.afterAll(async () => {
    await userContext?.close()
    await adminContext?.close()
  })

  test('post -> pending -> approve -> public -> comment -> hide -> restore', async ({ browser }) => {
    test.skip(!credentialsConfigured, 'Controlled normal-user and admin credentials are required')

    const anonymousContext = await browser.newContext()
    const anonymousPage = await anonymousContext.newPage()
    const userPage = await userContext.newPage()
    const adminPage = await adminContext.newPage()

    const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const title = `Forum E2E ${runId}`
    const body = `Automated Forum Issue 2 acceptance body ${runId}.`
    const comment = `Automated Forum Issue 2 comment ${runId}.`
    let postId = ''

    try {
      await anonymousPage.goto(`${forumOrigin}/posts/new`, { waitUntil: 'domcontentloaded' })
      await expect(anonymousPage.getByRole('heading', { name: '登录后可以发帖', exact: true })).toBeVisible()
      await expect(anonymousPage.locator('form.postForm')).toHaveCount(0)

      const anonymousAdminResponse = await anonymousContext.request.post(
        `${adminOrigin}/api/admin/forum/posts/00000000-0000-0000-0000-000000000000`,
        { data: { action: 'approve' } },
      )
      expect(anonymousAdminResponse.status()).toBe(401)

      await userPage.goto(`${forumOrigin}/posts/new`, { waitUntil: 'domcontentloaded' })
      await expect(userPage.locator('form.postForm')).toBeVisible()
      await userPage.locator('select[name="category"]').selectOption({ index: 1 })
      await userPage.locator('input[name="title"]').fill(title)
      await userPage.locator('textarea[name="body"]').fill(body)
      await userPage.getByRole('button', { name: '提交审核' }).click()

      await expect(userPage).toHaveURL(/\/posts\/new\?.*submitted=1/)
      const submittedUrl = new URL(userPage.url())
      expect(submittedUrl.searchParams.get('status')).toBe('pending')
      const slug = submittedUrl.searchParams.get('slug')
      expect(slug).toBeTruthy()
      await expect(userPage.getByText('已提交，等待审核。')).toBeVisible()

      await anonymousPage.goto(`${forumOrigin}/posts`, { waitUntil: 'domcontentloaded' })
      await expect(anonymousPage.getByText(title, { exact: true })).toHaveCount(0)

      await adminPage.goto(
        `${adminOrigin}/forum?q=${encodeURIComponent(title)}&status=pending&range=24h`,
        { waitUntil: 'domcontentloaded' },
      )
      const postLink = adminPage.getByRole('link', { name: title, exact: true })
      await expect(postLink).toBeVisible()
      const postHref = await postLink.getAttribute('href')
      postId = postHref?.split('/').pop() || ''
      expect(postId).toMatch(/^[0-9a-f-]{36}$/i)

      const ordinaryApproveResponse = await userContext.request.post(
        `${adminOrigin}/api/admin/forum/posts/${postId}`,
        { data: { action: 'approve' } },
      )
      expect(ordinaryApproveResponse.status()).toBe(403)

      const ordinaryCommentAdminResponse = await userContext.request.post(
        `${adminOrigin}/api/admin/forum/comments/00000000-0000-0000-0000-000000000000`,
        { data: { action: 'hide' } },
      )
      expect(ordinaryCommentAdminResponse.status()).toBe(403)

      const approveResponse = await adminContext.request.post(
        `${adminOrigin}/api/admin/forum/posts/${postId}`,
        {
          data: {
            action: 'approve',
            review_note: `Playwright Forum Issue 2 ${runId}`,
          },
        },
      )
      expect(approveResponse.status()).toBe(200)
      expect((await approveResponse.json()).ok).toBe(true)

      const publicPostUrl = `${forumOrigin}/posts/${slug}`
      await expect.poll(async () => {
        await anonymousPage.goto(publicPostUrl, { waitUntil: 'domcontentloaded' })
        return await anonymousPage.getByText(title, { exact: true }).count()
      }).toBe(1)

      await expect(anonymousPage.getByText('请登录后回复。')).toBeVisible()
      await expect(anonymousPage.locator('form.commentForm')).toHaveCount(0)

      await userPage.goto(publicPostUrl, { waitUntil: 'domcontentloaded' })
      await userPage.locator('textarea[name="body"]').fill(comment)
      await userPage.getByRole('button', { name: '提交回复' }).click()
      await expect(userPage).toHaveURL(/comment=posted/)
      await expect(userPage.getByText(comment, { exact: true })).toBeVisible()

      await adminPage.goto(`${adminOrigin}/forum/posts/${postId}`, {
        waitUntil: 'domcontentloaded',
      })
      const adminComment = adminPage.getByText(comment, { exact: true })
      await expect(adminComment).toBeVisible()
      const commentBlock = adminComment.locator('..')

      adminPage.once('dialog', (dialog) => dialog.accept())
      await commentBlock.getByRole('button', { name: 'Hide' }).click()
      await expect.poll(async () => {
        await adminPage.reload({ waitUntil: 'domcontentloaded' })
        return await adminPage
          .getByText(comment, { exact: true })
          .locator('..')
          .getByRole('button', { name: 'Restore' })
          .count()
      }).toBe(1)

      await expect.poll(async () => {
        await anonymousPage.reload({ waitUntil: 'domcontentloaded' })
        return await anonymousPage.getByText(comment, { exact: true }).count()
      }).toBe(0)

      const restoredComment = adminPage.getByText(comment, { exact: true }).locator('..')
      adminPage.once('dialog', (dialog) => dialog.accept())
      await restoredComment.getByRole('button', { name: 'Restore' }).click()

      await expect.poll(async () => {
        await anonymousPage.reload({ waitUntil: 'domcontentloaded' })
        return await anonymousPage.getByText(comment, { exact: true }).count()
      }).toBe(1)
    } finally {
      if (postId) {
        await adminContext.request.post(
          `${adminOrigin}/api/admin/forum/posts/${postId}`,
          {
            data: {
              action: 'hide',
              review_note: `Automated cleanup after Forum Issue 2 ${runId}`,
            },
          },
        )
      }
      await anonymousContext.close()
      await userPage.close()
      await adminPage.close()
    }
  })
})
