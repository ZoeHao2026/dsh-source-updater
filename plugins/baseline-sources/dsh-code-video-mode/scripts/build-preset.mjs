/**
 * Generate this bundle's `cordis.patch.yml` from the installed standard preset.
 *
 * The code-video mode keeps every capability of the shipped standard preset and
 * changes exactly four things: the preset declaration id/name/order, the persona
 * text, the custom skill directory, and one extra planning entry. Deriving the
 * patch from the live `standard.patch.yml` keeps that claim checkable after a
 * DSH upgrade: anchoring on the standard file fails loud instead of silently
 * dropping capabilities.
 *
 * Usage:
 *   node scripts/build-preset.mjs [path/to/standard.patch.yml]
 * Without an argument the script reads the installed desktop app.asar and
 * verifies the standard preset against its archive integrity hash.
 */
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, readSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')
const PERSONA_FILE = join(PACKAGE_DIR, 'mode', 'persona.md')
const OUTPUT_FILE = join(PACKAGE_DIR, 'cordis.patch.yml')

const PATCH_HEADER = (baseline) => `# 代码视频模式声明（由 scripts/build-preset.mjs 生成，请勿手改）
# 基线：${baseline}
# 与标准模式的差异仅五处：preset 行 id/名称/order、persona 文本、
# skill-filesystem 的自定义技能目录、planning 组内新增 code-video-plan-entry、
# 新增只读工具行 code-video-render-capabilities。
# DSH 升级后重新运行：node scripts/build-preset.mjs <standard.patch.yml 绝对路径>
`

/** Banner written into the persona section so the patch stays self-describing. */
const PERSONA_BANNER = '# 模式系统提示词正文见 mode/persona.md，由构建脚本注入。'

/**
 * Read a text file normalized to LF with a trailing newline.
 * @param file - absolute path.
 * @returns normalized contents.
 */
function readText(file) {
  if (!existsSync(file)) throw new Error(`file not found: ${file}`)
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!text.endsWith('\n')) throw new Error(`file must end with a newline: ${file}`)
  return text
}

/**
 * Read one packed app.asar file and check its recorded SHA-256 integrity.
 * @param asarPath - installed desktop archive.
 * @param archivePath - path inside the archive.
 * @returns the UTF-8 text of the archive member.
 */
