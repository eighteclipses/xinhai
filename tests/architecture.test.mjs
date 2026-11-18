import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePreferences } from '../lib/preferences.ts';
import {
  DEFAULT_WALLPAPER_ID,
  MAX_WALLPAPER_BYTES,
  resolveWallpaperAfterDelete,
  validateWallpaperFile,
} from '../lib/wallpapers.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

test('防抖动架构门禁：根组件禁止 1Hz setInterval 全树重渲染', () => {
  const studyApp = read('app/study-app.tsx');
  assert.equal(
    /setInterval\s*\(/.test(studyApp),
    false,
    'app/study-app.tsx 不得包含全局 setInterval，高频计时须隔离在叶子组件',
  );

  const timerCard = read('components/focus-timer-card.tsx');
  assert.match(
    timerCard,
    /timer\.status !== 'running'/,
    '倒计时仅在 running 状态才允许启动秒级刷新',
  );

  const clock = read('components/ambient-clock.tsx');
  assert.equal(
    /setInterval\s*\(/.test(clock),
    false,
    '顶栏时钟应按分钟边界对齐调度，避免每秒重绘引发平板抖动',
  );
});

test('等宽数字与装饰元素半透明可隐藏门禁', () => {
  const css = read('app/globals.css');
  assert.match(
    css,
    /tabular-nums/,
    '时钟与计时器必须启用 tabular-nums 等宽数字',
  );
  assert.match(
    css,
    /\.app\[data-hide-ornaments='true'\]\s+\.ornament-en/,
    '必须支持一键隐藏装饰英文',
  );
  assert.match(
    css,
    /\.app\[data-hide-ornaments='true'\]\s+\.ornament-num/,
    '必须支持一键隐藏装饰编号数字',
  );
});

test('跨端适配门禁：移除竖屏封锁并支持 Mac / iPad / 手机安全区与液态玻璃', () => {
  const studyApp = read('app/study-app.tsx');
  const css = read('app/globals.css');
  const manifest = JSON.parse(read('public/manifest.webmanifest'));

  assert.equal(
    studyApp.includes('rotate-hint') || css.includes('.rotate-hint'),
    false,
    '不得使用 rotate-hint 封锁竖屏手机或 iPad 分屏视图',
  );
  assert.equal(manifest.orientation, 'any', 'PWA manifest 不得强制锁定横屏');
  assert.match(
    css,
    /-webkit-backdrop-filter:/,
    'Safari/iPadOS 需同时声明 -webkit-backdrop-filter',
  );
  assert.match(css, /\.app\[data-glass='liquid'\]/, '需提供统一液态玻璃材质层');
  assert.match(css, /\.app\[data-glass='frosted'\]/, '需提供高对比雾面回退层');
  assert.match(
    css,
    /env\(safe-area-inset-bottom/,
    '底部导航需适配 iPad / iPhone 安全区',
  );
});

test('壁纸性能与生命周期门禁：禁止无限 drop-shadow 动画、支持后台暂停与安全删除', () => {
  const css = read('app/globals.css');
  const stage = read('components/wallpaper-stage.tsx');

  assert.equal(
    /drop-shadow\([^)]+\)[\s\S]{0,120}infinite|infinite[\s\S]{0,120}drop-shadow\(/.test(
      css,
    ),
    false,
    '禁止在同一图层叠加无限动画与 drop-shadow，避免平板 GPU 逐帧重算阴影卡顿',
  );
  assert.match(
    stage,
    /visibilitychange/,
    '动态壁纸必须在页面切入后台时自动暂停解码',
  );

  assert.equal(
    validateWallpaperFile({ name: 'a.mp4', size: 0, type: 'video/mp4' }).ok,
    false,
  );
  assert.equal(
    validateWallpaperFile({
      name: 'huge.mp4',
      size: MAX_WALLPAPER_BYTES + 1,
      type: 'video/mp4',
    }).ok,
    false,
  );
  assert.equal(
    validateWallpaperFile({
      name: 'exe.bin',
      size: 1024,
      type: 'application/octet-stream',
    }).ok,
    false,
  );
  assert.deepEqual(
    validateWallpaperFile({
      name: 'sea.mp4',
      size: 2_400_000,
      type: 'video/mp4',
    }),
    { ok: true, kind: 'video' },
  );
  assert.equal(
    resolveWallpaperAfterDelete('custom:123', 'custom:123'),
    DEFAULT_WALLPAPER_ID,
    '删除当前正在使用的自定义壁纸后，必须自动回退到默认静态背景',
  );
  assert.equal(
    resolveWallpaperAfterDelete('sea-video', 'custom:123'),
    'sea-video',
  );
});

test('偏好设置归一化与旧版配置平滑迁移', () => {
  const migrated = normalizePreferences(null, {
    reduced: 'false',
    moving: 'true',
    systemReduced: false,
  });
  assert.equal(migrated.wallpaperId, 'sea-video');
  assert.equal(migrated.glassStyle, 'liquid');
  assert.equal(migrated.showTopClock, true);
  assert.equal(migrated.hideOrnaments, false);

  const sanitized = normalizePreferences({
    glassStyle: 'invalid',
    hideOrnaments: 'yes',
    showTopClock: false,
    wallpaperId: '   ',
  });
  assert.equal(sanitized.glassStyle, 'liquid');
  assert.equal(sanitized.hideOrnaments, false);
  assert.equal(sanitized.showTopClock, false);
  assert.equal(sanitized.wallpaperId, DEFAULT_WALLPAPER_ID);
});

test('客户端与服务端模块边界门禁：use client 组件禁止引入服务端专用模块', () => {
  const clientFiles = [
    'app/study-app.tsx',
    'components/ambient-clock.tsx',
    'components/focus-timer-card.tsx',
    'components/wallpaper-stage.tsx',
    'components/wallpaper-picker.tsx',
    'components/entry-editor.tsx',
    'components/item-editor.tsx',
    'components/music-player.tsx',
    'components/study-controls.tsx',
    'lib/preferences.ts',
    'lib/use-store.ts',
  ];
  for (const file of clientFiles) {
    const src = read(file);
    assert.equal(
      /next\/headers|cloudflare:workers|@\/lib\/server|@\/app\/chatgpt-auth/.test(
        src,
      ),
      false,
      `${file} 作为客户端模块不得导入服务端专用依赖`,
    );
  }
});
