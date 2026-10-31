"""Assemble privately held GPT assets with the exact tested repository.

python3 ops/assemble-delivery.py ORIGINAL_ZIP OUTPUT_DIRECTORY
Never uploads original asset content to the public source repository.
Default status is ASSEMBLED_NOT_FINAL; production and installation evidence
must be reviewed separately before a final deliverable can be named as such.
"""
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
original, output = map(lambda p: Path(p).resolve(), sys.argv[1:3])
if output == root or root in output.parents:
    raise SystemExit('PRIVATE_DELIVERY_MUST_REMAIN_OUTSIDE_PUBLIC_REPOSITORY')
if output.exists():
    raise SystemExit('OUTPUT_ALREADY_EXISTS_NO_OVERWRITE')

assets = {
    '02_INSTRUCTIONS/CRYPTO_ALPHA_V27_INSTRUCTIONS.txt': 'd1142d19864d75d449a07119b29df7894517630a1ee59c35086db7cb6fec7750',
    '02_INSTRUCTIONS/CONVERSATION_STARTERS.txt': 'bf602fe07cb31ed06f382f261e5e9f891c47a513da9cbea9b612e3139057e39d',
    '02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt': 'f357b0e9d779c3162cfcda979fc1cd6978e8d855576459f6f25f5ba1f937cc10',
    '03_KNOWLEDGE/CRYPTO_ALPHA_V27_KNOWLEDGE_FULL.md': 'cc797964732217aed92391b1191dd5c985426aefe0c5f0490ab1c9e3bc7f4769',
    '06_ACTION/openapi.json': 'cf0aa97a5a8a25baea719f8fbef1bb8c449778cd9dcaf59bde118d08aa5f529f',
}
sha256 = lambda b: hashlib.sha256(b).hexdigest()
manifest = json.loads((root / 'ops/release-manifest.json').read_text())
source = (root / 'main-v188.js').read_bytes()
blob = hashlib.sha1(b'blob ' + str(len(source)).encode() + b'\0' + source).hexdigest()
if blob != manifest['sourceGitBlobSha']:
    raise SystemExit('IMMUTABLE_SOURCE_MISMATCH')
summary = json.loads((root / 'test-results/summary.json').read_text())
if len(summary['suites']) < 52 or not all(s['passed'] for s in summary['suites']):
    raise SystemExit('FULL_REGRESSION_REQUIRED')
if not any(s['suite'] == 'verify-workerd-response-isolation.mjs' for s in summary['suites']):
    raise SystemExit('NATIVE_REGRESSION_REQUIRED')

with ZipFile(original) as archive:
    if archive.testzip() is not None:
        raise SystemExit('ORIGINAL_ZIP_CRC_FAILED')
    names = archive.namelist()
    prefixes = {n.split('/')[0] for n in names}
    if len(prefixes) != 1:
        raise SystemExit('AMBIGUOUS_ORIGINAL_ARCHIVE_ROOT')
    prefix = prefixes.pop() + '/'
    for name, expected in assets.items():
        if sha256(archive.read(prefix + name)) != expected:
            raise SystemExit('ORIGINAL_ASSET_HASH_MISMATCH: ' + name)
    output.mkdir(parents=True)
    # Keep the complete original intact as rollback evidence, with a clear role.
    rollback = output / '05_ROLLBACK/ORIGINAL_V27_6_2.zip'
    rollback.parent.mkdir(parents=True)
    shutil.copy2(original, rollback)
    for name in assets:
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(prefix + name))

# Only the obsolete expected deployment identifier changes in the full opener.
full_opening = output / '02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt'
text = full_opening.read_text().replace('crypto-alpha-worker-v27.6.2-owner-local-dispatch', manifest['build'])
full_opening.write_text(text)
shutil.copy2(root / 'GPT_OPENING_V27_6_3_CANDIDATE.txt', output / '02_INSTRUCTIONS/OPENING_UNDER_500.txt')
for directory in ['ops', 'tests', 'test-results', 'docs', 'evidence']:
    shutil.copytree(root / directory, output / directory)
for name in ['main-v188.js', 'wrangler.jsonc', 'package.json', 'package-lock.json']:
    shutil.copy2(root / name, output / name)
    if name in ['main-v188.js', 'wrangler.jsonc']:
        (output / '01_CODE').mkdir(exist_ok=True)
        shutil.copy2(root / name, output / '01_CODE' / name)
for p in root.glob('*.md'):
    shutil.copy2(p, output / p.name)
shutil.copy2(root / 'USER_ACCEPTANCE.md', output / 'READ_ONLY_ACCEPTANCE.md')
instructions = output / '02_INSTRUCTIONS/CRYPTO_ALPHA_V27_INSTRUCTIONS.txt'
assert len(instructions.read_text()) <= 8000
assert len((output / '02_INSTRUCTIONS/OPENING_UNDER_500.txt').read_text()) <= 500
for name in assets:
    if name != '02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt':
        assert sha256((output / name).read_bytes()) == assets[name]
subprocess.run(['node', str(root / 'ops/verify-delivery-package.mjs'), str(output), manifest['build']], cwd=root, check=True)
receipt = {
    'status': 'ASSEMBLED_NOT_FINAL',
    'build': manifest['build'], 'sourceGitBlobSha': blob,
    'inheritedOriginalSha256': sha256(original.read_bytes()),
    'originalAssets': assets,
    'changesToOriginalAssets': {'02_INSTRUCTIONS/FULL_OPENING_MESSAGE.txt': 'EXPECTED_BUILD_IDENTIFIER_ONLY'},
    'regressionSuites': len(summary['suites']),
    'productionAcceptancePassed': False, 'gptInstalledVerified': False,
    'preparedNotificationLiveVerified': False, 'strategyProfitabilityVerified': False,
}
(output / 'DELIVERY_MANIFEST.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n')
files = sorted(p for p in output.rglob('*') if p.is_file())
(output / 'SHA256SUMS.txt').write_text(''.join(sha256(p.read_bytes()) + '  ' + p.relative_to(output).as_posix() + '\n' for p in files))
print(json.dumps({'status': receipt['status'], 'fileCount': len(files) + 1, 'fullOriginalAssetsVerified': True, 'sourceGitBlobSha': blob}))
