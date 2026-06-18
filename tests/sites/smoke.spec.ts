import { test, expect } from '@playwright/test'
import { sites } from '../../configs/sites'

const errorPatterns = [
  /Application error/i,
  /This page could not be found/,
  /500/,
  /Internal Server Error/i,
]

test.describe('Smoke tests', () => {
  for (const site of sites) {
    test(`${site.name} - homepage loads successfully @smoke`, async ({ page }) => {
      const errors: string[] = []

      page.on('pageerror', (err) => {
        errors.push(err.message)
      })

      console.log(`\n=== Smoke test: ${site.name} ===`)
      console.log(`URL: ${site.url}`)

      const response = await page.goto(site.url, { waitUntil: 'domcontentloaded' })

      const status = response?.status() ?? 0
      console.log(`HTTP status: ${status}`)
      console.log(`Final URL: ${page.url()}`)
      console.log(`Title: ${await page.title()}`)

      expect(errors).toHaveLength(0)

      if (status >= 200 && status < 400) {
        expect(status).toBeLessThan(400)
        console.log('✓ HTTP status in 200-399 range')
      } else if (status === 404) {
        const bodyText = await page.locator('body').innerText()
        console.log('⚠ HTTP 404 — checking whether page genuinely not found')
        if (/This page could not be found/.test(bodyText) || /Page not found/i.test(bodyText)) {
          console.log('✗ Page is genuinely not found')
        }
        expect(status).toBeLessThan(400)
        console.log('✓ HTTP 404 but body shows valid content, passing')
      } else {
        expect(status).toBeLessThan(400)
      }

      const body = page.locator('body')
      await expect(body).toBeVisible()
      console.log('✓ body is visible')

      const text = await body.innerText()
      console.log(`Body preview (first 300 chars): ${text.slice(0, 300).replace(/\n/g, '\\n')}`)

      for (const pattern of errorPatterns) {
        if (pattern.test(text)) {
          console.log(`✗ Found error pattern: ${pattern}`)
        }
        expect(text).not.toMatch(pattern)
      }

      console.log('✓ All error pattern checks passed')
    })
  }
})
