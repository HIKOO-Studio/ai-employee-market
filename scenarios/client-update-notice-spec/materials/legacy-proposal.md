# 客户端启动更新提醒：历史实施方案（初稿）

> 背景：希望用户在打开桌面客户端时，如果本机从市场安装过的资源有新版本，主窗口可以自动提醒用户。

## 初步实现思路

1. **启动查新**
   - 应用启动后异步请求 `POST /api/market/check-updates`。
   - 请求参数固定传 `channel: "stable"` 和本机已安装资源列表 `installed`。
   - 拿到返回后，读取 `result.updates` 数组，如果长度大于 0，就在主窗口展示更新提醒。

2. **提醒展示方式**
   - 在 `.workspace` 顶部插入一个 `#update-notice` 容器，样式采用：
     ```css
     .workspace:has(> #update-notice:not([hidden])) {
       grid-template-rows: auto 1fr;
     }
     ```
   - `#update-notice` 外层铺 `background: var(--paper-raised)`，里面套一个圆角带边框的 `.notice-box` 显示文案和按钮。

3. **避免重复打扰（已读去重）**
   - 为了防止用户每次启动都重复看到同一条提醒，在提醒容器展示后，经过两次 `requestAnimationFrame`（约 32ms）且窗口处于激活状态时，立即调用 `store.acknowledge(ids)` 写入本地数据库，下次启动不再提示。

4. **点击查看**
   - 提醒条上放「前往市场查看」和「关闭」两个按钮。
   - 点击「前往市场查看」时，立即清空当前提醒状态并调用 `onOpenMarket(items)` 跳转到市场页。
