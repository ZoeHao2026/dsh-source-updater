/**
 * `video_render_capabilities` — one read-only probe of the production toolchain.
 *
 * Deterministic video production needs to know, before authoring anything,
 * which render/encode/voice path this machine can actually execute. Probing once
 * through a typed tool is cheaper and more reliable than re-deriving it with
 * ad-hoc shell commands in every session. This tool installs nothing, downloads
 * nothing, and mutates nothing.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execFile } from 'node:child_process'

export const name = 'code-video-render-capabilities'
export const inject = ['tools']

/** Common absolute locations the export toolchain uses when it is not on PATH. */
const FFMEG_CANDIDATES = [
  'C:\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
  'C:\\Program Files\\ffmpeg\\bin\\ffprobe.exe',
  'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe',
  join(homedir(), 'scoop', 'shims', 'ffmpeg.exe'),
  join(homedir(), 'scoop', 'shims', 'ffprobe.exe'),
  '/usr/bin/ffmpeg',
  '/usr/local/bin/ffmpeg',
  '/opt/homebrew/bin/ffmpeg'
]

/** Browsers usable as the deterministic frame renderer. */
const BROWSER_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
]

/** Names of the ffmpeg / ffprobe executables on this platform. */
const FFMPEG_EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
const FFPROBE_EXE = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe'

/**
 * Resolve an executable on PATH (Windows `where`, elsewhere `which`).
 * @param file - executable name without extension.
 * @returns the first resolved absolute path, or null.
 */
function onPath(file) {
  return new Promise((resolve) => {
    const probe = process.platform === 'win32' ? 'where' : 'which'
    execFile(probe, [file], { timeout: 15000 }, (error, stdout) => {
      if (error) return resolve(null)
      const first = String(stdout).split(/\r?\n/).map((line) => line.trim()).find(Boolean)
      resolve(first ?? null)
    })
  })
}

/**
 * Test a handful of paths that are likely to exist inside the current project.
 * @param relative - project-relative directory or file.
 * @returns whether it exists.
 */
function inProject(...relative) {
  try {
    return existsSync(join(process.cwd(), ...relative))
  } catch {
    return false
  }
}

/** UTF-8 JSON probe run through PowerShell so non-ASCII output stays lossless. */
const PS_PROBE = `
$out = [ordered]@{}
$tts = Get-Command edge-tts -ErrorAction SilentlyContinue
$out.edgeTtsCli = if ($tts) { $tts.Source } else { $null }
$py = Get-Command python -ErrorAction SilentlyContinue
if (-not $py) { $py = Get-Command python3 -ErrorAction SilentlyContinue }
$out.python = if ($py) { $py.Source } else { $null }
$libs = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA 'Programs\\Python' } else { $null }
$out.edgeTtsModule = $null
if ($py) {
  $base = & $py.Source -c "import sysconfig; print(sysconfig.get_paths()['purelib'])" 2>$null
  if ($base) {
    $candidate = Join-Path $base 'edge_tts'
    if (Test-Path $candidate) { $out.edgeTtsModule = $candidate } else { $out.edgeTtsModule = $base + ' (edge_tts not found)' }
  }
}
$out | ConvertTo-Json -Compress
`

/**
 * Run the Windows environment probe.
 * @returns parsed probe output, or null when unavailable.
 */
function windowsProbe() {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', PS_PROBE],
      { timeout: 60000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve(null)
        try {
          resolve(JSON.parse(String(stdout).trim()))
        } catch {
          resolve(null)
        }
      }
    )
  })
}

/** One nullable path or version string; the subset has no union types. */
const NULLABLE_STRING = { oneOf: [{ type: 'string' }, { type: 'null' }] }

/** Every capability key the probe reports, in report order. */
const CAPABILITY_KEYS = [
  'ffmpeg',
  'ffprobe',
  'chromeOrEdge',
  'playwrightCli',
  'edgeTtsCli',
  'edgeTtsPythonModule',
  'python',
  'node',
  'projectNodeModules',
  'projectLocalFfmpegDependency'
]

/** Closed object schema: the enforced subset rejects non-boolean `additionalProperties`. */
const CAPABILITIES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: Object.fromEntries(CAPABILITY_KEYS.map((key) => [key, NULLABLE_STRING])),
  required: CAPABILITY_KEYS
}

