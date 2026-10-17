import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

const registry = 'https://registry.npmjs.org'
const packageFile = path.resolve(import.meta.dirname, '..', 'package.json')
const dshPrefix = '@deepseek-ai/dsh-'

// This checker deliberately accepts only exact versions and bounded comparator
// ranges. An unrecognised or open-ended range must not silence future alerts.
function parseVersion(input) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(input)
  if (match === null) throw new Error(`Invalid SemVer version: ${input}`)
  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === '0')) {
    throw new Error(`Invalid numeric prerelease identifier: ${input}`)
  }
  return {
    raw: input,
    major: BigInt(match[1]),
    minor: BigInt(match[2]),
    patch: BigInt(match[3]),
    prerelease,
  }
}

function compareIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left)
  const rightNumeric = /^\d+$/.test(right)
  if (leftNumeric && rightNumeric) {
    const a = BigInt(left)
    const b = BigInt(right)
    return a < b ? -1 : a > b ? 1 : 0
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1
  return left < right ? -1 : left > right ? 1 : 0
}

function compareVersion(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1
  for (let i = 0; i < Math.min(left.prerelease.length, right.prerelease.length); i += 1) {
    const result = compareIdentifier(left.prerelease[i], right.prerelease[i])
    if (result !== 0) return result
  }
  return Math.sign(left.prerelease.length - right.prerelease.length)
}

function parseRange(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    throw new Error(`Empty DSH compatibility range: ${String(input)}`)
  }
  return input.split(/\s*\|\|\s*/).map((branch) => {
    const comparators = branch.trim().split(/\s+/).map((token) => {
      const match = /^(>=|<=|>|<|=)?(.+)$/.exec(token)
      if (match === null) throw new Error(`Unsupported DSH compatibility token: ${token}`)
      return { operator: match[1] ?? '=', version: parseVersion(match[2]) }
    })
    if (!comparators.some(({ operator }) => ['=', '<', '<='].includes(operator))) {
      throw new Error(`DSH compatibility range needs an upper bound: ${input}`)
    }
    return comparators
  })
}

function satisfies(version, range) {
  return range.some((branch) => {
    if (!branch.every(({ operator, version: bound }) => {
      const comparison = compareVersion(version, bound)
      switch (operator) {
        case '=': return comparison === 0
        case '>': return comparison > 0
        case '>=': return comparison >= 0
        case '<': return comparison < 0
        case '<=': return comparison <= 0
        default: throw new Error(`Unsupported comparator: ${operator}`)
      }
    })) return false

    // npm SemVer ranges exclude prereleases unless a comparator refers to the
    // same major.minor.patch with a prerelease identifier.
    return version.prerelease.length === 0 || branch.some(({ version: bound }) =>
      bound.prerelease.length > 0 &&
      bound.major === version.major &&
      bound.minor === version.minor &&
      bound.patch === version.patch,
    )
  })
}

function exactVersion(input, label) {
  if (typeof input !== 'string') throw new Error(`Missing exact DSH development version for ${label}`)
  try {
    return parseVersion(input)
  } catch {
    throw new Error(`DSH development version for ${label} must be exact SemVer: ${input}`)
  }
}

