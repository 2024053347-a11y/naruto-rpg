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
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
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
node scripts/generate-version.mjs --out "$PROJECT_DIR/public/version.json" || fail "版本信息生成失败"
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
)

# 上传
REMOTE_ARCHIVE="/tmp/naruto-rpg-production-${DEPLOYMENT_ID}.tar.gz"
log "上传部署包到 $DEPLOY_SERVER..."
scp "${SSH_OPTS[@]}" "$ARCHIVE" "${DEPLOY_SERVER}:${REMOTE_ARCHIVE}.part" || fail "上传失败"

# 校验远端文件
log "校验远端部署包..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" \
  "set -eu; printf '%s  %s\n' '$ARCHIVE_SHA256' '${REMOTE_ARCHIVE}.part' | sha256sum -c - && mv -f '${REMOTE_ARCHIVE}.part' '$REMOTE_ARCHIVE'" \
  || fail "远端校验失败"
ok "上传并校验完成"

# ══════════════════════════════════════════════════════════════════════════
# STEP 6: 远端部署
# ══════════════════════════════════════════════════════════════════════════
log "STEP 6/6: 远端部署..."

REMOTE_WORK="/tmp/naruto-rpg-release-${DEPLOYMENT_ID}"

REMOTE_SCRIPTS=(
  "set -eu"

  # 解压
  "rm -rf '$REMOTE_WORK'"
  "mkdir -p '$REMOTE_WORK' '$TARGET_DIR'"
  "tar xzf '$REMOTE_ARCHIVE' -C '$REMOTE_WORK'"
  "test -s '$REMOTE_WORK/static/index.html'"

  # 备份旧版本
  "if [ -d '$TARGET_DIR' ]; then"
  "  BACKUP_DIR='${TARGET_DIR}.bak.$(date +%Y%m%d%H%M%S)'"
  "  cp -a '$TARGET_DIR' \"\$BACKUP_DIR\""
  "  echo \"旧版本已备份到 \$BACKUP_DIR\""
  "fi"

  # 上传静态资源
  "cp -a '$REMOTE_WORK/static/.' '$TARGET_DIR/'"

  # 清理旧后端目录
  "rm -rf '$TARGET_DIR/server' '$TARGET_DIR/public'"
  "rm -f '$TARGET_DIR/.env' '$TARGET_DIR/.env.example' '$TARGET_DIR/package.json' '$TARGET_DIR/package-lock.json'"

  # 更新后端
  "mkdir -p '$BACKEND_DIR/server'"
  "cp -a '$REMOTE_WORK/backend/server/.' '$BACKEND_DIR/server/'"
  "cp '$REMOTE_WORK/backend/package.json' '$REMOTE_WORK/backend/package-lock.json' '$BACKEND_DIR/'"

  # 安装依赖
  "cd '$BACKEND_DIR' && npm install --omit=dev --silent"

  # 权限
  "chmod 600 '$BACKEND_DIR/.env' 2>/dev/null || true"
  "chown -R www-data:www-data '$TARGET_DIR'"
  "chown -R www-data:www-data '$BACKEND_DIR'"

  # Nginx 检查
  "nginx -t"

  # 重启服务
  "systemctl restart naruto-rpg"
  "systemctl is-active --quiet naruto-rpg"

  # 清理缓存
  "rm -rf '$TARGET_DIR/sw.js.cache' 2>/dev/null || true"

  # 验证
  "grep -Fq '?v=$BUILD_ID' '$TARGET_DIR/index.html'"
  "grep -Fq '?v=$BUILD_ID' '$TARGET_DIR/login.html'"
  "grep -Fq '\"version\":\"$RELEASE_VERSION\"' '$TARGET_DIR/version.json'"

  # 清理远端临时文件
  "rm -rf '$REMOTE_WORK' '$REMOTE_ARCHIVE'"
)

log "执行远端部署..."
ssh "${SSH_OPTS[@]}" "$DEPLOY_SERVER" "$(printf '%s\n' "${REMOTE_SCRIPTS[@]}")" \
  || fail "远端部署失败"

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
