# 构建源码版

本目录是 `0.2.35-source.0`，代码来自个人版 0.2.35，包含本地音乐管理与电脑更新指引，并保留专注奖励、备份 v3、同步 v3、自定义导航和原生提醒桥接。本次未执行实体平板验收。源码版使用中性素材与独立应用身份；完整个人安装包在仓库的 Releases 下载。

## 依赖

- Node.js 20 或更新版本，以及 npm。
- Windows 桌面运行需要 Electron 与匹配其架构/ABI 的 `better-sqlite3`。`npm ci` 会执行安装步骤；需要编译原生依赖时还需相应的 C++ 编译工具。
- Android APK 构建另外需要 JDK 17、Gradle 8.7、Android SDK 35 与 Build Tools 35.0.0。仓库没有 Gradle wrapper、本机 SDK 路径或签名密钥。

从仓库根目录进入 `source/`：

```sh
cd source
npm ci
npm run typecheck
npm test
npm run check:source
npm run build
npm run build:mobile
```

锁文件使用 npm 官方 registry。不要在安装配置中填写或提交其他人的账号、令牌与机器路径。需要自选缓存目录时，可以设置 `npm_config_cache`、`ELECTRON_CACHE` 和 `GRADLE_USER_HOME`；它们不应加入 Git。

## Windows

```sh
npm run dev
```

生产编译后运行：

```sh
npx electron .
```

可指定全新的隔离资料根目录，例如 Windows 的 E 盘临时目录：

```sh
npx electron . --xinhai-profile-root=E:/Temp/Codex/xinhai-source-demo
```

源码版会在该目录下建立 `xinhai-source/` 和 `documents/` 子目录。未指定时，也使用独立的 `xinhai-source` 用户/会话目录与“心海学习库-源码版”默认知识库，不自动发现原个人版资料。不要把测试目录指向真实学习库或其他应用资料。

生成 Windows 安装包：

```sh
npm run dist
```

默认 Windows 包使用 ia32，输出在 `dist/desktop/`；编译产物在 `out/`。切换 Electron 或打包架构时，必须重建匹配的原生 SQLite 依赖。仓库未提供受信任签名证书；自行构建和成功生成安装程序都不代表已经完成签名、安装、升级和卸载验收。

## Android

```sh
npm run build:mobile
gradle -p android :app:assembleDebug
```

移动网页输出到 `dist/mobile-web/`，由 Android 原生容器作为 assets 打包。请在本机配置 SDK 路径，不要提交 `android/local.properties`。

源码发布包名为 `com.xinhai.study.source`，调试包名为 `com.xinhai.study.source.qa`；它们与完整个人版分开，不可用源码示例 APK 冒充原个人包或覆盖原资料。自行生成 release 时，通过 `XINHAI_SIGNING_STORE` 与 `XINHAI_SIGNING_PASSWORD` 提供自己的签名，别名为 `xinhai`。不随仓库提供作者的密钥与签名凭据。

Android 的通知、准时提醒与后台活动权限由用户明确选择。WebView 被系统冻结时，前台恢复会处理逻辑阶段；异常退出继续保留显式恢复选择。编译成功不能证明某一设备能按时发声。

## 只做源码检查

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run build
npm run build:mobile
```

`--ignore-scripts` 跳过 Electron 下载及原生依赖安装，可用于类型、纯逻辑和编译检查；这样安装后不能直接证明桌面程序可运行。

可选的真实 SQLite 奖励检查：

```sh
npm run test:native
```

它需要已经安装并匹配的 Electron/SQLite 原生依赖，只创建临时合成资料，不接触原个人库。测试内容包括 25 分钟边界、跨次余数、幂等、备份、离线合并、演出回执与 reset/undo。不同后台时长、声音和实体设备验收另行进行。

## 音乐管理专项

```sh
npm run test:music
```

其中 store 检查使用合成存储与音频替身；backend 检查需要匹配的 Electron/SQLite 原生依赖，仅创建临时合成资料和合法 PCM WAV。可用 `XINHAI_TEST_ELECTRON` 指定已有且 ABI 匹配的 Electron。用 `TEMP`/`TMP` 指定临时资料目录，不要指向真实学习库。检查不打开真实文件选择器，不代表音乐解码、声音或设备验收。
