#!/usr/bin/env bash
# ============================================================================
# deploy-v3.sh — 忍者手记 v3 正式站部署脚本
# ============================================================================
# 用法:
#   bash deploy-v3.sh              # 完整部署 (构建 + 上传 + 重启)
#   bash deploy-v3.sh --dry-run    # 仅构建,不连接服务器
#   bash deploy-v3.sh --skip-build # 跳过构建,仅上传
# ============================================================================

set -euo pipefail

# ── 配置 ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
PACKAGE_JSON="$PROJECT_DIR/package.json"

# 从 package.json 读取版本号
RELEASE_VERSION="$(node -e "console.log(require('$PACKAGE_JSON').version)")"
BUILD_ID="$(date -u +%y%m%d%H%M)"
DEPLOYMENT_ID="v${RELEASE_VERSION}-${BUILD_ID}-$$"

# 临时目录
WORK_DIR="/tmp/naruto-rpg-deploy-${DEPLOYMENT_ID}"
PAYLOAD_DIR="$WORK_DIR/payload"
STATIC_DIR="$PAYLOAD_DIR/static"
ARCHIVE="/tmp/naruto-rpg-production-${DEPLOYMENT_ID}.tar.gz"

# 远端配置 (从 deploy.local.env 或环境变量读取)
DEPLOY_SERVER="${NARUTO_DEPLOY_SERVER:-}"
DEPLOY_SSH_KEY="${NARUTO_DEPLOY_SSH_KEY:-$HOME/.ssh/id_ed25519}"
TARGET_DIR="/var/www/naruto-rpg"
BACKEND_DIR="/opt/naruto-rpg"
PUBLIC_URL="https://www.qiwu.asia/"

# 排除项
EXCLUDE_PATTERNS=(
  ".env"
  "*.db"
  "server/db/*.db"
  "server/db/*.db-journal"
  "server/db/*.db-wal"
  "server/data/"
  "save/"
  "logs/"
  "node_modules/"
  ".git/"
  "canon-rebuild-output/"
  "dist/"
  "test_screenshots/"
)

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${CYAN}[DEPLOY]${NC} $*"; }
ok()    { echo -e "${GREEN}[  OK ]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; exit 1; }

retry_remote() {
  local label="$1"
  local attempts="$2"
  local initial_delay="$3"
  shift 3
  local attempt status=1 delay
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    log "$label (尝试 $attempt/$attempts)..."
    if "$@"; then
      return 0
    else
      status=$?
    fi
    if (( attempt < attempts )); then
      delay=$((initial_delay * attempt))
      if (( delay > 30 )); then
        delay=30
      fi
      warn "$label 失败 (exit $status)，${delay} 秒后重试"
      sleep "$delay"
    fi
  done
  return "$status"
}

# ── 参数解析 ──────────────────────────────────────────────────────────────
DRY_RUN=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=true ;;
    --skip-build) SKIP_BUILD=true ;;
    --help|-h)
      echo "用法: bash deploy-v3.sh [--dry-run] [--skip-build]"
      exit 0
      ;;
  esac
done

# ── 清理函数 ──────────────────────────────────────────────────────────────
cleanup() {
  log "清理临时文件..."
  rm -rf "$WORK_DIR" "$ARCHIVE" 2>/dev/null || true
}
trap cleanup EXIT

# ── 开始 ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "忍者手记 v3 部署器"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "版本:      v$RELEASE_VERSION"
log "构建ID:    $BUILD_ID"
log "目标:      $PUBLIC_URL"
if $DRY_RUN; then
  warn "模式: DryRun (不会连接服务器)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ══════════════════════════════════════════════════════════════════════════
# STEP 1: 构建
# ══════════════════════════════════════════════════════════════════════════
if ! $SKIP_BUILD; then
  log "STEP 1/6: 构建项目..."

  cd "$PROJECT_DIR"

  # npm test (可选,取消注释以启用)
  # log "运行测试..."
  # npm test || fail "测试未通过,部署中止"

  log "执行 npm run build..."
  npm run build || fail "构建失败"
  ok "构建完成"

  # 同步 public 目录
  log "同步 public/ 目录..."
  npm run sync-public || fail "public 同步失败"
  ok "public/ 同步完成"
else
  log "STEP 1/6: 跳过构建 (--skip-build)"
fi

# ══════════════════════════════════════════════════════════════════════════
# STEP 2: 生成版本信息
# ══════════════════════════════════════════════════════════════════════════
log "STEP 2/6: 生成版本信息..."

