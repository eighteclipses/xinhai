# 心海共学 · 个人版源码快照

这是 2026-10-08 整理的个人版源码，供学习、研究和许可证允许的非商业用途使用。它提供 Windows Electron 应用和 Android 横屏 WebView 容器，包含专注计时、待办、习惯、日历、五维成长、日记回响、Markdown 知识库、复习卡片、本地音乐和自定义背景等功能。

**源码公开不等同于 OSI 定义的开源。** 自主代码采用 [PolyForm Noncommercial 1.0.0](LICENSE)，该许可证有用途限制；请以完整许可证原文为准。第三方代码保留原许可，本项目的许可不代表获得第三方素材授权。参见 [NOTICE](NOTICE) 和 [第三方说明](THIRD-PARTY-NOTICES.md)。

这是受 Persona 3 Reload 界面设计启发的**非官方粉丝项目**，与 ATLUS、SEGA 无隶属、合作或背书关系。

## 这份源码包含什么

- `src/main/`：Electron 主进程、SQLite、日记评分、知识库、备份及局域网同步。
- `src/preload/`：桌面界面与主进程之间的接口。
- `src/renderer/`：React 界面、专注与成长演出、自定义外观和播放器。
- `src/mobile/`：Android WebView 的接口适配。
- `src/shared/`：两端共享的类型、规则、数据及同步逻辑。
- `android/app/`：Android 原生容器。没有商业模块、发布密钥或本机 SDK 配置。
- `scripts/`：可以使用虚构数据运行的检查脚本。

`package.json` 的 `0.2.27-source.0` 用于标识本次源码快照，**不是已发布安装包的版本或验收声明**。这份快照整理自个人版与共享模块的当前工作代码，不能用原安装包或历史截图证明这份源码已通过全部功能验收。公开仓库根目录的旧图文和安装包记录也有各自的版本背景。

商业专用构建、品牌资源、发布候选、签名工具和商业计划没有包含在此目录中。保留的共享模块中仍能看到 `COMMERCIAL_EDITION` 等兼容分支；本目录的桌面和移动构建均将其固定为 `false`，不提供商业目标。`build:personal`、`build:public` 都是同一份个人源码构建的兼容别名。

## 素材与默认画面

第三方游戏角色、壁纸、视频、音乐、语音、字体和播放器皮肤均没有随源码分发。历史素材来源记录只用于鸣谢，不表示取得再分发权。

为了让克隆后的项目可以直接构建，源码内置三张由 SVG 代码绘制的中性示例背景、一个示例播放器外壳、项目自己的书本波浪图标，以及空音乐／语音清单。默认关闭角色立绘、语音和自动播放。日期装饰使用 CSS，专注完成预览使用示例静态画面。因此默认画面与历史演示中的游戏素材效果有差异。

可以通过界面导入自己有权使用的背景和本地音乐。历史场景文件名在 `src/shared/scenes.json` 中仅作参考，不加入默认可选场景。角色适配代码支持可选的本地 `src/renderer/public/optional/char-idle.png`、`char-focus.png`、`char-summon.png`；这些文件缺失时会隐藏对应图片，也不会影响构建。不要把未经授权的素材提交到仓库。

## 开发与构建

从公开仓库根目录进入本目录后执行下列命令；如果你已经在 `source/` 内，可跳过第一行。需要 Node.js 20 或更新版本和 npm。

```sh
cd source
npm ci
npm run typecheck
npm test
npm run check:source
npm run build
npm run build:mobile
npm run dev
```

`npm ci` 会安装 Electron 并执行原生 SQLite 依赖的安装步骤。Windows 打包使用：

```sh
npm run dist
```

桌面编译输出在 `out/`，移动网页在 `dist/mobile-web/`，Windows 安装包输出在 `dist/desktop/`。示例 Windows 配置使用 ia32；更换架构时需要按目标 Electron 架构重新安装／重建 `better-sqlite3`。仓库没有提供受信任签名证书，生成安装包不代表已签名或完成安装、升级验收。

如只做 TypeScript、纯逻辑检查和网页编译，可以先用 `npm ci --ignore-scripts` 安装；该方式跳过 Electron 下载和原生模块安装，**不能用来证明桌面应用可运行**。

Android 需要 JDK 17、Gradle 8.7、Android SDK 35 和 Build Tools 35.0.0。先执行 `npm run build:mobile`，配置本机 SDK 路径，再用已有 Gradle 构建：

```sh
gradle -p android :app:assembleDebug
```

仓库未附 Gradle wrapper。调试版 applicationId 是 `com.xinhai.study.source.qa`，发布版是 `com.xinhai.study.source`；与原个人版分开。自行构建 release 时通过 `XINHAI_SIGNING_STORE`、`XINHAI_SIGNING_PASSWORD` 提供你自己的签名，别名为 `xinhai`。未提供签名时不要把 release 输出当作可安装正式包，也不要上传密钥或密码。

## 数据与网络行为

Windows 在数据库初始化和模型配置迁移之前，明确指定独立的 `xinhai-source` 用户目录及会话目录。默认知识库是“文档”下的 `心海学习库-源码版`。源码版不自动读取原个人版数据库或知识库；手动选择已有知识库、恢复备份等操作由使用者决定。Android 使用独立 applicationId，拥有独立的应用资料。

开发或验证时可以把整个桌面资料目录放在指定位置：

```sh
npm run build
npx electron . --xinhai-profile-root=E:/Temp/Codex/xinhai-source-demo
```

也可以将 `--xinhai-profile-root=绝对目录` 传给已构建的 Electron 程序；该目录下使用独立的 `xinhai-source/` 与 `documents/` 子目录。不要把它设置为已有个人应用的资料目录。

日记、成长、待办及知识库等保存在本机。本地规则分析不访问模型。个人模式保留可选的自带 API Key 模型分析；保存了模型配置后，默认日记分析可能把当前正文发给选择的模型服务，并可能产生该服务的费用。使用前请检查地址、模型和数据范围。网易云歌单相关代码需要联网，第三方服务的可用性和使用条件由其提供方决定，仓库没有附账号、登录凭据或第三方服务授权。

历史“即时拍”服务默认关闭。只有设置 `XINHAI_ENABLE_SNAPSHOT=1` 和一个 32 到 256 字节的随机 `XINHAI_SNAPSHOT_TOKEN` 才启用；它仅监听 `127.0.0.1:7391`，请求必须携带 `Authorization: Bearer <token>`。没有局域网公开监听、通配 CORS 或日记正文日志。不要把令牌提交到仓库。

## 验证范围

`npm test` 覆盖选取的模型地址、离线评分、备份格式、播放器恢复相关逻辑、场景动效、客户端状态边界，以及即时拍默认关闭和鉴权行为。检查使用虚构输入，不读取原个人学习库。

`npm run typecheck` 与两种构建检查类型、依赖和编译入口。`npm run check:source` 检查发布文件范围、敏感文件名、已知真实日记标记、商业构建入口与素材引用。它们不能证明不存在任何秘密，也不替代完整安全评估、全部功能测试或设备验收。

本次整理的实际命令和结果见 [源码检查记录](docs/source-validation.md)。未执行的 Windows 安装／卸载／升级、Android APK 构建和真机功能，不会标成通过。
