# 第三方代码与资源说明

本目录的 PolyForm Noncommercial 1.0.0 仅针对作者有权许可的自主代码和项目自主资源。它不替换第三方许可，不授权第三方商标、游戏素材，也不覆盖公开仓库外层的历史文档和图片。

## RhineLabUI

`src/shared/sceneMotion.ts` 的波动与阻尼选择动效参考并改编自 [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI)，参考提交 `3274778cbb8bb05ca2472d706c5879fa002ecd93`。保留 [MIT 许可全文](resources/licenses/RhineLabUI-MIT.txt) 与文件中的原始出处注释。上游原有许可权限仍然有效，本项目不对其追加非商业限制。

## npm 与平台依赖

Electron、React、Vite、TypeScript、better-sqlite3、framer-motion、howler、zustand、qrcode、yauzl、yazl 等依赖各自独立提供和授权。具体安装版本由 `package-lock.json` 记录；安装后应查阅每个 npm 包内的 LICENSE、NOTICE、package.json 及 Electron 随附的 Chromium 许可。依赖许可不受本项目 PolyForm 条款替代。

项目只提供源码构建入口；准备再分发自己生成的安装包时，需要保留相应依赖和运行时的完整许可。这份源码说明没有声称完成了全部安装包的第三方许可审计。

## 未附带的第三方素材

游戏角色、美术、视频、配乐、语音、字体和播放器皮肤没有加入本目录。Persona 3 Reload 及相关名称和角色的权利归其权利人所有。`src/shared/credits.json` 中的历史参考链接只表示来源或鸣谢，不证明授权；代码保留的文件名也不授予素材使用权。

## 项目自己的示例资源

`build/icon.*`、Android 的书本波浪图标、`src/renderer/public/design/app-icon.*` 是项目图标。`backgrounds/originals/*.svg` 与 `design/player-demo.svg` 是本次源码整理时直接用 SVG 代码绘制的中性示例，没有复制第三方游戏图片或原音视频素材。