cd "$PROJECT_DIR"
node scripts/generate-version.mjs \
  --out "$PROJECT_DIR/public/version.json" \
  --build "$BUILD_ID" \
  --environment production \
  || fail "版本信息生成失败"
ok "version.json 已生成"
cat "$PROJECT_DIR/public/version.json"

# ══════════════════════════════════════════════════════════════════════════
# STEP 3: 组装部署包
# ══════════════════════════════════════════════════════════════════════════
log "STEP 3/6: 组装部署包..."

mkdir -p "$STATIC_DIR"

# 复制静态资源
rsync -a --delete \
  --exclude='.env' \
  --exclude='*.db' \
  --exclude='server/db/' \
  --exclude='server/data/' \
  --exclude='save/' \
  --exclude='logs/' \
  --exclude='node_modules/' \
  "$PROJECT_DIR/public/" "$STATIC_DIR/"

# 更新 HTML 缓存版本号
for html_file in "$STATIC_DIR/index.html" "$STATIC_DIR/login.html"; do
  if [[ -f "$html_file" ]]; then
    sed -i "s/?v=[0-9]*/?v=$BUILD_ID/g" "$html_file"
    ok "缓存版本已更新: $(basename "$html_file")"
  fi
done

# 复制后端源码
BACKEND_PAYLOAD="$PAYLOAD_DIR/backend"
mkdir -p "$BACKEND_PAYLOAD"

# 复制 server/ (排除运行数据)
rsync -a \
  --exclude='data/' \
  --exclude='db/*.db' \
  --exclude='db/*.db-journal' \
  --exclude='db/*.db-wal' \
  --exclude='db/*.tmp' \
  "$PROJECT_DIR/server/" "$BACKEND_PAYLOAD/server/"

cp "$PROJECT_DIR/package.json" "$BACKEND_PAYLOAD/"
cp "$PROJECT_DIR/package-lock.json" "$BACKEND_PAYLOAD/"

# 云存档 API 复用浏览器侧的时间线校验器，保持与服务端相同的相对导入路径。
mkdir -p "$BACKEND_PAYLOAD/js/core/image-studio" "$BACKEND_PAYLOAD/js/utils"
cp "$PROJECT_DIR/js/core/timeline-save-schema.js" "$BACKEND_PAYLOAD/js/core/"
cp "$PROJECT_DIR/js/core/shinobi-daily.js" "$BACKEND_PAYLOAD/js/core/"
cp "$PROJECT_DIR/js/core/narrative-artifact.js" "$BACKEND_PAYLOAD/js/core/"
cp "$PROJECT_DIR/js/core/image-studio/contracts.js" "$BACKEND_PAYLOAD/js/core/image-studio/"
cp "$PROJECT_DIR/js/core/continuity-ledger.js" "$BACKEND_PAYLOAD/js/core/"
cp "$PROJECT_DIR/js/utils/format.js" "$BACKEND_PAYLOAD/js/utils/"

# 正式站资源边界与主机内存策略。
mkdir -p "$PAYLOAD_DIR/ops/systemd/naruto-rpg.service.d" "$PAYLOAD_DIR/ops/sysctl"
cp "$PROJECT_DIR/deploy/systemd/naruto-rpg.service.d/limits.conf" \
  "$PAYLOAD_DIR/ops/systemd/naruto-rpg.service.d/"
cp "$PROJECT_DIR/deploy/sysctl/90-naruto-rpg-memory.conf" "$PAYLOAD_DIR/ops/sysctl/"

ok "部署包组装完成"

# ══════════════════════════════════════════════════════════════════════════
# STEP 4: 检查部署包内容
# ══════════════════════════════════════════════════════════════════════════
log "STEP 4/6: 检查部署包内容..."

REQUIRED_FILES=(
  "static/index.html"
  "static/login.html"
  "static/js/app.js"
  "static/version.json"
  "static/js/data/generated/canon-runtime-data.js"
  "static/img/logo.png"
  "backend/server/index.js"
  "backend/package.json"
  "backend/package-lock.json"
  "backend/js/core/timeline-save-schema.js"
  "backend/js/core/shinobi-daily.js"
  "backend/js/core/narrative-artifact.js"
  "backend/js/core/image-studio/contracts.js"
  "backend/js/core/continuity-ledger.js"
  "backend/js/utils/format.js"
  "ops/systemd/naruto-rpg.service.d/limits.conf"
  "ops/sysctl/90-naruto-rpg-memory.conf"
)

