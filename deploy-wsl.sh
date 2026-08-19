#!/usr/bin/env bash
# 忍者手记 WSL 部署器：同一入口发布测试站或正式站。

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$SCRIPT_DIR"
PACKAGE_JSON="$PROJECT_DIR/package.json"
DEFAULT_CONFIG="$PROJECT_DIR/deploy.local.env"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log() { printf '%b[DEPLOY]%b %s\n' "$CYAN" "$NC" "$*"; }
ok() { printf '%b[  OK ]%b %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%b[WARN]%b %s\n' "$YELLOW" "$NC" "$*" >&2; }
fail() { printf '%b[FAIL]%b %s\n' "$RED" "$NC" "$*" >&2; exit 1; }

usage() {
  cat <<'USAGE'
用法：
  bash deploy-wsl.sh [staging|production] [选项]

环境：
  staging                 测试站（默认）
  production              正式站；实际发布必须加 --confirm-production

选项：
  --mode <环境>           与位置参数等价
  --dry-run               只构建并校验部署包，不连接服务器
  --skip-build            使用当前 public/，跳过 npm 构建
  --confirm-production    明确授权正式站发布
  --config <文件>         本地配置文件，默认 deploy.local.env
  --release-version <值>  必须与 package.json 的 version 完全一致
  -h, --help              显示帮助

示例：
  bash deploy-wsl.sh staging
  bash deploy-wsl.sh staging --dry-run
  bash deploy-wsl.sh production --dry-run
  bash deploy-wsl.sh production --confirm-production

配置文件仅接受：
  NARUTO_DEPLOY_SERVER=root@example.com
  NARUTO_DEPLOY_SSH_KEY=~/.ssh/id_ed25519

同名环境变量优先于配置文件。
USAGE
}

require_value() {
  local option="$1"
  local value="${2:-}"
  [[ -n "$value" && "$value" != --* ]] || fail "$option 缺少参数"
}

MODE=""
DRY_RUN=false
SKIP_BUILD=false
CONFIRM_PRODUCTION=false
CONFIG_FILE="$DEFAULT_CONFIG"
REQUESTED_RELEASE=""

while (($# > 0)); do
  case "$1" in
    staging|production)
      [[ -z "$MODE" || "$MODE" == "$1" ]] || fail "只能选择一个部署环境"
      MODE="$1"
      shift
      ;;
    --mode)
      require_value "$1" "${2:-}"
      [[ -z "$MODE" || "$MODE" == "$2" ]] || fail "只能选择一个部署环境"
      MODE="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --skip-build)
      SKIP_BUILD=true
      shift
      ;;
    --confirm-production)
      CONFIRM_PRODUCTION=true
      shift
      ;;
    --config)
      require_value "$1" "${2:-}"
      CONFIG_FILE="$2"
      shift 2
      ;;
    --release-version)
      require_value "$1" "${2:-}"
      REQUESTED_RELEASE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "未知参数：$1（使用 --help 查看用法）"
      ;;
  esac
done

MODE="${MODE:-staging}"
[[ "$MODE" == staging || "$MODE" == production ]] || fail "部署环境只能是 staging 或 production"

command -v node >/dev/null 2>&1 || fail "缺少 node"
command -v npm >/dev/null 2>&1 || fail "缺少 npm"
command -v tar >/dev/null 2>&1 || fail "缺少 tar"
command -v sha256sum >/dev/null 2>&1 || fail "缺少 sha256sum"
[[ -s "$PACKAGE_JSON" ]] || fail "缺少 package.json：$PACKAGE_JSON"

RELEASE_VERSION="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(p.version||""));' "$PACKAGE_JSON")"
[[ "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.-]+)?$ ]] \
  || fail "package.json version 不合法：$RELEASE_VERSION"
if [[ -n "$REQUESTED_RELEASE" && "$REQUESTED_RELEASE" != "$RELEASE_VERSION" ]]; then
  fail "发布版本与 package.json 不一致：参数=$REQUESTED_RELEASE，package.json=$RELEASE_VERSION"
fi

if [[ "$MODE" == production && "$DRY_RUN" == false && "$CONFIRM_PRODUCTION" == false ]]; then
  fail "正式站部署已拒绝：请显式追加 --confirm-production"
fi

trim_config_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 ]]; then
    if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

