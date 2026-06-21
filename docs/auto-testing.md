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

### v1.0 — 2026-06-21（闭环）

**闭环验证：**

- Auto Test #46 ✅（run id: `27905793261`，commit: `1cba748`）
- Smoke test: success
- Regression test: success
- report.md 已能正确读取 JSON，不再出现 no result file
- P0 core business 全部 pass:
  - P0-1 Approval buttons visibility per workflow status
  - P0-2 Flowchart diagram renders with nodes and instance details
  - P0-3 membership_application workflow filter
  - P0-4 email_logs status badges and metadata
- artifacts 正常产出：`regression-report` / `pw-json` / `regression-test-artifacts` / `smoke-json` / `smoke-test-artifacts`

**安全基线达成：**

- All JSON artifact 中无 `access_token` / `refresh_token` / JWT / cookie / storageState 明文
- 所有登录日志只输出 `login success: true/false`，不暴露 token 字段名
- 工作流中不会输出账号密码（secrets 只参与 `${{ }}` 布尔判断，不参与日志字符串拼接）

**已完成：**

1. 独立 Playwright 自动测试中台搭建。
2. 支持 jimmyyao.com、www.jimmyyao.com、study.jimmyyao.com、next-app-kohl-one.vercel.app 多站点 smoke test。
3. 支持 study 系统 /login、Google 登录入口、后台未登录拦截检查。
4. GitHub Actions 支持 workflow_dispatch 手动触发。
5. GitHub Actions 支持每日东京时间 23:00（UTC 14:00）自动巡检。
6. 支持 playwright-report artifact 上传。
7. 支持失败截图、录屏、trace。
8. /admin/visitors 当前 404 已标记为 known issue，后续需在业务项目中补齐或确认实际路径。
9. 支持管理员登录态 admin-auth 测试 suite。
10. 支持普通用户 e2e 测试 suite（含活动记录/访问记录/workflow 页面）。
11. P0 core business 回归测试（审批按钮可见性、流程图渲染、会员申请过滤、邮件日志状态）。
12. JSON 报告提取 → pw-json artifact → regression-report 全链路打通。
13. 安全审计：console.log 经 regex 提取时无 token 泄漏风险。

**v2.0 计划：**

1. 主站到学习系统入口测试。
2. 移动端截图测试。
3. SEO meta 检查。
4. GitHub Actions 失败通知（Slack / Email）。
5. GitHub Actions 定时触发由 UTC 14:00 改为 UTC 23:00 以适应生产发布窗口。
6. 清洁项：`ADMIN_PASSWORD configured` / `TEST_USER_PASSWORD configured` 日志合并为 `admin credentials configured` / `test user credentials configured`，避免 artifact 中出现 password 字段名。

---
*Auto Test v1.0 闭环记录于 2026-06-21*
