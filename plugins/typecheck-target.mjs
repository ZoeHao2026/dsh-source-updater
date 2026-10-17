import assert from 'node:assert/strict';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const argument = flag => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
const sourceArgument = argument('--source');
const pluginArgument = argument('--plugin-root');
if (!sourceArgument || !path.isAbsolute(sourceArgument) || (pluginArgument !== undefined && !path.isAbsolute(pluginArgument))) throw new Error('Usage: node typecheck-target.mjs --source ABS_BUILT_OFFICIAL_CHECKOUT [--plugin-root ABS_UI_PLUGIN_DIRECTORY]');
// Resolve TypeScript only after explicit input validation; never infer a sibling checkout or read a user profile.
const source = path.resolve(sourceArgument);
const pluginRoot = pluginArgument ? path.resolve(pluginArgument) : path.join(root, 'baseline-sources/dsh-ui-model-selection-collapsible');
const ts = (await import(pathToFileURL(path.join(source, 'node_modules/typescript/lib/typescript.js')).href)).default;
const configPath = path.join(root, 'tsconfig.target.json');
const input = ts.readConfigFile(configPath, ts.sys.readFile);
if (input.error) throw new Error(ts.flattenDiagnosticMessageText(input.error.messageText, '\n'));
const config = ts.parseJsonConfigFileContent({ ...input.config, extends: path.join(source, 'tsconfig.base.client.json'), include: [path.join(pluginRoot, 'src')] }, ts.sys, root, {}, configPath);
if (config.errors.length) throw new Error(ts.formatDiagnostics(config.errors, { getCanonicalFileName: filename => filename, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
assert.equal(config.fileNames.length, 11, 'Expected all 11 UI plugin TypeScript source files');
const paths = Object.fromEntries(Object.entries(config.options.paths ?? {}).map(([name, values]) => [name, values.map(value => {
  const resolved = path.resolve(config.options.pathsBasePath ?? source, value).replaceAll('\\', '/');
  return /\/src(?:\/|$)/.test(resolved) ? resolved.replace(/\/src(?=\/|$)/, '/lib/types').replace(/\.(tsx?|mts)$/, '.d.ts') : resolved;
})]));
const options = { ...config.options, paths, skipLibCheck: true, types: ['node', 'client-build-environment'], typeRoots: [path.join(source, 'scripts/types'), path.join(source, 'node_modules/@types')] };
// The public plugin intentionally has no node_modules. Resolve its direct bare dependencies from the supplied checkout's installed packages.
for (const dependency of ['react', 'react/jsx-runtime', 'react-dom', 'clsx']) {
  const candidates = [path.join(source, '__public_plugin_typecheck__.ts'), path.join(source, 'packages/client/ui-primitives/__public_plugin_typecheck__.ts')];
  const resolved = candidates.map(containingFile => ts.resolveModuleName(dependency, containingFile, options, ts.sys).resolvedModule).find(Boolean);
  if (!resolved || !/\.d\.[cm]?ts$/.test(resolved.resolvedFileName)) throw new Error(`Built checkout must supply the declaration for ${dependency}`);
  paths[dependency] = [resolved.resolvedFileName];
}
// TypeScript caches parsed path patterns by object identity during dependency lookup.
// Freeze the completed mapping as a new object before creating the program.
const program = ts.createProgram([...config.fileNames, path.join(root, 'typecheck-css.d.ts')], { ...options, paths: { ...paths } });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCanonicalFileName: filename => filename, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
  process.exitCode = 1;
} else console.log(JSON.stringify({ ok: true, sourceVersion: JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')).version, pluginSourceFiles: config.fileNames.length, interfacePlane: 'built-public-declarations' }));