CONFIG_SERVER=""
CONFIG_SSH_KEY=""
if [[ -f "$CONFIG_FILE" ]]; then
  while IFS= read -r raw_line || [[ -n "$raw_line" ]]; do
    line="${raw_line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "$line" || "$line" == \#* ]] && continue
    [[ "$line" == *=* ]] || fail "配置行缺少 =：$line"
    key="${line%%=*}"
    key="${key%"${key##*[![:space:]]}"}"
    value="$(trim_config_value "${line#*=}")"
    case "$key" in
      NARUTO_DEPLOY_SERVER) CONFIG_SERVER="$value" ;;
      NARUTO_DEPLOY_SSH_KEY) CONFIG_SSH_KEY="$value" ;;
      *) fail "配置文件包含不支持的键：$key" ;;
    esac
  done < "$CONFIG_FILE"
  log "已读取本地配置：$CONFIG_FILE"
fi

DEPLOY_SERVER="${NARUTO_DEPLOY_SERVER:-$CONFIG_SERVER}"
DEPLOY_SSH_KEY="${NARUTO_DEPLOY_SSH_KEY:-${CONFIG_SSH_KEY:-${HOME:?HOME 未设置}/.ssh/id_ed25519}}"
if [[ "$DEPLOY_SSH_KEY" == '~/'* ]]; then
  DEPLOY_SSH_KEY="${HOME:?HOME 未设置}/${DEPLOY_SSH_KEY:2}"
fi

case "$MODE" in
  staging)
    TARGET_DIR='/var/www/naruto-rpg-staging'
    PUBLIC_URL='https://www.qiwu.asia:8080/'
    VERIFY_URL='https://www.qiwu.asia:8080/login.html'
    VERIFY_RESOLVE='www.qiwu.asia:8080:127.0.0.1'
    BUILD_TASK='build:deploy'
    ;;
  production)
    TARGET_DIR='/var/www/naruto-rpg'
    PUBLIC_URL='https://www.qiwu.asia/'
    VERIFY_URL='https://www.qiwu.asia/login.html'
    VERIFY_RESOLVE='www.qiwu.asia:443:127.0.0.1'
    BUILD_TASK='build'
    ;;
esac

BACKEND_DIR='/opt/naruto-rpg'
BUILD_ID="$(date +%y%m%d%H%M)"
DEPLOYMENT_ID="v${RELEASE_VERSION}-${BUILD_ID}-$$"
TEMP_PARENT="${TMPDIR:-/tmp}"
[[ -d "$TEMP_PARENT" ]] || fail "临时目录不存在：$TEMP_PARENT"
WORK_DIR="$(mktemp -d "$TEMP_PARENT/naruto-rpg-deploy-${MODE}-${DEPLOYMENT_ID}.XXXXXX")"
PAYLOAD_DIR="$WORK_DIR/payload"
STATIC_DIR="$PAYLOAD_DIR/static"
BACKEND_PAYLOAD="$PAYLOAD_DIR/backend"
ARCHIVE="$WORK_DIR/naruto-rpg-${MODE}-${DEPLOYMENT_ID}.tar.gz"

cleanup_local() {
  local expected_prefix="$TEMP_PARENT/naruto-rpg-deploy-${MODE}-${DEPLOYMENT_ID}."
  if [[ -n "${WORK_DIR:-}" && "$WORK_DIR" == "$expected_prefix"* && -d "$WORK_DIR" ]]; then
    rm -rf -- "$WORK_DIR"
  fi
}
trap cleanup_local EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

retry_remote() {
  local label="$1"
  local attempts="$2"
  local initial_delay="$3"
  shift 3
  local attempt status=1 delay
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    log "$label（尝试 $attempt/$attempts）"
    if "$@"; then
      return 0
    else
      status=$?
    fi
    if ((attempt < attempts)); then
      delay=$((initial_delay * attempt))
      ((delay > 30)) && delay=30
      warn "$label 失败（exit $status），${delay} 秒后重试"
      sleep "$delay"
    fi
  done
  return "$status"
}

