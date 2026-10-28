const path = require('node:path')
const packager = require('electron-packager')

const root = path.resolve(__dirname, '..')
const ignoredTopLevel = new Set([
  '.claude',
  '.codex',
  '.git',
  'benchmarks',
  'coverage',
  'release',
  'scripts',
  'src',
  'test-results',
  'tests',
  'vitest.config.ts',
  'ENGINE_REDESIGN_PLAN.vi.md',
  'README.md',
])

function shouldIgnore(filePath) {
  const relative = String(filePath).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!relative) return false
  const parts = relative.split('/')
  if (ignoredTopLevel.has(parts[0])) return true
  if (parts[0] === 'runtime' && ['repro-check', 'repro-check-song-45s.wav', 'qwen-probe', 'qwen-cache'].includes(parts[1])) return true
  if (parts.includes('__pycache__') || parts.includes('.pytest_cache') || parts.includes('.vitest')) return true
  if (parts[0] === 'node_modules' && ['.bin', '.vite', '.vite-temp', 'electron', 'electron-prebuilt', 'electron-prebuilt-compile'].includes(parts[1])) return true
  if (/\.(?:test|spec)\.[^/]+$/i.test(relative) || /\.(?:d\.(?:ts|cts|mts)|pyc|pyo|obj|o)$/i.test(relative)) return true
  if (/^shared\/(?:[^/]+\.(?:d\.ts|ts))$/i.test(relative)) return true
  if (relative === '.gitignore' || relative === '.gitattributes' || relative === 'package-lock.json') return true
  return false
}

const outputDirectory = process.env.KARA_PACKAGE_OUT
  ? path.resolve(process.env.KARA_PACKAGE_OUT)
  : path.join(root, 'release')

packager({
  dir: root,
  name: 'KaraStudio',
  platform: 'win32',
  arch: 'x64',
  out: outputDirectory,
  overwrite: true,
  asar: { unpackDir: 'node_modules/ffmpeg-static' },
  extraResource: [
    path.join(root, 'electron/local-whisper-worker.py'),
    path.join(root, 'electron/local-runtime-manifest.json'),
  ],
  ignore: shouldIgnore,
  prune: true,
}).then((paths) => {
  process.stdout.write(`Packaged Windows app: ${paths.join(', ')}\n`)
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