export function apply(ctx) {
  ctx.tools.register({
    name: 'video_render_capabilities',
    description:
      'Probe this machine once for the programmatic-video toolchain: frame renderer (Chrome/Edge/Playwright), encoder (ffmpeg/ffprobe on PATH or in a project dependency), Node/pnpm, and speech synthesis (edge-tts). Read-only: installs and downloads nothing. Call it before authoring tech-plan.md or any render script, then record the chosen stack in the project. Paths are reported as strings or null; null means "not found", not "unavailable on this platform".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          platform: { type: 'string' },
          arch: { type: 'string' },
          cwd: { type: 'string' },
          node: { type: 'string' },
          rendersPixels: { type: 'string', description: 'Which renderer path the toolchain can actually drive.' },
          encodesVideo: { type: 'string', description: 'Which encoder path is available for MP4 output.' },
          speaks: { type: 'string', description: 'Which text-to-speech path is available for narration.' },
          important: { type: 'string', description: 'One action-relevant caveat for this machine.' },
          capabilities: CAPABILITIES_SCHEMA
        },
        required: ['platform', 'arch', 'cwd', 'node', 'rendersPixels', 'encodesVideo', 'speaks', 'important', 'capabilities']
      },
      render: (_args, value) => {
        const lines = Object.entries(value.capabilities)
          .map(([key, entry]) => `  ${key}: ${entry ?? '(not found)'}`)
          .join('\n')
        return [{
          type: 'text',
          text: [
            `Renderer: ${value.rendersPixels}`,
            `Encoder:  ${value.encodesVideo}`,
            `Voice:    ${value.speaks}`,
            `Platform: ${value.platform}/${value.arch}, node ${value.node}, cwd ${value.cwd}`,
            'Capabilities:',
            lines,
            `Action: ${value.important}`
          ].join('\n')
        }]
      }
    },
    isConcurrencySafe: () => true,
    execute: async () => {
      const win = process.platform === 'win32'
      const probe = win ? await windowsProbe() : {}
      const [ffmpegPath, ffprobePath, playwrightCli, pythonPath] = await Promise.all([
        onPath('ffmpeg'),
        onPath('ffprobe'),
        onPath('playwright'),
        Promise.resolve(probe?.python ?? null)
      ])

      const ffmpegStatic = inProject('node_modules', 'ffmpeg-static', 'package.json')

      const browser = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate)) ?? null

      const ffmpeg = ffmpegPath
        ?? FFMEG_CANDIDATES.find((candidate) => candidate.endsWith(FFMPEG_EXE) && existsSync(candidate))
        ?? null
      const ffprobe = ffprobePath
        ?? FFMEG_CANDIDATES.find((candidate) => candidate.endsWith(FFPROBE_EXE) && existsSync(candidate))
        ?? null
      // The PowerShell probe reports the site-packages directory it inspected;
      // "not found" there means the module is absent, not that the path is a path.
      const edgeTtsModule = probe?.edgeTtsModule && !String(probe.edgeTtsModule).includes('not found')
        ? String(probe.edgeTtsModule)
        : null

      const capabilities = {
        ffmpeg: ffmpeg,
        ffprobe: ffprobe,
        chromeOrEdge: browser,
        playwrightCli: playwrightCli,
        edgeTtsCli: probe?.edgeTtsCli ?? null,
        edgeTtsPythonModule: edgeTtsModule,
        python: pythonPath,
        node: process.version,
        projectNodeModules: inProject('node_modules') ? join(process.cwd(), 'node_modules') : null,
        projectLocalFfmpegDependency: ffmpegStatic ? join(process.cwd(), 'node_modules', 'ffmpeg-static') : null
      }

      const rendersPixels = browser
        ? playwrightCli
          ? `Playwright-driven Chromium available (${playwrightCli}); browser binary ${browser}`
          : `headless browser available (${browser}); drive it with scripted capture or install Playwright locally`
        : playwrightCli
          ? `Playwright CLI present (${playwrightCli}) but no system Chrome/Edge found; Playwright's own Chromium may still serve`
          : 'no frame renderer detected: install a local Playwright dependency or use an installed Chrome/Edge'

      const encodesVideo = ffmpeg
        ? `ffmpeg on disk (${ffmpeg})${ffprobe ? `, ffprobe (${ffprobe})` : ', but ffprobe was not found — verification needs it'}`
        : ffmpegStatic
          ? 'no system ffmpeg; a project-local ffmpeg dependency path exists — add ffmpeg-static to the project and use its binary'
          : 'no ffmpeg and no project-local fallback: add a local ffmpeg dependency before export, or render image sequences only'

      const speaks = probe?.edgeTtsCli
        ? `edge-tts CLI ready (${probe.edgeTtsCli})`
        : edgeTtsModule
          ? `edge-tts Python module ready (${edgeTtsModule}) — call it with python -m edge_tts`
          : 'no edge-tts found: prefer user-supplied audio, or synthesize a click/whoosh bed and rely on on-screen text'

      const important = ffmpeg
        ? 'Record the resolved ffmpeg/ffprobe paths in the project README so verification stays reproducible.'
        : 'MP4 export needs ffmpeg: add it as a project-local dependency (ffmpeg-static) or rely on Remotion-style bundled rendering, and say so in the delivery summary.'

      return {
        platform: process.platform,
        arch: process.arch,
        cwd: process.cwd(),
        node: process.version,
        rendersPixels,
        encodesVideo,
        speaks,
        important,
        capabilities
      }
    }
  })
}