for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$PAYLOAD_DIR/$f" ]]; then
    fail "部署包缺少文件: $f"
  fi
done

# 检查禁止项
if find "$PAYLOAD_DIR" -name ".env" -o -name "*.db" | grep -q .; then
  fail "部署包包含禁止文件 (.env 或 *.db)"
fi

ARCHIVE_SIZE=$(du -sh "$PAYLOAD_DIR" | cut -f1)
ok "部署包检查通过 (大小: $ARCHIVE_SIZE)"

# ══════════════════════════════════════════════════════════════════════════
# STEP 5: 上传到远端
# ══════════════════════════════════════════════════════════════════════════
if $DRY_RUN; then
  log "STEP 5/6: 跳过上传 (DryRun)"
  log "部署包位置: $PAYLOAD_DIR"
  echo ""
  ok "DryRun 完成"
  exit 0
fi

if [[ -z "$DEPLOY_SERVER" ]]; then
  fail "缺少部署服务器: 请设置 NARUTO_DEPLOY_SERVER 环境变量"
fi

if [[ ! -f "$DEPLOY_SSH_KEY" ]]; then
  fail "SSH 密钥不存在: $DEPLOY_SSH_KEY"
fi

log "STEP 5/6: 上传到远端..."

# 创建压缩包
tar czf "$ARCHIVE" -C "$PAYLOAD_DIR" .
ARCHIVE_SHA256=$(sha256sum "$ARCHIVE" | cut -d' ' -f1)
ok "部署包已创建 (SHA256: $ARCHIVE_SHA256)"

