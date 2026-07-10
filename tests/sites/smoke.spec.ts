import { test, expect } from '@playwright/test'
import { sites } from '../../configs/sites'

const errorPatterns = [
  /Application error/i,
  /This page could not be found/,
  /500/,
  /502/,
  /503/,
  /504/,
  /Internal Server Error/i,
  /Service Unavailable/i,
  /Bad Gateway/i,
  /Deployment Not Found/i,
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

      // Allow 200-399, or 404 that isn't a genuine not-found page
      if (status === 404) {
        const bodyText = await page.locator('body').innerText()
        const genuinelyNotFound =
          /This page could not be found/.test(bodyText) || /Page not found/i.test(bodyText)
        expect(genuinelyNotFound).toBe(false)
      } else {
        expect(status).toBeGreaterThanOrEqual(200)
        expect(status).toBeLessThan(400)
      }

      const body = page.locator('body')
      await expect(body).toBeVisible()
      console.log('✓ body is visible')

      // Give deferred rendering a bounded window. Some portals keep long-lived\n      // requests open, so networkidle is not a reliable readiness signal.\n      await page.waitForTimeout(1500)\n\n      // Catch any errors that surface after the initial load\n      await expect.poll(() => errors, { timeout: 5000 }).toHaveLength(0)

      // Re-check body is still visible after deferred rendering
      await expect(body).toBeVisible()

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
