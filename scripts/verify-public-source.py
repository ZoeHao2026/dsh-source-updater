"""Verify only this public repository, using Python's standard library.

No archives are extracted and no user configuration is opened. Diagnostics
contain relative paths and counts, never the contents of a suspected secret.
"""

import argparse
import fnmatch
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import sys
import tarfile


ROOT = Path(__file__).resolve().parents[1]
TEXT_SUFFIXES = {'.md', '.txt', '.json', '.map', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.html', '.yaml', '.yml', '.py', '.ps1', '.cs', '.patch'}
ALLOWED_USERS = {'yourname', 'username', 'fixture', 'public', 'default', 'root', 'runner', 'user', 'admin', 'administrator', '%username%', '$user', '${user}', '${username}'}
EXPECTED_BASELINES = {'@local/dsh-adaptive-mode': '0.1.14', '@local/dsh-code-video-mode': '0.1.3', '@local/dsh-ui-model-selection-collapsible': '0.2.3'}
MIT_BODY = '''Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.'''
issues = []
counts = {}


def fail(check, relative, count=1):
    issues.append({'check': check, 'path': str(relative), 'count': count})


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def is_linked(path):
    return path.is_symlink() or (hasattr(path, 'is_junction') and path.is_junction())


def safe_relative(value):
    return isinstance(value, str) and bool(value) and '\\' not in value and '\x00' not in value and not PurePosixPath(value).is_absolute() and not PureWindowsPath(value).drive and all(part not in {'', '.', '..'} for part in value.split('/'))


def contained_file(root, relative):
    if not safe_relative(relative):
        fail('relative_path', relative if isinstance(relative, str) else 'manifest')
        return None
    path = root / relative
    for part in [path, *path.parents]:
        if part == root:
            break
        if is_linked(part):
            fail('linked_repository_input', relative)
            return None
    try:
        path.resolve().relative_to(root)
    except ValueError:
        fail('path_containment', relative)
        return None
    if not path.is_file():
        fail('required_file', relative)
        return None
    return path


def read_bytes(root, relative):
    path = contained_file(root, relative)
    return path.read_bytes() if path else None


def read_json(root, relative):
    data = read_bytes(root, relative)
    if data is None:
        return None
    try:
        return json.loads(data.decode('utf-8-sig'))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail('json_structure', relative)
        return None


def mit_complete(data):
    return data is not None and ' '.join(MIT_BODY.split()) in ' '.join(data.decode('utf-8-sig').split())


def scan_text(relative, data):
    try:
        text = data.decode('utf-8-sig')
    except UnicodeDecodeError:
        if data.startswith((b'\xff\xfe', b'\xfe\xff')):
            text = data.decode('utf-16')
        else:
            if PurePosixPath(relative).suffix.lower() in TEXT_SUFFIXES:
                fail('text_encoding', relative)
            return
    counts['readableFilesScanned'] = counts.get('readableFilesScanned', 0) + 1
    normalized = re.sub(r'\\+', '/', text)
    user_directory, home_directory = 'Users', 'home'
    user_path_pattern = rf'(?i)(?:[A-Z]:/{user_directory}/|/{user_directory}/|/{home_directory}/)([^/\s\"\'`<>]+)'
    users = re.findall(user_path_pattern, normalized)
    private_users = sum(user.lower() not in ALLOWED_USERS for user in users)
    if private_users:
        fail('personal_absolute_user_path', relative, private_users)
    actual_user = os.environ.get('USERNAME') or os.environ.get('USER')
    if actual_user and actual_user.lower() not in ALLOWED_USERS | {'zoehao2026'}:
        found = len(re.findall(re.escape(actual_user), text, re.IGNORECASE))
        if found:
            fail('local_username', relative, found)
    caches = len(re.findall(r'(?i)[/\\]\.codex[/\\]|AppData/Local/Packages/OpenAI\.Codex_', normalized))
    if caches:
        fail('private_codex_cache_path', relative, caches)
    private_key = len(re.findall(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----', text))
    if private_key:
        fail('private_key', relative, private_key)
    issued_key = len(re.findall(r'\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|AKIA[A-Z0-9]{16})\b', text))
    if issued_key:
        fail('issued_api_secret', relative, issued_key)

    def placeholder(value):
        return 'redacted' in value.lower() or value.lower() in {'null', 'undefined'} or any(mark in value for mark in ['{', '}', '(', ')', '\\'])

    tokens = re.findall(r'[?&]token=([^\s\"\'&<>`]+)', text, re.IGNORECASE)
    literal_tokens = sum(not placeholder(value) for value in tokens)
    if literal_tokens:
        fail('literal_query_token', relative, literal_tokens)
    bearer = re.findall(r'\bauthorization[\s\"\']*[:=][\s\"\']*bearer[ \t]+([^\s\"\'<>`,;]+)', text, re.IGNORECASE)
    literal_bearer = sum(not placeholder(value) for value in bearer)
    if literal_bearer:
        fail('authorization_secret', relative, literal_bearer)
    literals = re.findall(r'[\"\'](?:api[_-]?key|api[_-]?secret|client[_-]?secret|access[_-]?token|refresh[_-]?token)[\"\']\s*:\s*[\"\']([A-Za-z0-9_./+=-]{20,})[\"\']', text, re.IGNORECASE)
    concrete = sum(not placeholder(value) and not value.lower().startswith(('your-', 'example-', 'placeholder-', 'process.env.')) and len(set(value)) >= 8 for value in literals)
    if concrete:
        fail('literal_api_secret', relative, concrete)


def gitignore_rules(root):
    path = root / '.gitignore'
    if not path.is_file():
        return []
    return [line.rstrip() for line in path.read_text(encoding='utf-8-sig').splitlines() if line.strip() and not line.startswith('#')]


def ignored(relative, directory, rules):
    # Supports the repository's basename, directory, rooted glob and negation rules.
    state = False
    for rule in rules:
        negate = rule.startswith('!')
        pattern = rule[1:] if negate else rule
        directory_rule = pattern.endswith('/')
        pattern = pattern.rstrip('/').removeprefix('/')
        parts = relative.split('/')
        if '/' in pattern:
            match = fnmatch.fnmatchcase(relative, pattern) or (directory_rule and relative.startswith(pattern + '/'))
        else:
            candidates = parts if directory or not directory_rule else parts[:-1]
            match = any(fnmatch.fnmatchcase(part, pattern) for part in candidates)
        if match:
            state = not negate
    return state


def scan_repository(root):
    rules = gitignore_rules(root)
    scanned = 0
    for base, directories, filenames in os.walk(root, followlinks=False):
        base_path = Path(base)
        kept = []
        for directory in directories:
            relative = (base_path / directory).relative_to(root).as_posix()
            if directory == '.git' or ignored(relative, True, rules):
                continue
            child = base_path / directory
            try:
                child.resolve().relative_to(root)
                outside = False
            except ValueError:
                outside = True
            if is_linked(child) or outside:
                fail('repository_symlink', relative)
            else:
                kept.append(directory)
        directories[:] = kept
        for filename in filenames:
            path = base_path / filename
            relative = path.relative_to(root).as_posix()
            if ignored(relative, False, rules):
                continue
            if is_linked(path):
                fail('repository_symlink', relative)
                continue
            if filename.startswith('.credentials') or filename in {'node.exe', 'node', 'pnpm.cjs'} or path.suffix.lower() in {'.exe', '.dll', '.node', '.pdb', '.zip'}:
                fail('unexpected_private_or_tool_payload', relative)
            if path.suffix.lower() != '.tgz':
                scan_text(relative, path.read_bytes())
            scanned += 1
    counts['repositoryFilesVisited'] = scanned


def verify(root):
    provenance = read_json(root, 'SOURCE-PROVENANCE.json')
    pins = read_json(root, 'plugins/baseline-pins.json')
    inventory = read_json(root, 'plugins/baseline-inventory.json')
    manifest = read_json(root, 'plugins/compatibility-manifest.json')
    notes = read_json(root, 'PUBLICATION-NOTES.json')
    if not isinstance(provenance, dict) or not isinstance(pins, dict) or not isinstance(inventory, list) or not isinstance(manifest, dict) or not isinstance(notes, dict):
        fail('required_manifest_structure', 'manifests')
        return
    expected_names = set(provenance.get('pluginBaselineVersions', {}))
    if provenance.get('pluginBaselineVersions') != EXPECTED_BASELINES:
        fail('three_plugin_baselines', 'SOURCE-PROVENANCE.json')
    if manifest.get('targetVersion') != provenance.get('targetVersion') or manifest.get('targetCommit') != provenance.get('targetCommit'):
        fail('compatible_target_identity', 'plugins/compatibility-manifest.json')
    inventory_by_name = {entry.get('name'): entry for entry in inventory if isinstance(entry, dict)}
    seen = set()
    pinned = 0
    baseline_data = {}
    for plugin in pins.get('plugins', []):
        name, relative, files = plugin.get('name'), plugin.get('path'), plugin.get('files')
        if name in seen or name not in expected_names or not safe_relative(relative) or not relative.startswith('baseline-sources/') or not isinstance(files, dict):
            fail('baseline_pin_structure', 'plugins/baseline-pins.json')
            continue
        seen.add(name)
        if plugin.get('version') != provenance['pluginBaselineVersions'][name]:
            fail('baseline_version', 'plugins/baseline-pins.json')
        entry = inventory_by_name.get(name, {})
        recorded = {item.get('path'): item.get('sha256') for item in entry.get('files', [])}
        if entry.get('version') != plugin.get('version') or recorded != files or len(recorded) != len(entry.get('files', [])):
            fail('inventory_equals_relative_pins', 'plugins/baseline-inventory.json')
        baseline_data[name] = {}
        for filename, expected_hash in files.items():
            pinned += 1
            if not safe_relative(filename):
                fail('baseline_relative_filename', 'plugins/baseline-pins.json')
                continue
            public_path = 'plugins/' + relative + '/' + filename
            data = read_bytes(root, public_path)
            if data is not None:
                baseline_data[name][filename] = data
                if sha256(data) != expected_hash:
                    fail('baseline_sha256', public_path)
    if pinned != 77 or pinned != provenance.get('baselinePinnedFiles') or seen != expected_names or set(inventory_by_name) != expected_names:
        fail('baseline_77_file_inventory', 'plugins/baseline-pins.json', pinned)
    counts['baselinePinnedFilesVerified'] = pinned

    for filename, expected_hash in provenance.get('patchSha256', {}).items():
        data = read_bytes(root, 'patches/' + filename)
        if data is not None and sha256(data) != expected_hash:
            fail('source_patch_sha256', 'patches/' + filename)
    if set(provenance.get('patchSha256', {})) != {'source-changes.patch', 'source-compatibility.patch'}:
        fail('two_source_patches', 'SOURCE-PROVENANCE.json')
    counts['sourcePatchHashesVerified'] = len(provenance.get('patchSha256', {}))

    archives = set()
    port_names = set()
    for plugin in manifest.get('plugins', []):
        name, relative = plugin.get('name'), plugin.get('archive')
        if name in port_names or name not in expected_names or not safe_relative(relative) or not relative.startswith('compatible-archives/') or plugin.get('path') != relative:
            fail('compatible_archive_relative_manifest', 'plugins/compatibility-manifest.json')
            continue
        port_names.add(name)
        label = 'plugins/' + relative
        archives.add(label)
        data = read_bytes(root, label)
        if data is None:
            continue
        if sha256(data) != plugin.get('archiveSha256'):
            fail('compatible_archive_sha256', label)
        actual_files = {}
        try:
            with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as package:
                for member in package.getmembers():
                    member_name = member.name.rstrip('/')
                    if not safe_relative(member_name) or not member_name.startswith('package/') or member.issym() or member.islnk() or not (member.isfile() or member.isdir()):
                        fail('archive_member_containment_or_type', label)
                        continue
                    if not member.isfile():
                        continue
                    relative_file = member.name.removeprefix('package/')
                    if relative_file in actual_files:
                        fail('archive_duplicate_member', label)
                    actual_files[relative_file] = package.extractfile(member).read()
        except (tarfile.TarError, OSError):
            fail('compatible_tar_structure', label)
            continue
        actual_hashes = {filename: sha256(content) for filename, content in actual_files.items()}
        if actual_hashes != plugin.get('files'):
            fail('archive_all_file_hashes', label)
        for filename, content in actual_files.items():
            scan_text(label + '!/' + filename, content)
            if filename not in {'package.json', 'cordis.patch.yml'} and filename in baseline_data.get(name, {}) and content != baseline_data[name][filename]:
                fail('preserved_plugin_payload_bytes', label + '!/' + filename)
        try:
            package_manifest = json.loads(actual_files.get('package.json', b''))
            if package_manifest.get('name') != name or package_manifest.get('version') != plugin.get('version'):
                fail('archive_package_identity', label)
        except (UnicodeDecodeError, json.JSONDecodeError):
            fail('archive_package_manifest', label)
        verify_licenses(root, name, actual_files, label)
    actual_archives = {'plugins/' + path.relative_to(root / 'plugins').as_posix() for path in (root / 'plugins/compatible-archives').glob('*.tgz')}
    if len(archives) != 3 or actual_archives != archives or port_names != expected_names:
        fail('three_compatible_archives', 'plugins/compatible-archives', len(archives))
    counts['compatibleArchivesVerified'] = len(archives)

    images = notes.get('documentationImages', {}).get('files', [])
    if len(images) != 3:
        fail('three_documentation_images', 'PUBLICATION-NOTES.json', len(images))
    for image in images:
        relative = image.get('path')
        data = read_bytes(root, relative)
        if data is not None:
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode('ascii') + b'\0' + data).hexdigest()
            if blob != image.get('gitBlobSha1'):
                fail('public_image_git_blob', relative)
    counts['documentationImageHashesVerified'] = len(images)
    for relative in ['LICENSE', 'licenses/DeepSeek-Harness-MIT.txt', 'licenses/clsx-MIT.txt']:
        if not mit_complete(read_bytes(root, relative)):
            fail('complete_mit_license', relative)
    read_bytes(root, 'THIRD_PARTY_NOTICES.md')


def verify_licenses(root, name, archived, label):
    directory = name.split('/')[-1]
    baseline = 'plugins/baseline-sources/' + directory + '/'
    if not mit_complete(archived.get('LICENSE')):
        fail('archive_complete_mit_license', label + '!/LICENSE')
    if not mit_complete(read_bytes(root, baseline + 'LICENSE')):
        fail('baseline_complete_mit_license', baseline + 'LICENSE')
    if directory in {'dsh-adaptive-mode', 'dsh-code-video-mode'}:
        for filename in ['LICENSE', 'NOTICE']:
            expected = read_bytes(root, baseline + filename)
            if expected is not None and archived.get(filename) != expected:
                fail('archive_supplemental_license_matches_source', label + '!/' + filename)
        license_text = archived.get('LICENSE', b'').decode('utf-8-sig')
        notice = archived.get('NOTICE', b'').decode('utf-8-sig')
        if '2026 DeepSeek' not in license_text or '2026 ZoeHao2026' not in license_text or 'standard preset' not in notice or 'https://github.com/deepseek-ai/deepseek-harness' not in notice:
            fail('derived_preset_attribution', label)
    else:
        for filename in ['THIRD_PARTY_NOTICES.md', 'LICENSES/DeepSeek-Harness-MIT.txt', 'LICENSES/clsx-MIT.txt']:
            expected = read_bytes(root, baseline + filename)
            if expected is not None and archived.get(filename) != expected:
                fail('ui_upstream_notice_preserved', label + '!/' + filename)
            if filename.endswith('.txt') and not mit_complete(expected):
                fail('ui_complete_upstream_mit', baseline + filename)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=ROOT)
    options = parser.parse_args()
    root = options.repo.resolve()
    verify(root)
    scan_repository(root)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        fail('verification_exception_' + type(error).__name__, 'verification')
    print(json.dumps({'pass': not issues, 'counts': counts, 'issues': issues}, ensure_ascii=False, indent=2))
    sys.exit(0 if not issues else 1)