function readAsarText(asarPath, archivePath) {
  const fd = openSync(asarPath, 'r')
  try {
    const prefix = Buffer.alloc(16)
    readSync(fd, prefix, 0, prefix.length, 0)
    const headerLength = prefix.readUInt32LE(12)
    if (headerLength < 1 || headerLength > 64 * 1024 * 1024) throw new Error('invalid ASAR header length')
    const headerBytes = Buffer.alloc(headerLength)
    readSync(fd, headerBytes, 0, headerLength, 16)
    const header = JSON.parse(headerBytes.toString('utf8'))
    const entry = archivePath.split('/').reduce((node, part) => node?.files?.[part], header)
    if (!entry || entry.unpacked || !Number.isSafeInteger(entry.size)) {
      throw new Error(`packed ASAR entry not found: ${archivePath}`)
    }
    const bytes = Buffer.alloc(entry.size)
    readSync(fd, bytes, 0, entry.size, 16 + headerLength + Number(entry.offset))
    const hash = createHash('sha256').update(bytes).digest('hex')
    if (hash !== entry.integrity?.hash) throw new Error(`ASAR integrity mismatch: ${archivePath}`)
    return bytes.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** Read the installed standard preset, or an explicitly supplied patch file. */
function locateStandardPatch() {
  const override = process.argv[2]
  if (override) {
    const path = resolve(override)
    return { text: readText(path), label: path }
  }
  const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local')
  const asarPath = resolve(process.env.DSH_APP_ASAR ?? join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'app.asar'))
  if (!existsSync(asarPath)) throw new Error(`installed desktop app.asar not found: ${asarPath}; pass a standard.patch.yml path explicitly`)
  const packageInfo = JSON.parse(readAsarText(asarPath, 'dsh/node_modules/@deepseek-ai/dsh-web-app/package.json'))
  const text = readAsarText(asarPath, 'dsh/node_modules/@deepseek-ai/dsh-web-app/presets/standard.patch.yml')
  if (!text.endsWith('\n')) throw new Error('ASAR standard.patch.yml must end with a newline')
  return { text, label: `DSH ${packageInfo.version} app.asar @deepseek-ai/dsh-web-app/presets/standard.patch.yml` }
}

/**
 * Render one persona line as a YAML block-scalar line indented under `prefix: `.
 * @param line - one persona line.
 * @param indent - spaces before the content.
 * @returns the indented line.
 */
function indented(line, indent) {
  return line.length === 0 ? '' : ' '.repeat(indent) + line
}

/**
 * Replace one anchor span in the standard patch with generated lines.
 * @param lines - mutable line array.
 * @param anchor - exact text that must occur exactly once.
 * @param replacement - replacement lines.
 * @param label - diagnostic label.
 * @returns the mutated array.
 */
function replaceOnce(lines, anchor, replacement, label) {
  const hits = []
  for (let index = 0; index < lines.length; index += 1) if (lines[index] === anchor) hits.push(index)
  if (hits.length !== 1) {
    throw new Error(`anchor for ${label} matched ${hits.length} lines, expected exactly 1:\n  ${JSON.stringify(anchor)}`)
  }
  const at = hits[0]
  return [...lines.slice(0, at), ...replacement, ...lines.slice(at + 1)]
}

/**
 * Replace a whole contiguous block (inclusive line range) with generated lines.
 * @param lines - mutable line array.
 * @param startAnchor - first line of the block.
 * @param endAnchor - last line of the block.
 * @param replacement - replacement lines.
 * @param label - diagnostic label.
 * @returns the mutated array.
 */
function replaceBlock(lines, startAnchor, endAnchor, replacement, label) {
  const starts = lines.reduce((acc, line, index) => (line === startAnchor ? [...acc, index] : acc), [])
  const ends = lines.reduce((acc, line, index) => (line === endAnchor ? [...acc, index] : acc), [])
  if (starts.length !== 1 || ends.length !== 1 || ends[0] <= starts[0]) {
    throw new Error(`block anchors for ${label} are ambiguous (starts=${starts.length}, ends=${ends.length})`)
  }
  return [...lines.slice(0, starts[0]), ...replacement, ...lines.slice(ends[0] + 1)]
}

/**
 * Build the generated patch.
 * @param standard - standard preset patch text.
 * @param persona - persona text (LF, trailing newline).
 * @param baseline - the package and version used as the baseline.
 * @returns the generated patch text.
 */
function buildPatch(standard, persona, baseline) {
  let lines = standard.split('\n')
  // Drop the trailing empty element produced by the final newline.
  if (lines[lines.length - 1] === '') lines.pop()

  const SUFFIX_ENTRY = '              suffix: Your working directory is {{cwd}}.'
  const PREFIX_ENTRY = '              prefix: You are a coding agent powered by the {{model}} model.'

  // 1. Preset declaration row id.
  lines = replaceOnce(
    lines,
    '    - id: preset-standard',
    ['    - id: preset-code-video'],
    'preset row id'
  )

  // 2. Preset identity: id, order, plus the display name and description.
  lines = replaceOnce(lines, '        id: standard', ['        id: code-video'], 'preset id')
  lines = replaceOnce(lines, '        order: 1', ['        order: 6'], 'preset order')
  lines = replaceOnce(
    lines,
    '        plugins:',
    [
      '        name: 代码视频',
      '        description: 用代码生成高品质程序化视频：一句主题描述即从创意、文案、分镜推进到最终 MP4。',
      '        plugins:'
    ],
    'preset name and description'
  )

  // 3. Persona text: keep the standard row's indentation, swap in the mode prompt.
  const personaLines = persona.split('\n')
  if (personaLines[personaLines.length - 1] === '') personaLines.pop()
  const offending = personaLines.filter((line) => /\t/.test(line) || /\{\{[^}]*\}\}/.test(line))
  if (offending.length > 0) {
    throw new Error(`mode/persona.md contains tabs or template placeholders unsupported by the persona section:\n${offending.slice(0, 3).join('\n')}`)
  }
  lines = replaceBlock(
    lines,
    SUFFIX_ENTRY,
    PREFIX_ENTRY,
    [
      '              ' + PERSONA_BANNER,
      '              prefix: |-',
      ...personaLines.map((line) => indented(line, 16)),
      '              suffix: !!js "\'Your working directory is {{cwd}}. Code-video resource root: \' + process.getBuiltinModule(\'node:path\').dirname(process.getBuiltinModule(\'node:module\').createRequire(baseUrl).resolve(\'@local/dsh-code-video-mode/package.json\'))"'
    ],
    'persona'
  )

  // 4. Custom skill directory so the mode ships its own skill.
  if (!lines.includes('          - id: skill-filesystem')) throw new Error('skill-filesystem row not found in the standard preset')
  lines = replaceOnce(
    lines,
    '            name: \'@deepseek-ai/dsh-skill-filesystem\'',
    [
      '            name: \'@deepseek-ai/dsh-skill-filesystem\'',
      '            config:',
      '              customSkillDirs:',
      '                - !!js "process.getBuiltinModule(\'node:path\').join(process.getBuiltinModule(\'node:path\').dirname(process.getBuiltinModule(\'node:module\').createRequire(baseUrl).resolve(\'@local/dsh-code-video-mode/package.json\')), \'skills\')"'
    ],
    'skill-filesystem name'
  )

  // 5. The plan-mode section is a long YAML block scalar whose wording may
  //    change between releases. Insert at its parent group boundary instead.
  //    The declaration check below keeps the inherited standard rows intact.
  lines = replaceOnce(
    lines,
    '          - id: compaction',
    [
      '              - id: code-video-plan-entry',
      '                name: \'@local/dsh-code-video-mode/plan-entry\'',
      '          - id: compaction'
    ],
    'plan entry insertion'
  )

  lines = replaceOnce(
    lines,
    '          - id: tool-todo',
    [
      '          - id: code-video-render-capabilities',
      '            name: \'@local/dsh-code-video-mode/render-capabilities\'',
      '          - id: tool-todo'
    ],
    'render capability probe row'
  )

  const rendered = PATCH_HEADER(baseline) + lines.join('\n') + '\n'

  // Post-generation invariants: the mode keeps the standard capability set and
  // adds only its own named rows.
  const declaredIds = (text) => [...text.matchAll(/^\s+- id: (?!cordis:group)([a-z0-9-]+)$/gm)].map((match) => match[1])
  const MODE_ROWS = new Set(['preset-code-video', 'code-video-plan-entry', 'code-video-render-capabilities'])
  const standardIds = declaredIds(standard).filter((id) => id !== 'preset-standard')
  const generatedIds = declaredIds(rendered).filter((id) => !MODE_ROWS.has(id))
  if (standardIds.join(',') !== generatedIds.join(',')) {
    throw new Error(`capability set drifted from the standard preset:\n  standard:  ${standardIds.join(', ')}\n  generated: ${generatedIds.join(', ')}`)
  }
  for (const needle of ['id: code-video', 'name: 代码视频', 'order: 6', 'code-video-plan-entry', 'code-video-render-capabilities', 'customSkillDirs', 'Code-video resource root']) {
    if (!rendered.includes(needle)) throw new Error(`generated patch is missing ${JSON.stringify(needle)}`)
  }
  if (rendered.includes('preset-standard') || rendered.includes('id: standard')) {
    throw new Error('generated patch still references the standard preset identity')
  }
  return { text: rendered, standardIds }
}

const standard = locateStandardPatch()
const { text, standardIds } = buildPatch(standard.text, readText(PERSONA_FILE), standard.label)
writeFileSync(OUTPUT_FILE, text, 'utf8')

const personaLines = readText(PERSONA_FILE).split('\n').filter(Boolean).length
console.log(`standard preset : ${standard.label}`)
console.log(`persona source  : ${PERSONA_FILE} (${personaLines} non-empty lines)`)
console.log(`generated       : ${OUTPUT_FILE}`)
console.log(`inherited ids   : ${standardIds.length} (identical set and order to the standard preset)`)
console.log('differences     : preset id/name/order, persona text, customSkillDirs, code-video-plan-entry, code-video-render-capabilities')