upload_archive() {
  local remote_part="$1"
  local attempt status=1 delay
  local -a upload_command
  for ((attempt = 1; attempt <= 6; attempt++)); do
    upload_command=(scp)
    if ((attempt == 6)); then
      warn "常规 SFTP 上传连续失败，最后一次改用兼容 SCP 协议"
      upload_command+=(-O)
    fi
    upload_command+=("${SSH_OPTIONS[@]}" "$ARCHIVE" "${DEPLOY_SERVER}:${remote_part}")
    log "上传部署包（尝试 $attempt/6）"
    if "${upload_command[@]}"; then
      return 0
    else
      status=$?
    fi
    if ((attempt < 6)); then
      delay=$((10 * attempt))
      ((delay > 30)) && delay=30
      warn "上传失败（exit $status），${delay} 秒后重试"
      sleep "$delay"
    fi
  done
  return "$status"
}

printf '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'
log "忍者手记 WSL 部署器"
log "环境：$MODE"
log "版本：v$RELEASE_VERSION"
log "构建：$BUILD_ID"
log "目标：$PUBLIC_URL"
if [[ "$DRY_RUN" == true ]]; then
  warn "DryRun：不会连接或修改服务器"
fi
printf '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n'

if [[ "$SKIP_BUILD" == false ]]; then
  log "STEP 1/6：运行 npm run $BUILD_TASK"
  (cd "$PROJECT_DIR" && npm run "$BUILD_TASK")
  ok "构建完成"
else
  log "STEP 1/6：跳过构建"
fi

log "STEP 2/6：组装临时部署包"
mkdir -p "$STATIC_DIR"
cp -a "$PROJECT_DIR/public/." "$STATIC_DIR/"

for html_file in "$STATIC_DIR/index.html" "$STATIC_DIR/login.html"; do
  [[ -s "$html_file" ]] || fail "静态包缺少 $(basename "$html_file")"
  grep -Eq '\?v=[0-9]+' "$html_file" || fail "$(basename "$html_file") 缺少可替换的构建查询参数"
  sed -E -i "s/\?v=[0-9]+/?v=$BUILD_ID/g" "$html_file"
  grep -Fq "?v=$BUILD_ID" "$html_file" || fail "$(basename "$html_file") 构建号写入失败"
done

node "$PROJECT_DIR/scripts/generate-version.mjs" \
  --out "$STATIC_DIR/version.json" \
  --build "$BUILD_ID" \
  --environment "$MODE" >/dev/null

mkdir -p "$BACKEND_PAYLOAD/server"
SERVER_ROOT="$PROJECT_DIR/server"
while IFS= read -r -d '' source_file; do
  relative_path="${source_file#"$SERVER_ROOT/"}"
  destination_file="$BACKEND_PAYLOAD/server/$relative_path"
  mkdir -p "$(dirname "$destination_file")"
  cp "$source_file" "$destination_file"
done < <(find "$SERVER_ROOT" -type f -name '*.js' -print0)

cp "$PROJECT_DIR/package.json" "$PROJECT_DIR/package-lock.json" "$BACKEND_PAYLOAD/"

SHARED_MODULES=(
  'js/core/timeline-save-schema.js'
  'js/core/shinobi-daily.js'
  'js/core/narrative-artifact.js'
  'js/core/image-studio/contracts.js'
  'js/core/continuity-ledger.js'
  'js/utils/format.js'
)
for shared_module in "${SHARED_MODULES[@]}"; do
  destination_file="$BACKEND_PAYLOAD/$shared_module"
  mkdir -p "$(dirname "$destination_file")"
  cp "$PROJECT_DIR/$shared_module" "$destination_file"
done

mkdir -p "$PAYLOAD_DIR/ops/systemd/naruto-rpg.service.d" "$PAYLOAD_DIR/ops/sysctl"
cp "$PROJECT_DIR/deploy/systemd/naruto-rpg.service.d/limits.conf" \
  "$PAYLOAD_DIR/ops/systemd/naruto-rpg.service.d/limits.conf"
cp "$PROJECT_DIR/deploy/sysctl/90-naruto-rpg-memory.conf" \
  "$PAYLOAD_DIR/ops/sysctl/90-naruto-rpg-memory.conf"