async function publishedVersions(name) {
  const response = await fetch(`${registry}/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new Error(`npm registry returned HTTP ${response.status} for ${name}`)
  const metadata = await response.json()
  if (metadata.name !== name || typeof metadata.versions !== 'object' || metadata.versions === null) {
    throw new Error(`Unexpected npm registry metadata for ${name}`)
  }
  return Object.keys(metadata.versions).map(parseVersion).sort(compareVersion)
}

function selfTest() {
  const rc1 = parseVersion('0.1.7-rc.1')
  const rc2 = parseVersion('0.1.7-rc.2')
  const rc10 = parseVersion('0.1.7-rc.10')
  const stable = parseVersion('0.1.7')
  const window = parseRange('>=0.1.7-rc.1 <0.1.8-0')
  assert.ok(compareVersion(rc1, rc2) < 0)
  assert.ok(compareVersion(rc2, rc10) < 0)
  assert.ok(compareVersion(rc10, stable) < 0)
  assert.ok(satisfies(rc1, window))
  assert.ok(satisfies(rc2, window))
  assert.ok(satisfies(stable, window))
  assert.ok(!satisfies(parseVersion('0.1.8-alpha.1'), window))
  assert.ok(!satisfies(parseVersion('0.1.8'), window))
  assert.ok(satisfies(rc1, parseRange('0.1.7-rc.1')))
  assert.ok(!satisfies(rc2, parseRange('0.1.7-rc.1')))
  assert.throws(() => parseRange('>=0.1.7-rc.1'), /upper bound/)
  console.log('SemVer monitor self-test passed')
}

async function main() {
  if (process.argv[2] === '--self-test') return selfTest()
  if (process.argv.length !== 2) throw new Error(`Unknown argument: ${process.argv.slice(2).join(' ')}`)

  const manifest = JSON.parse(await readFile(packageFile, 'utf8'))
  const peers = manifest.peerDependencies ?? {}
  const development = manifest.devDependencies ?? {}
  const peerNames = Object.keys(peers).filter((name) => name.startsWith(dshPrefix))
  const devNames = Object.keys(development).filter((name) => name.startsWith(dshPrefix))
  if (peerNames.length === 0 || devNames.length === 0) {
    throw new Error('No DSH peer/development dependencies found; monitor cannot infer verified versions')
  }

  const peerRanges = new Map(peerNames.map((name) => [name, parseRange(peers[name])]))
  const verified = new Map(devNames.map((name) => [name, exactVersion(development[name], name)]))
  for (const name of peerNames) {
    const baseline = verified.get(name)
    if (baseline === undefined) throw new Error(`Missing exact development baseline for peer ${name}`)
    if (!satisfies(baseline, peerRanges.get(name))) {
      throw new Error(`Verified development baseline ${baseline.raw} is outside peer range for ${name}: ${peers[name]}`)
    }
  }

  const peerBaselines = peerNames.map((name) => verified.get(name))
  const harnessBaseline = peerBaselines[0]
  if (peerBaselines.some((version) => compareVersion(version, harnessBaseline) !== 0)) {
    throw new Error('DSH peer development baselines differ; choose one verified harness version')
  }
  verified.set('@deepseek-ai/dsh', harnessBaseline)
  const names = [...new Set(['@deepseek-ai/dsh', ...peerNames, ...devNames])]
  const versionsByName = await Promise.all(names.map(async (name) => [name, await publishedVersions(name)]))
  let pending = false

  for (const [name, versions] of versionsByName) {
    const baseline = verified.get(name)
    if (!versions.some((version) => compareVersion(version, baseline) === 0)) {
      throw new Error(`${name} verified baseline ${baseline.raw} is missing from the npm registry`)
    }
    const newer = versions.filter((version) => compareVersion(version, baseline) > 0)
    const ranges = name === '@deepseek-ai/dsh'
      ? [...peerRanges.values()]
      : peerRanges.has(name) ? [peerRanges.get(name)] : []
    const inside = newer.filter((version) => ranges.length > 0 && ranges.every((range) => satisfies(version, range)))
    const outside = newer.filter((version) => !inside.includes(version))
    if (newer.length === 0) {
      console.log(`OK ${name}: no release above verified ${baseline.raw}`)
      continue
    }
    pending = true
    const show = (items) => items.slice(-12).map((version) => version.raw).join(', ')
    console.error(`REVIEW ${name}: verified through ${baseline.raw}; ${newer.length} newer release(s)`)
    if (inside.length > 0) console.error(`  Within declared peer window, still unverified (${inside.length}): ${show(inside)}`)
    if (outside.length > 0) console.error(`  Outside declared peer window or dev-only (${outside.length}): ${show(outside)}`)
  }

  if (pending) {
    throw new Error('New DSH release(s) require compatibility verification and an updated exact development baseline; widen peer ranges only after validation')
  }
  console.log('All monitored DSH packages match the verified development baselines')
}

main().catch((error) => {
  console.error(`::error::${error.message}`)
  process.exitCode = 1
})
