# Third-party notices

The root MIT license applies to this project's own contributions. Existing
upstream and embedded code retains its original copyright and license.

## DeepSeek Harness

Copyright (c) 2026 DeepSeek. MIT License; see
[licenses/DeepSeek-Harness-MIT.txt](licenses/DeepSeek-Harness-MIT.txt).

The desktop integration patches are based on
[`dsh-v0.2.1-alpha.5`, commit `1517a4dbca0a2789ff1d41ba439600f8547d23fa`](https://github.com/deepseek-ai/deepseek-harness/tree/1517a4dbca0a2789ff1d41ba439600f8547d23fa).
The adaptive and code-video presets derive from upstream standard presets,
including the historical `0.2.0-rc.2` baseline. Their package LICENSE and NOTICE
files preserve this attribution. Source patches include upstream context.

This is an independent community project and does not represent an official
DeepSeek release or endorsement. DeepSeek names and visual assets identify the
upstream application; this repository does not grant separate trademark rights.

## Collapsible model selector and clsx

The included model selector is maintained in
[ZoeHao2026/dsh-ui-model-selection-collapsible](https://github.com/ZoeHao2026/dsh-ui-model-selection-collapsible).
Its original MIT LICENSE, THIRD_PARTY_NOTICES.md, DeepSeek MIT notice and clsx MIT
notice are retained under `plugins/baseline-sources/dsh-ui-model-selection-collapsible`.
The generated bundle and source map embed clsx 2.1.1, copyright Luke Edwards;
the full license is also available in [licenses/clsx-MIT.txt](licenses/clsx-MIT.txt).
Historical upstream component attribution remains in the original notices.

The three model-selector documentation images match the existing public files
in that repository. The hero is an AI-generated concept illustration; the other
two demonstrate application UI. They are not evidence of this updater's current UI.

## Runtime dependencies

Node, npm, pnpm, Electron, React, Cordis and the full upstream runtime are not
vendored as tool distributions here. Local builds fetch dependencies governed by
their respective licenses. Redistributing a complete built client requires its
complete dependency notices; the root MIT license does not replace them.
