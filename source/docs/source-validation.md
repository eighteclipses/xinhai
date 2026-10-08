# 源码快照检查记录

快照日期：2026-10-08。源码标识：`0.2.27-source.0`。

本文件记录这份独立源码的检查，不沿用旧个人安装包或商业候选的验证结论。检查期间只操作独立源码目录及临时目录，不运行原个人版，也不读取真实学习库。

## 已执行

运行环境：Windows、Node.js `22.15.1`、npm。依赖缓存使用 `E:\CodexData\cache\npm`，临时文件使用 `E:\Temp\Codex\xinhai-source-public-check`；设置的 Electron 与 electron-builder 缓存也在 E 盘。

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm ci --ignore-scripts --prefer-offline --cache E:\CodexData\cache\npm --no-fund --no-audit` | 通过 | 独立目录安装 523 个依赖；跳过 Electron 下载与原生模块安装脚本 |
| `npm run typecheck` | 通过，退出码 0 | `tsc --noEmit` |
| `npm run build` | 通过，退出码 0 | 编译个人桌面的 main、preload、renderer；不需要私有素材和商业 runtime |
| `npm run build:mobile` | 通过，退出码 0 | 编译移动网页，输出 `dist/mobile-web/` |
| `npm test` | 通过，退出码 0 | 11 个脚本；离线评分含 25 个脚本内虚构例子；仅逻辑与模拟接口检查 |
| `node scripts/check-source.cjs` | 通过，退出码 0 | 发布文件范围、许可证原文哈希、已知敏感内容、独立用户目录、默认素材与构建入口检查 |

首次 `npm test` 因旧评分脚本引用未包含的商业发行测试文件而停止。已去掉该私有路径依赖，公开脚本仅使用它自身的虚构例子；完整重跑 11 个脚本后通过。没有复制商业发行测试资料，也没有用商业测试结果代替个人源码测试。

构建过程有 Vite CJS Node API 的弃用提示，但未导致编译失败。依赖安装没有执行安全漏洞审计；本记录不声称依赖已无已知漏洞。

官方 PolyForm 原文从 `https://polyformproject.org/licenses/noncommercial/1.0.0.txt` 下载，LICENSE 的 SHA-256 为 `ffcca38841adb694b6f380647e15f17c446a4d1656fed51a1e2041d064c94cc8`。没有修改正文或将第三方素材纳入许可。

## 默认行为与审查

Windows 在调用数据库初始化、旧模型配置迁移前，固定使用独立的 `xinhai-source` 用户目录及会话目录。默认知识库为 `心海学习库-源码版`。此结论来自代码顺序审查与发布检查；没有通过运行真实个人数据库来验证。

即时拍测试用模拟 HTTP server 检查：默认不创建监听器；缺少随机令牌不创建监听器；显式开启时只绑定 `127.0.0.1:7391`；错误或缺失鉴权返回 401；路径需准确匹配 `/snapshot`；不发送通配 CORS。测试没有实际开放端口或发起模型请求。

三张中性 SVG 背景、示例播放器外壳和项目图标均包含在源码里。角色静态 import 已移除，缺少可选图片时隐藏；音乐和语音清单为空。编译成功证明代码可以脱离私有素材构建，不代表画面已连续观看或功能已完成验收。

## 未执行

Windows 安装、卸载、覆盖升级、发布签名、完整 Electron 运行流程、Android APK 构建、平板或手机真机运行、真实模型质量、在线音乐服务可用性均未验证。

`npm ci --ignore-scripts` 跳过的 Electron／原生模块安装仍需开发者按 README 执行完整安装或重建后验证。共享模块中保留的关闭条件分支不等于商业目标可构建；本目录没有提供该目标。
