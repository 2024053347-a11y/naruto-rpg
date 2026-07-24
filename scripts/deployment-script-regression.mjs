import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(path.join(root, file), 'utf8');

const stagingBat = read('部署测试站.bat');
const productionBat = read('部署正式站.bat');
const deployScript = read('deploy.ps1');
const deployBytes = readFileSync(path.join(root, 'deploy.ps1'));
const packageJson = JSON.parse(read('package.json'));
const stagingNginx = read('deploy/nginx/naruto-rpg-staging.conf');

assert.equal(packageJson.version, '3.0.0', 'production release metadata must identify v3');

function extractBracedBlock(source, startPattern, label) {
  const match = startPattern.exec(source);
  assert.ok(match, `missing ${label}`);
  const open = source.indexOf('{', match.index);
  assert.notEqual(open, -1, `missing opening brace for ${label}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }
  assert.fail(`missing closing brace for ${label}`);
}

function artifactFingerprint(file) {
  if (!existsSync(file)) return { exists: false };
  const content = readFileSync(file);
  return {
    exists: true,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex')
  };
}

assert.deepEqual(
  [...deployBytes.subarray(0, 3)],
  [0xef, 0xbb, 0xbf],
  'deploy.ps1 must use UTF-8 BOM for Windows PowerShell 5.1'
);

for (const file of ['部署测试站.bat', '部署正式站.bat']) {
  const bytes = readFileSync(path.join(root, file));
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], `${file} must use UTF-8 BOM`);
  assert.ok(bytes.includes(Buffer.from('\r\n')), `${file} must use CRLF for cmd.exe`);
}

for (const [name, source] of [
  ['部署测试站.bat', stagingBat],
  ['部署正式站.bat', productionBat]
]) {
  assert.doesNotMatch(source, /\bbash(?:\.exe)?\b|deploy\.sh/i, `${name} must not depend on Bash/WSL`);
  assert.match(source, /powershell\.exe[\s\S]*deploy\.ps1/i, `${name} must use the native PowerShell deployer`);
}

assert.match(stagingBat, /-Mode\s+staging/i, 'staging entry must target staging');
assert.doesNotMatch(stagingBat, /-Mode\s+production/i, 'staging entry must never target production');
assert.match(productionBat, /DEPLOY-PRODUCTION/, 'production entry must require an explicit typed confirmation');
assert.match(productionBat, /-Mode\s+production[\s\S]*-ConfirmProduction/i, 'production entry must pass the confirmation switch');

assert.match(deployScript, /\[switch\]\$DryRun/, 'deployer must expose an offline DryRun mode');
assert.match(deployScript, /\$PackageMetadata[\s\S]{0,240}\$PackageVersion/i, 'deployer must derive the release from package.json');
assert.match(deployScript, /Write-ReleaseManifest[\s\S]{0,160}version\.json/i, 'deployer must publish machine-readable release metadata');
assert.match(deployScript, /RELEASE_VERSION=\$ReleaseVersion/i, 'successful deployment must report the release version');
assert.match(
  deployScript,
  /grep\s+-Fq\s+'\$ReleaseVersion'\s+'\$\(\$Target\.TargetDir\)\/version\.json'/i,
  'remote release verification must avoid nested JSON quotes that Windows OpenSSH can reinterpret'
);
assert.doesNotMatch(
  deployScript,
  /grep\s+-Fq\s+''?"version"/i,
  'remote release verification must not depend on preserving embedded JSON quotes'
);
assert.match(deployScript, /server\\data/, 'production package must explicitly protect server/data');
assert.match(deployScript, /server\\db/, 'production package must explicitly protect legacy server/db runtime data');
for (const sharedModule of [
  'js/core/timeline-save-schema.js',
  'js/core/continuity-ledger.js',
  'js/utils/format.js'
]) {
  const escaped = sharedModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '[\\\\/]');
  assert.match(
    deployScript,
    new RegExp(escaped, 'i'),
    `production package must include backend shared module ${sharedModule}`
  );
}
assert.match(deployScript, /https:\/\/www\.qiwu\.asia:8080\/login\.html/i, 'staging verification must use the real TLS port');
assert.doesNotMatch(deployScript, /curl\s+-[^\r\n;]*k/, 'TLS verification must not disable certificate checks');
assert.match(deployScript, /exit\s+\$ExitCode/i, 'deployer must explicitly return its final process status');
assert.match(deployScript, /function\s+Invoke-NativeWithRetry/i, 'deployment transport must retry transient native failures');
for (const option of [
  'ConnectionAttempts=3',
  'ServerAliveInterval=15',
  'ServerAliveCountMax=4',
  'TCPKeepAlive=yes',
  'IPQoS=none'
]) {
  assert.ok(deployScript.includes(option), 'deployment SSH transport must set ' + option);
}
assert.match(
  deployScript,
  /FinalAttemptPrefixArguments\s+@\('-O'\)/i,
  'final upload attempt must fall back to the compatible SCP protocol'
);
assert.match(deployScript, /\$RemoteArchivePart\s*=\s*"\$RemoteArchive\.part"/i, 'uploads must use a partial remote path');
assert.match(deployScript, /Get-FileHash[\s\S]{0,160}SHA256/i, 'deployment archive must be hashed locally');
assert.match(deployScript, /sha256sum\s+-c/i, 'uploaded archive must be verified remotely');
assert.match(
  deployScript,
  /mv\s+-f\s+'?\$RemoteArchivePart'?\s+'?\$RemoteArchive'?/i,
  'verified upload must be atomically promoted'
);

const stagingTarget = extractBracedBlock(deployScript, /\bstaging\s*=\s*@\{/i, 'staging target');
assert.match(stagingTarget, /TargetDir\s*=\s*['"]\/var\/www\/naruto-rpg-staging['"]/i);
assert.match(stagingTarget, /PublicUrl\s*=\s*['"]https:\/\/www\.qiwu\.asia:8080\/['"]/i);
assert.match(stagingTarget, /RestartBackend\s*=\s*\$false/i);
assert.doesNotMatch(stagingTarget, /TargetDir\s*=\s*['"]\/var\/www\/naruto-rpg['"]/i);

assert.equal(
  packageJson.scripts['build:deploy'],
  'npm run build-canon-runtime && npm run sync-public',
  'deployment build must only refresh runtime data and public mirrors'
);
assert.doesNotMatch(packageJson.scripts['build:deploy'], /\bbundle\b|build-regex|\bbuild\b(?!-canon-runtime)/i);
assert.match(deployScript, /Mode\s+-eq\s+'staging'[\s\S]{0,240}'build:deploy'/i);

const stagingServer = extractBracedBlock(stagingNginx, /\bserver\s*\{/i, 'staging Nginx server');
const authLocation = extractBracedBlock(stagingNginx, /location\s*=\s*\/_staging_auth\s*\{/i, 'staging auth location');
const rootLocation = extractBracedBlock(stagingNginx, /location\s*=\s*\/\s*\{/i, 'staging root location');
const indexLocation = extractBracedBlock(stagingNginx, /location\s*=\s*\/index\.html\s*\{/i, 'staging index location');

assert.match(stagingServer, /listen\s+8080\s+ssl;/i);
assert.match(stagingServer, /root\s+\/var\/www\/naruto-rpg-staging;/i);
assert.doesNotMatch(stagingServer, /root\s+\/var\/www\/naruto-rpg;/i);
assert.match(authLocation, /internal;/i);
assert.match(authLocation, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000\/auth\/me;/i);
for (const [name, block] of [['root', rootLocation], ['index', indexLocation]]) {
  assert.match(block, /auth_request\s+\/_staging_auth;/i, `${name} must require staging auth`);
  assert.match(block, /try_files\s+\/index\.html\s+=404;/i, `${name} must serve the staging index`);
  assert.doesNotMatch(block, /proxy_pass/i, `${name} must not proxy to the production backend`);
}
assert.match(stagingNginx, /error_page\s+401\s+=\s+@staging_login;[\s\S]*location\s+@staging_login[\s\S]*return\s+302\s+\/login\.html;/i);
assert.match(stagingNginx, /error_page\s+403\s+=\s+@staging_banned;[\s\S]*location\s+@staging_banned[\s\S]*return\s+302\s+\/login\.html\?error=banned;/i);
assert.match(deployScript, /--dump-header[\s\S]{0,800}location:\s+\$\(\$Target\.VerifyUrl\)[\s\S]{0,400}x-staging:\s+true/i);

if (process.platform === 'win32') {
  const powershell = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  const invoke = args => spawnSync(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-File', path.join(root, 'deploy.ps1'),
    ...args
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  });

  const artifactFiles = [
    'naruto-rpg-bundle.html',
    'regex-正文-火影忍者-单文件版.json',
    'regex-正文-火影忍者-起物单文件版.json'
  ].map(file => path.join(root, 'dist', file));
  const artifactsBefore = artifactFiles.map(artifactFingerprint);
  const stagingDryRun = invoke(['-Mode', 'staging', '-DryRun']);
  assert.equal(stagingDryRun.status, 0, stagingDryRun.stderr || stagingDryRun.stdout);
  assert.match(stagingDryRun.stdout, /DRY_RUN_OK=staging/);
  assert.match(stagingDryRun.stdout, /PACKAGE_ASSETS_OK=true/);
  assert.deepEqual(
    artifactFiles.map(artifactFingerprint),
    artifactsBefore,
    'staging build must not create or change bundle/regex artifacts'
  );

  const refusedProduction = invoke(['-Mode', 'production', '-SkipBuild']);
  assert.notEqual(refusedProduction.status, 0, 'production must be refused without explicit confirmation');
  assert.match(
    `${refusedProduction.stdout}\n${refusedProduction.stderr}`,
    /ConfirmProduction|正式站部署已拒绝/
  );

  const productionDryRun = invoke(['-Mode', 'production', '-DryRun', '-SkipBuild']);
  assert.equal(productionDryRun.status, 0, productionDryRun.stderr || productionDryRun.stdout);
  assert.match(productionDryRun.stdout, /DRY_RUN_OK=production/);
  assert.match(productionDryRun.stdout, /RUNTIME_DATA_EXCLUDED=true/);

  const cmd = process.env.ComSpec || `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\cmd.exe`;
  const wrapperFailure = spawnSync(cmd, [
    '/d', '/c', 'call 部署测试站.bat -DefinitelyInvalidParameter'
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NARUTO_DEPLOY_NO_PAUSE: '1' }
  });
  assert.notEqual(wrapperFailure.status, 0, 'staging wrapper must propagate PowerShell failure');
  const wrapperOutput = `${wrapperFailure.stdout}\n${wrapperFailure.stderr}`;
  assert.match(wrapperOutput, /测试站部署失败，错误码：[1-9][0-9]*/);
  assert.doesNotMatch(wrapperOutput, /测试站部署失败，错误码：0/);
}

console.log('deployment-script-regression: passed');