# SSH 选项
SSH_OPTS=(
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

# 上传
REMOTE_ARCHIVE="/tmp/naruto-rpg-production-${DEPLOYMENT_ID}.tar.gz"
log "上传部署包到 $DEPLOY_SERVER..."
retry_remote "上传部署包" 6 10 \
  scp "${SSH_OPTS[@]}" "$ARCHIVE" "${DEPLOY_SERVER}:${REMOTE_ARCHIVE}.part" \
  || fail "上传失败"

# 避免上传连接结束后立刻再次触发 sshd 的连接限流。
sleep 12

# ══════════════════════════════════════════════════════════════════════════
# STEP 6: 远端部署
# ══════════════════════════════════════════════════════════════════════════
log "STEP 6/6: 远端部署..."

REMOTE_WORK="/tmp/naruto-rpg-release-${DEPLOYMENT_ID}"

REMOTE_SCRIPTS=(
  "set -eu"
  "if [ -f '${REMOTE_ARCHIVE}.part' ]; then printf '%s  %s\n' '$ARCHIVE_SHA256' '${REMOTE_ARCHIVE}.part' | sha256sum -c - && mv -f '${REMOTE_ARCHIVE}.part' '$REMOTE_ARCHIVE'; else test -f '$REMOTE_ARCHIVE'; printf '%s  %s\n' '$ARCHIVE_SHA256' '$REMOTE_ARCHIVE' | sha256sum -c -; fi"

  # 解压
  "rm -rf '$REMOTE_WORK'"
  "mkdir -p '$REMOTE_WORK' '$TARGET_DIR'"
  "tar xzf '$REMOTE_ARCHIVE' -C '$REMOTE_WORK'"
  "test -s '$REMOTE_WORK/static/index.html'"
  "test -s '$REMOTE_WORK/backend/js/core/timeline-save-schema.js'"
  "test -s '$REMOTE_WORK/backend/js/core/shinobi-daily.js'"
  "test -s '$REMOTE_WORK/backend/js/core/narrative-artifact.js'"
  "test -s '$REMOTE_WORK/backend/js/core/image-studio/contracts.js'"
  "test -s '$REMOTE_WORK/backend/js/core/continuity-ledger.js'"
  "test -s '$REMOTE_WORK/backend/js/utils/format.js'"

  # 备份旧版本
  "BACKUP_DIR='${TARGET_DIR}.bak.${DEPLOYMENT_ID}'"
  "if [ -d '$TARGET_DIR' ] && [ ! -e \"\$BACKUP_DIR\" ]; then"
  "  cp -a '$TARGET_DIR' \"\$BACKUP_DIR\""
  "  echo \"旧版本已备份到 \$BACKUP_DIR\""
  "fi"

  # 上传静态资源
  "cp -a '$REMOTE_WORK/static/.' '$TARGET_DIR/'"

  # 清理旧后端目录
  "rm -rf '$TARGET_DIR/server' '$TARGET_DIR/public'"
  "rm -f '$TARGET_DIR/.env' '$TARGET_DIR/.env.example' '$TARGET_DIR/package.json' '$TARGET_DIR/package-lock.json'"

  # 更新后端
  "mkdir -p '$BACKEND_DIR/server' '$BACKEND_DIR/js'"
  "cp -a '$REMOTE_WORK/backend/server/.' '$BACKEND_DIR/server/'"
  "cp -a '$REMOTE_WORK/backend/js/.' '$BACKEND_DIR/js/'"
  "cp '$REMOTE_WORK/backend/package.json' '$REMOTE_WORK/backend/package-lock.json' '$BACKEND_DIR/'"

  # 安装依赖
  "cd '$BACKEND_DIR' && npm install --omit=dev --silent"

  # 权限
  "chmod 600 '$BACKEND_DIR/.env' 2>/dev/null || true"
  "chown -R www-data:www-data '$TARGET_DIR'"
  "chown -R www-data:www-data '$BACKEND_DIR'"

  # Nginx 检查
  "nginx -t"

  # 应用资源边界与主机内存策略后重启服务
  "install -D -m 0644 '$REMOTE_WORK/ops/systemd/naruto-rpg.service.d/limits.conf' '/etc/systemd/system/naruto-rpg.service.d/limits.conf'"
  "install -m 0644 '$REMOTE_WORK/ops/sysctl/90-naruto-rpg-memory.conf' '/etc/sysctl.d/90-naruto-rpg-memory.conf'"
  "systemctl daemon-reload"
  "sysctl -p /etc/sysctl.d/90-naruto-rpg-memory.conf"
  "systemctl restart naruto-rpg"
  "systemctl is-active --quiet naruto-rpg"
  "systemctl show naruto-rpg --property=MemoryHigh --value | grep -Fxq '268435456'"
  "systemctl show naruto-rpg --property=MemoryMax --value | grep -Fxq '402653184'"
  "systemctl show naruto-rpg --property=MemorySwapMax --value | grep -Fxq '134217728'"
  "sysctl -n vm.swappiness | grep -Fxq '10'"
  "ready=; for attempt in \$(seq 1 30); do if curl --fail --silent --output /dev/null --max-time 2 http://127.0.0.1:3000/health/ready; then ready=1; break; fi; sleep 1; done; test \"\$ready\" = 1"

  # 清理缓存
  "rm -rf '$TARGET_DIR/sw.js.cache' 2>/dev/null || true"

  # 验证
  "grep -Fq '?v=$BUILD_ID' '$TARGET_DIR/index.html'"
  "grep -Fq '?v=$BUILD_ID' '$TARGET_DIR/login.html'"
  "grep -Fq '\"version\":\"$RELEASE_VERSION\"' '$TARGET_DIR/version.json'"

)

log "执行远端部署..."
REMOTE_DEPLOY_COMMAND="$(printf '%s\n' "${REMOTE_SCRIPTS[@]}")"
retry_remote "执行远端部署" 6 10 \
  ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "$REMOTE_DEPLOY_COMMAND" \
  || fail "远端部署失败"

sleep 12
if ! retry_remote "清理远端临时文件" 3 10 \
  ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "rm -rf '$REMOTE_WORK' '$REMOTE_ARCHIVE' '${REMOTE_ARCHIVE}.part'"; then
  warn "远端临时文件清理失败，不影响已完成部署"
fi

# 健康检查
log "执行健康检查..."
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 30 "$PUBLIC_URL" || echo "000")
if [[ "$HTTP_STATUS" == "200" ]]; then
  ok "健康检查通过 (HTTP $HTTP_STATUS)"
else
  warn "健康检查返回 HTTP $HTTP_STATUS (可能需要等待缓存刷新)"
fi

# ══════════════════════════════════════════════════════════════════════════
# 完成
# ══════════════════════════════════════════════════════════════════════════
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "v$RELEASE_VERSION 部署完成!"
log "版本:   v$RELEASE_VERSION"
log "构建:   $BUILD_ID"
log "目标:   $PUBLIC_URL"
log "验证:   ${PUBLIC_URL}login.html?v=$BUILD_ID"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
