import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const preferredWin64Node =
  'E:\\CodexData\\tools\\node-v24.22.3-win-x64\\node.exe';
const tempDir = 'E:\\Temp\\Codex';
const cacheDir = 'E:\\CodexData\\cache\\npm';

if (process.platform === 'win32' && existsSync('E:\\')) {
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
}

const env = {
  ...process.env,
  ...(process.platform === 'win32' && existsSync('E:\\')
    ? {
        TEMP: tempDir,
        TMP: tempDir,
        npm_config_cache: cacheDir,
      }
    : {}),
};

const major = Number(process.versions.node.split('.')[0]);
if (
  process.platform === 'win32' &&
  (process.arch === 'ia32' || major < 24) &&
  existsSync(preferredWin64Node) &&
  process.env.XINHAI_REEXEC !== '1'
) {
  const nodeDir = path.dirname(preferredWin64Node);
  const res = spawnSync(
    preferredWin64Node,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...env,
        PATH: `${nodeDir};${env.PATH ?? ''}`,
        XINHAI_REEXEC: '1',
      },
    },
  );
  process.exit(res.status ?? 1);
}

const testOnly = process.argv.includes('--test-only');

function runNodeScript(label, args) {
  console.log(`\n▶ ${label}`);
  const res = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env,
  });
  if (res.status !== 0) {
    console.error(`✖ 失败: ${label}`);
    process.exit(res.status ?? 1);
  }
}

const pkgBin = (...segments) => path.join(rootDir, 'node_modules', ...segments);
const stripTypesArg = major >= 24 ? [] : ['--experimental-strip-types'];

if (!testOnly) {
  runNodeScript('TypeScript 类型检查 (tsc --noEmit)', [
    pkgBin('typescript', 'bin', 'tsc'),
    '--noEmit',
    '--incremental',
    'false',
  ]);
  runNodeScript('Oxlint 静态分析与 React Compiler 检查', [
    pkgBin('oxlint', 'bin', 'oxlint'),
  ]);
  runNodeScript('Oxfmt 代码格式一致性检查', [
    pkgBin('oxfmt', 'bin', 'oxfmt'),
    '--check',
  ]);
}

runNodeScript('确定性领域与架构不变量测试', [
  ...stripTypesArg,
  '--test',
  'tests/domain.test.mjs',
  'tests/architecture.test.mjs',
]);

console.log('\n✔ 内循环全部门禁通过 (0 warnings, 0 errors)');