if [[ "$MODE" == staging ]]; then
  mkdir -p "$PAYLOAD_DIR/ops/nginx"
  cp "$PROJECT_DIR/deploy/nginx/naruto-rpg-staging.conf" \
    "$PAYLOAD_DIR/ops/nginx/naruto-rpg-staging.conf"
fi

log "STEP 3/6：校验部署包"
REQUIRED_FILES=(
  'static/index.html'
  'static/login.html'
  'static/js/app.js'
  'static/version.json'
  'static/js/data/generated/canon-runtime-data.js'
  'static/img/logo.png'
  'static/img/bg-home-pc.png'
  'static/img/login-bg.png'
  'static/assets/map.jpg'
  'backend/server/index.js'
  'backend/package.json'
  'backend/package-lock.json'
  'backend/js/core/timeline-save-schema.js'
  'backend/js/core/shinobi-daily.js'
  'backend/js/core/narrative-artifact.js'
  'backend/js/core/image-studio/contracts.js'
  'backend/js/core/continuity-ledger.js'
  'backend/js/utils/format.js'
  'ops/systemd/naruto-rpg.service.d/limits.conf'
  'ops/sysctl/90-naruto-rpg-memory.conf'
)
if [[ "$MODE" == staging ]]; then
  REQUIRED_FILES+=('ops/nginx/naruto-rpg-staging.conf')
fi
for required_file in "${REQUIRED_FILES[@]}"; do
  [[ -s "$PAYLOAD_DIR/$required_file" ]] || fail "部署包缺少文件：$required_file"
done

for shared_module in "${SHARED_MODULES[@]}"; do
  [[ -s "$PAYLOAD_DIR/backend/$shared_module" ]] || fail "后端共享模块缺失：$shared_module"
done

forbidden_file="$(find "$PAYLOAD_DIR" -type f \( \
  -name '.env' -o -name '*.db' -o -name '*.db-journal' -o -name '*.db-wal' -o -name '*.tmp' \
\) -print -quit)"
[[ -z "$forbidden_file" ]] || fail "部署包混入运行数据：$forbidden_file"
[[ ! -e "$BACKEND_PAYLOAD/server/data" ]] || fail "部署包混入 server/data"
[[ ! -e "$BACKEND_PAYLOAD/server/db/saves" ]] || fail "部署包混入 server/db/saves"

tar -czf "$ARCHIVE" -C "$PAYLOAD_DIR" .
tar -tzf "$ARCHIVE" >/dev/null
ARCHIVE_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
PACKAGE_MB="$(du -m "$ARCHIVE" | awk '{print $1}')"
ok "部署包校验通过（${PACKAGE_MB} MiB，SHA-256 $ARCHIVE_SHA256）"

if [[ "$DRY_RUN" == true ]]; then
  printf 'PACKAGE_ASSETS_OK=true\n'
  printf 'RUNTIME_DATA_EXCLUDED=true\n'
  printf 'DRY_RUN_OK=%s\n' "$MODE"
  printf 'RELEASE_VERSION=%s\n' "$RELEASE_VERSION"
  printf 'BUILD_VERSION=%s\n' "$BUILD_ID"
  exit 0
fi

[[ -n "$DEPLOY_SERVER" ]] || fail "缺少部署服务器：请配置 NARUTO_DEPLOY_SERVER"
[[ "$DEPLOY_SERVER" != -* && ! "$DEPLOY_SERVER" =~ [[:space:]] ]] || fail "部署服务器格式不安全"
[[ -f "$DEPLOY_SSH_KEY" ]] || fail "SSH 密钥不存在：$DEPLOY_SSH_KEY"
command -v ssh >/dev/null 2>&1 || fail "缺少 ssh"
command -v scp >/dev/null 2>&1 || fail "缺少 scp"

SSH_OPTIONS=(
  -i "$DEPLOY_SSH_KEY"
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=15
  -o ConnectionAttempts=3
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
  -o TCPKeepAlive=yes
  -o IPQoS=none
)

REMOTE_ARCHIVE="/tmp/naruto-rpg-${MODE}-${DEPLOYMENT_ID}.tar.gz"
REMOTE_ARCHIVE_PART="${REMOTE_ARCHIVE}.part"
REMOTE_RELEASE="/tmp/naruto-rpg-release-${MODE}-${DEPLOYMENT_ID}"

