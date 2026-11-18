# 心海共学 0.2

面向 Mac、iPad、Windows、安卓平板（小米 / OPPO 等）与手机全端自适应的个人学习陪伴工具。新建账户无虚构记录。

## 核心能力

- **专注与任务闭环**：任务增删改与完成、专注 / 休息服务端权威计时、跨刷新与锁屏唤醒恢复、日历日程、日常习惯、随手便签。
- **行动记录与五维反馈**：随手拍记与日记、本地文字规则提取行动证据、手动微调确认五维点数、同次行动关联防重复计分、JSON / Markdown / CSV 导出。
- **跨端液态玻璃与零抖动体验**：
  - 统一全平台液态玻璃（Liquid Glass）折射表面，支持一键切换高对比「深海雾面」。
  - 装饰性英文与模块编号默认半透明，支持在「设置」中一键隐藏。
  - 顶栏时钟与专注倒计时叶节点隔离渲染 + `tabular-nums` 等宽数字，消除平板每秒重绘抖动。
  - 支持内置背景切换与本地图片 / 视频壁纸（≤ 40 MB，IndexedDB 本地存储）导入及一键删除释放空间；切入后台自动暂停视频解码。

## 开发与确定性门禁

需要 64 位 Node.js ≥ 22.13（推荐 Node 24）。仓库内置 `scripts/check.mjs`，在存在 `E:\CodexData\tools\node-v24.22.3-win-x64` 时会自动切换 64 位运行时并将临时/缓存目录定向至 E 盘：

```bash
npm run check   # 依次执行 tsc + oxlint + oxfmt --check + 领域与架构测试
npm run build   # 构建生产产物 (vinext build)
npm run dev     # 启动本地开发服务
```

首次初始化本地 D1 数据库：

```bash
npx wrangler d1 execute DB --local --config wrangler.local.json --file drizzle/0000_brave_pestilence.sql
```

API 集成测试（需先启动本地服务，会写入并清理测试记录）：

```bash
node --test tests/api.test.mjs
```

## 接口概览

- `GET /api/state`：当前登录用户的完整记录快照。
- `POST /api/records`：`{ id, kind, version, data }` 创建或乐观锁更新；`remove: true` 删除，旧版本返回 `409`。
- `POST /api/timer`：`start / pause / resume / finish`，服务端权威计算时长，完成记录与状态重置在同一 D1 批处理内完成。
- `POST /api/photos` & `GET /api/photos/:id`：按文件魔数校验 JPG / PNG / WebP（≤ 6 MB），仅所有者可读。
