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
const bashDeployScript = read('deploy-v3.sh');
const deployBytes = readFileSync(path.join(root, 'deploy.ps1'));
const packageJson = JSON.parse(read('package.json'));
const stagingNginx = read('deploy/nginx/naruto-rpg-staging.conf');
const systemdLimits = read('deploy/systemd/naruto-rpg.service.d/limits.conf');
const memorySysctl = read('deploy/sysctl/90-naruto-rpg-memory.conf');

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
  assert.deepEqual(
    [...bytes.subarray(0, 5)],
    [...Buffer.from('@echo', 'ascii')],
    `${file} must start with ASCII @echo so cmd.exe does not execute the UTF-8 BOM`
  );
  assert.ok(bytes.includes(Buffer.from('\r\n')), `${file} must use CRLF for cmd.exe`);
  assert.doesNotMatch(
    bytes.toString('binary'),
    /(?<!\r)\n|\r(?!\n)/,
    `${file} must not contain mixed line endings`
  );
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
assert.match(productionBat, /按任意键开始部署/, 'production entry must use a simple key confirmation');
assert.doesNotMatch(productionBat, /set\s+\/p/i, 'production entry must not require a typed passphrase');
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
for (const directive of [
  'MemoryHigh=256M',
  'MemoryMax=384M',
  'MemorySwapMax=128M',
  'OOMPolicy=kill',
  'Restart=on-failure',
  'TimeoutStopSec=30s'
]) {
  assert.ok(systemdLimits.includes(directive), `systemd limits must include ${directive}`);
}
assert.match(memorySysctl, /^vm\.swappiness\s*=\s*10$/m, 'host memory policy must permit bounded swapping');
assert.match(deployScript, /ops[\\/]systemd[\\/]naruto-rpg\.service\.d[\\/]limits\.conf/i);
assert.match(deployScript, /ops[\\/]sysctl[\\/]90-naruto-rpg-memory\.conf/i);
assert.match(deployScript, /systemctl\s+daemon-reload/i, 'production deployment must reload systemd after installing limits');
assert.match(deployScript, /sysctl\s+-p\s+\/etc\/sysctl\.d\/90-naruto-rpg-memory\.conf/i);
assert.match(deployScript, /127\.0\.0\.1:3000\/health\/ready/i, 'production deployment must wait for backend readiness');
assert.match(bashDeployScript, /PROJECT_DIR="\$SCRIPT_DIR"/, 'root-level Bash deployer must use the repository root');
for (const requiredPath of [
  'js/core/timeline-save-schema.js',
  'js/core/shinobi-daily.js',
  'js/core/narrative-artifact.js',
  'js/core/image-studio/contracts.js',
  'js/core/continuity-ledger.js',
  'js/utils/format.js',
  'deploy/systemd/naruto-rpg.service.d/limits.conf',
  'deploy/sysctl/90-naruto-rpg-memory.conf'
]) {
  assert.ok(bashDeployScript.includes(requiredPath), `Bash deployment must package ${requiredPath}`);
  if (requiredPath.startsWith('js/')) {
    assert.ok(
      bashDeployScript.split(requiredPath).length - 1 >= 3,
      `Bash deployment must copy, package-check and remotely verify ${requiredPath}`
    );
  }
}
assert.match(bashDeployScript, /127\.0\.0\.1:3000\/health\/ready/i, 'Bash deployment must wait for backend readiness');
assert.match(bashDeployScript, /function?\s*retry_remote|retry_remote\s*\(\)/i, 'Bash deployment must define remote retries');
assert.match(
  bashDeployScript,
  /retry_remote\s+"执行远端部署"[\s\S]{0,240}ssh/i,
  'Bash production deployment must retry its final SSH execution'
);
assert.match(
  bashDeployScript,
  /REMOTE_SCRIPTS=\([\s\S]{0,220}sha256sum -c/i,
  'Bash archive verification must share the retried deployment SSH session'
);
assert.doesNotMatch(
  bashDeployScript,
  /retry_remote\s+"校验远端部署包"/i,
  'Bash archive verification must not consume a separate SSH connection'
);
assert.match(
  bashDeployScript,
  /if \[ -f '\$\{REMOTE_ARCHIVE\}\.part' \][\s\S]{0,500}else test -f '\$REMOTE_ARCHIVE'/i,
  'Bash archive verification must be idempotent after a lost SSH acknowledgement'
);
assert.match(
  bashDeployScript,
  /BACKUP_DIR='\$\{TARGET_DIR\}\.bak\.\$\{DEPLOYMENT_ID\}'[\s\S]{0,180}! -e \\"\\\$BACKUP_DIR\\"/i,
  'Bash deployment retries must not create duplicate production backups'
);
assert.match(
  bashDeployScript,
  /retry_remote\s+"清理远端临时文件"/i,
  'Bash cleanup must run separately after a confirmed deployment'
);
for (const sharedModule of [
  'js/core/timeline-save-schema.js',
  'js/core/shinobi-daily.js',
  'js/core/narrative-artifact.js',
  'js/core/image-studio/contracts.js',
  'js/core/continuity-ledger.js',
  'js/utils/format.js'
]) {
  const escaped = sharedModule.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('/', '[\\\\/]');
  assert.match(
    deployScript,
    new RegExp(escaped, 'i'),
    `production package must include backend shared module ${sharedModule}`
  );
  assert.ok(
    deployScript.split(sharedModule).length - 1 >= 3,
    `PowerShell deployment must copy, package-check and remotely verify ${sharedModule}`
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
assert.match(
  deployScript,
  /\$RemoteSteps\s*=\s*@\([\s\S]{0,160}\$FinalizeRemoteUpload/i,
  'archive verification must share the retried deployment SSH session'
);
assert.doesNotMatch(
  deployScript,
  /-Arguments\s*\(\$SshOptions\s*\+\s*@\(\$Server,\s*\$FinalizeRemoteUpload\)\)/i,
  'archive verification must not consume a separate SSH connection'
);
assert.match(
  deployScript,
  /Start-Sleep\s+-Seconds\s+12[\s\S]{0,500}\$RemoteSteps\s*=\s*@\(/i,
  'deployment must cool down after upload before opening SSH'
);
assert.match(
  deployScript,
  /\$RemoteDeployCommand\s*=\s*\$RemoteSteps\s*-join\s*';\s*'[\s\S]{0,500}Invoke-NativeWithRetry[\s\S]{0,900}-Arguments\s*\(\$SshOptions\s*\+\s*@\(\$Server,\s*\$RemoteDeployCommand\)\)/i,
  'the final remote deployment must retry transient SSH disconnects'
);
assert.doesNotMatch(
  deployScript,
  /\$RemoteSteps\s*\+=\s*"rm\s+-rf\s+'\$RemoteRelease'\s+'\$RemoteArchive'/i,
  'the retried deployment command must not delete its own retry payload'
);
assert.match(
  deployScript,
  /\$RemoteCleanupCommand[\s\S]{0,1000}远端临时文件清理失败/i,
  'remote payload cleanup must run separately after a confirmed deployment'
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
  // NoDefaultCurrentDirectoryInExePath=1（Node 及新版 Windows 环境）会禁止
  // cmd.exe 从当前目录解析裸文件名，因此必须用显式相对路径调用。
  const wrapperOptions = {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NARUTO_DEPLOY_NO_PAUSE: '1' }
  };
  const productionWrapperDryRun = spawnSync(cmd, [
    '/d', '/c', 'call .\\部署正式站.bat -DryRun -SkipBuild'
  ], wrapperOptions);
  const productionWrapperOutput = `${productionWrapperDryRun.stdout}\n${productionWrapperDryRun.stderr}`;
  assert.equal(productionWrapperDryRun.status, 0, productionWrapperOutput);
  assert.match(productionWrapperOutput, /DRY_RUN_OK=production/);
  assert.match(productionWrapperOutput, /正式站部署成功/);

  const wrapperFailure = spawnSync(cmd, [
    '/d', '/c', 'call .\\部署测试站.bat -DefinitelyInvalidParameter'
  ], wrapperOptions);
  assert.notEqual(wrapperFailure.status, 0, 'staging wrapper must propagate PowerShell failure');
  const wrapperOutput = `${wrapperFailure.stdout}\n${wrapperFailure.stderr}`;
  assert.match(wrapperOutput, /测试站部署失败，错误码：[1-9][0-9]*/);
  assert.doesNotMatch(wrapperOutput, /测试站部署失败，错误码：0/);
}

console.log('deployment-script-regression: passed');