log "STEP 4/6：上传部署包"
upload_archive "$REMOTE_ARCHIVE_PART" || fail "上传部署包失败"

# 避免上传连接刚释放时触发远端 sshd 的连接节流。
sleep 12

log "STEP 5/6：部署并执行服务器内验证"
REMOTE_STEPS=(
  'set -eu'
  "if test -f '$REMOTE_ARCHIVE_PART'; then printf '%s  %s\\n' '$ARCHIVE_SHA256' '$REMOTE_ARCHIVE_PART' | sha256sum -c -; mv -f '$REMOTE_ARCHIVE_PART' '$REMOTE_ARCHIVE'; else test -f '$REMOTE_ARCHIVE'; printf '%s  %s\\n' '$ARCHIVE_SHA256' '$REMOTE_ARCHIVE' | sha256sum -c -; fi"
  "rm -rf '$REMOTE_RELEASE'"
  "mkdir -p '$REMOTE_RELEASE' '$TARGET_DIR'"
  "tar xzf '$REMOTE_ARCHIVE' -C '$REMOTE_RELEASE'"
  "test -s '$REMOTE_RELEASE/static/index.html'"
  "test -s '$REMOTE_RELEASE/backend/server/index.js'"
)

for shared_module in "${SHARED_MODULES[@]}"; do
  REMOTE_STEPS+=("test -s '$REMOTE_RELEASE/backend/$shared_module'")
done

if [[ "$MODE" == production ]]; then
  REMOTE_STEPS+=(
    "BACKUP_DIR='${TARGET_DIR}.bak.${DEPLOYMENT_ID}'; if test -d '$TARGET_DIR' && test ! -e \"\$BACKUP_DIR\"; then cp -a '$TARGET_DIR' \"\$BACKUP_DIR\"; printf 'BACKUP_DIR=%s\\n' \"\$BACKUP_DIR\"; fi"
  )
fi

REMOTE_STEPS+=(
  "cp -a '$REMOTE_RELEASE/static/.' '$TARGET_DIR/'"
  "rm -rf '$TARGET_DIR/server' '$TARGET_DIR/public'"
  "rm -f '$TARGET_DIR/.env' '$TARGET_DIR/.env.example' '$TARGET_DIR/package.json' '$TARGET_DIR/package-lock.json'"
  "test ! -e '$TARGET_DIR/server'"
  "chown -R www-data:www-data '$TARGET_DIR'"
)

if [[ "$MODE" == staging ]]; then
  STAGING_NGINX_CONFIG='/etc/nginx/sites-enabled/naruto-rpg-staging'
  STAGING_NGINX_PAYLOAD="$REMOTE_RELEASE/ops/nginx/naruto-rpg-staging.conf"
  STAGING_NGINX_BACKUP="$REMOTE_RELEASE/naruto-rpg-staging.conf.before"
  REMOTE_STEPS+=(
    "test -s '$STAGING_NGINX_PAYLOAD'"
    "if ! cmp -s '$STAGING_NGINX_PAYLOAD' '$STAGING_NGINX_CONFIG'; then if test -f '$STAGING_NGINX_CONFIG'; then cp '$STAGING_NGINX_CONFIG' '$STAGING_NGINX_BACKUP'; fi; install -m 0644 '$STAGING_NGINX_PAYLOAD' '$STAGING_NGINX_CONFIG'; if ! nginx -t || ! systemctl reload nginx; then if test -f '$STAGING_NGINX_BACKUP'; then install -m 0644 '$STAGING_NGINX_BACKUP' '$STAGING_NGINX_CONFIG'; else rm -f '$STAGING_NGINX_CONFIG'; fi; nginx -t; systemctl reload nginx; exit 1; fi; else nginx -t; fi"
    "nginx -T 2>&1 | grep -Fq 'auth_request /_staging_auth;'"
  )
else
  REMOTE_STEPS+=("nginx -t")
fi

