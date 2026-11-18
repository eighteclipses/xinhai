# AGENTS.md — 心海共学 (Study in the Blue)

本文件仅保留机器检查无法替代的架构边界与产品判断准则。能写成静态规则或测试的约束，一律放入 `.oxlintrc.json` 与 `tests/*.test.mjs`。

## 1. 确定性内循环（提交前必跑）

每次修改代码后，单 Agent 必须先在本地跑通确定性门禁并自证通过：

```bash
npm run check
npm run build
```

- `npm run check`（`scripts/check.mjs`）会自动定位 `E:\CodexData\tools\node-v24.22.3-win-x64\node.exe`（规避 Windows 默认 32 位 Node 导致 `tsgolint` 崩溃与 `.ts` 测试加载失败），并将 `TEMP` / `TMP` / `npm_config_cache` 定向至 E 盘缓存目录，依次执行：
  1. `tsc --noEmit`（零类型错误，禁止新增 `any`）
  2. `oxlint`（零警告、零错误，含 React Compiler 纯度与 Effect 级联检查）
  3. `oxfmt --check`（代码格式一致）
  4. `node --test tests/domain.test.mjs tests/architecture.test.mjs`
- 若修改了 `app/api/**` 或 `db/**`，需在本地开发服务启动后额外运行 `node --test tests/api.test.mjs`。

## 2. 架构与性能边界

1. **高频状态叶节点隔离**：`app/study-app.tsx` 严禁挂载秒级 `setInterval`。顶栏时钟置于 `components/ambient-clock.tsx`（按分钟对齐 + `tabular-nums`），倒计时置于 `components/focus-timer-card.tsx`（仅 `timer.status === 'running'` 时运行）。
2. **壁纸与合成层预算**：
   - 严禁在同一 DOM 图层同时使用无限帧动画与 `filter: drop-shadow(...)`。
   - 视频壁纸必须在 `document.hidden` 或 `reducedMotion` 时暂停解码。
   - 用户自定义壁纸仅存客户端 IndexedDB（`lib/wallpapers.ts`，上限 40 MB），必须支持随时删除并自动释放 `ObjectURL`、安全回退默认背景。
3. **全端自适应与材质一致性**：
   - 支持 Mac、iPad（含竖屏与 Split View 分屏）、Windows、安卓平板及手机，禁止恢复竖屏遮罩封锁。
   - 玻璃表面统一通过 `.glass-surface` / `.glass-dock`（含 `-webkit-backdrop-filter` 与 `@supports` 回退）渲染，并提供高对比 `frosted` 雾面模式与 `hideOrnaments` 装饰隐藏开关。

## 3. 产品与数据准则

- **禁止虚构用户数据**：新账户初始为空，严禁注入示例任务或假日记。
- **五维结算诚实性**：五维仅为可解释、可手动微调的行为反馈；未确认记录或已关联（`linkedId`）的补充记录不得重复累加经验。
- **洗掉 AI 味**：界面文案保持克制、简洁、直接，不向用户展示内部技术免责声明或说教式引导语。
- **文件安全边界**：未经用户明确授权，不得删除 `components/ui/**` 模板组件、`public/assets/**` 既有素材或上一级目录中的文档与美术资源。
