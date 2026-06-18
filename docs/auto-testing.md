# Auto Testing Documentation

> 自动化测试中台项目 jimmyyao-auto-test

---

## 如何新增站点

1. 打开 `configs/sites.ts`。
2. 在 `sites` 数组中追加一个新条目：

```ts
{
  name: 'your-site-name',
  url: 'https://your-site-url.com',
}
```

3. 添加后，`@smoke` 测试将自动覆盖新站点首页。

---

## 如何新增测试

1. 在 `tests/sites/` 目录下新建 `*.spec.ts` 文件。
2. 使用 Playwright test API 编写测试用例：

```ts
import { test, expect } from '@playwright/test'

test('your test name @your-tag', async ({ page }) => {
  await page.goto('https://example.com')
  await expect(page.locator('body')).toBeVisible()
})
```

3. 使用 `@` 标签归类（如 `@smoke`、`@study`），以便通过 `--grep` 筛选运行。

---

## 如何本地运行

```bash
# 安装依赖
npm install

# 安装浏览器
npx playwright install chromium

# 运行所有测试
npm test

# 有头模式运行
npm run test:headed

# 仅运行 smoke 测试
npm run test:smoke

# 仅运行 study 测试
npm run test:study
```

---

## 如何查看报告

```bash
npm run test:report
```

该命令会启动一个本地 HTTP 服务器，在浏览器中打开 HTML 报告。报告包含测试概览、通过/失败详情、日志等信息。

报告文件位于 `playwright-report/` 目录。

---

## 如何查看失败录屏和 Trace

### 录屏 (Video)

- 测试失败时，视频会自动保留在 `test-results/` 目录。
- 文件命名格式：`{测试文件}-{测试名}-{浏览器}.webm`。
- 直接用浏览器或播放器打开 `.webm` 文件即可观看。

### Trace Viewer

- 测试失败时，Trace 文件会自动保留在 `test-results/` 目录，后缀为 `.zip`。
- 查看 Trace：

```bash
npx playwright show-trace path/to/trace.zip
```

- 该命令会打开 Trace Viewer，可以逐步骤查看 DOM 快照、网络请求、Console 日志和时间线。

### CI 中查看

- GitHub Actions 运行失败后，`playwright-report` 和 `test-results` 会作为 Artifact 上传。
- 进入 Action 详情页 → Artifacts 区域 → 下载对应文件解压即可查看。

---

## 版本记录

### v1.0 — 2026-06-18（已定版）

**已完成：**

1. 独立 Playwright 自动测试中台搭建。
2. 支持 jimmyyao.com、www.jimmyyao.com、study.jimmyyao.com、next-app-kohl-one.vercel.app 多站点 smoke test。
3. 支持 study 系统 /login、Google 登录入口、后台未登录拦截检查。
4. GitHub Actions 支持 workflow_dispatch 手动触发。
5. GitHub Actions 支持每日东京时间 8:00 自动巡检。
6. 支持 playwright-report artifact 上传。
7. 支持失败截图、录屏、trace。
8. /admin/visitors 当前 404 已标记为 known issue，后续需在业务项目中补齐或确认实际路径。

**v1.1 计划：**

1. 主站到学习系统入口测试。
2. 移动端截图测试。
3. SEO meta 检查。
4. GitHub Actions 失败通知。
5. /admin/visitors 业务页面补齐跟踪。