REMOTE_STEPS+=(
  "mkdir -p '$BACKEND_DIR/server' '$BACKEND_DIR/js'"
  "cp -a '$REMOTE_RELEASE/backend/server/.' '$BACKEND_DIR/server/'"
  "cp -a '$REMOTE_RELEASE/backend/js/.' '$BACKEND_DIR/js/'"
  "cp '$REMOTE_RELEASE/backend/package.json' '$REMOTE_RELEASE/backend/package-lock.json' '$BACKEND_DIR/'"
  "cd '$BACKEND_DIR' && npm install --omit=dev --silent"
  "chmod 600 '$BACKEND_DIR/.env' 2>/dev/null || true"
  "chown -R www-data:www-data '$BACKEND_DIR'"
  "install -D -m 0644 '$REMOTE_RELEASE/ops/systemd/naruto-rpg.service.d/limits.conf' '/etc/systemd/system/naruto-rpg.service.d/limits.conf'"
  "install -m 0644 '$REMOTE_RELEASE/ops/sysctl/90-naruto-rpg-memory.conf' '/etc/sysctl.d/90-naruto-rpg-memory.conf'"
  'systemctl daemon-reload'
  'sysctl -p /etc/sysctl.d/90-naruto-rpg-memory.conf'
  'systemctl restart naruto-rpg'
  'systemctl is-active --quiet naruto-rpg'
  "systemctl show naruto-rpg --property=MemoryHigh --value | grep -Fxq '268435456'"
  "systemctl show naruto-rpg --property=MemoryMax --value | grep -Fxq '402653184'"
  "systemctl show naruto-rpg --property=MemorySwapMax --value | grep -Fxq '134217728'"
  "sysctl -n vm.swappiness | grep -Fxq '10'"
  'ready=; for attempt in $(seq 1 30); do if curl --fail --silent --output /dev/null --max-time 2 http://127.0.0.1:3000/health/ready; then ready=1; break; fi; sleep 1; done; test "$ready" = 1'
  "grep -Fq '?v=$BUILD_ID' '$TARGET_DIR/index.html'"
  "grep -Fq '?v=$BUILD_ID' '$TARGET_DIR/login.html'"
  "grep -Fq '$RELEASE_VERSION' '$TARGET_DIR/version.json'"
  "curl --fail --silent --show-error --max-time 30 --resolve '$VERIFY_RESOLVE' '$VERIFY_URL' | grep -Fq '?v=$BUILD_ID'"
)

if [[ "$MODE" == staging ]]; then
  STAGING_HEADERS="$REMOTE_RELEASE/staging-root.headers"
  REMOTE_STEPS+=(
    "curl --fail --silent --show-error --output /dev/null --dump-header '$STAGING_HEADERS' --max-time 30 --resolve '$VERIFY_RESOLVE' '$PUBLIC_URL'"
    "tr -d '\\r' < '$STAGING_HEADERS' | grep -Eq '^HTTP/[^ ]+ 302([[:space:]]|$)'"
    "tr -d '\\r' < '$STAGING_HEADERS' | grep -Fxi 'location: $VERIFY_URL'"
    "tr -d '\\r' < '$STAGING_HEADERS' | grep -Fxi 'x-staging: true'"
  )
fi

REMOTE_DEPLOY_COMMAND="$(printf '%s; ' "${REMOTE_STEPS[@]}")"
REMOTE_DEPLOY_COMMAND="${REMOTE_DEPLOY_COMMAND%; }"
retry_remote "执行远端部署" 6 10 \
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_SERVER" "$REMOTE_DEPLOY_COMMAND" \
  || fail "远端部署或验证失败"

log "STEP 6/6：清理远端临时包"
sleep 12
if ! retry_remote "清理远端临时文件" 3 10 \
  ssh "${SSH_OPTIONS[@]}" "$DEPLOY_SERVER" \
    "rm -rf '$REMOTE_RELEASE' '$REMOTE_ARCHIVE' '$REMOTE_ARCHIVE_PART'"; then
  warn "远端临时文件清理失败，不影响已完成部署"
fi

printf '\nDEPLOY_OK=%s\n' "$PUBLIC_URL"
printf 'DEPLOY_ENVIRONMENT=%s\n' "$MODE"
printf 'RELEASE_VERSION=%s\n' "$RELEASE_VERSION"
printf 'BUILD_VERSION=%s\n' "$BUILD_ID"
printf 'VERIFY_URL=%s\n' "$VERIFY_URL"
