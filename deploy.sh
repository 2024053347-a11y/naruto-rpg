#!/bin/bash
# ==============================================
#  忍者手记 - 一键上线部署脚本
#  用法:
#    bash deploy.sh           → 默认部署到测试站
#    bash deploy.sh staging    → 部署到测试站 test.qiwu.asia
#    bash deploy.sh production → 部署到正式站 www.qiwu.asia
# ==============================================
set -e

MODE="${1:-staging}"  # 默认测试站
SERVER="root@8.162.24.147"
SSH_KEY="$HOME/.ssh/id_ed25519"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAR_FILE="/tmp/naruto-rpg-deploy.tar.gz"
VER=$(date "+%y%m%d%H%M")

case "$MODE" in
  staging|test|dev)
    TARGET_DIR="/var/www/naruto-rpg-staging"
    DOMAIN="www.qiwu.asia:8080"
    RESTART_BACKEND=false
    echo "  目标: 🧪 测试站 $DOMAIN"
    ;;
  production|prod|live)
    TARGET_DIR="/var/www/naruto-rpg"
    DOMAIN="www.qiwu.asia"
    RESTART_BACKEND=true
    echo "  目标: 🚀 正式站 $DOMAIN"
    ;;
  *)
    echo "用法: bash deploy.sh [staging|production]"
    exit 1
    ;;
esac

echo "  版本: $VER"
echo "========================================"

cd "$PROJECT_DIR"

# 0. 更新缓存版本号
echo "[0/5] 更新版本号..."
for f in index.html public/index.html public/login.html; do
  [ -f "$f" ] && sed -i "s/?v=[0-9]*/?v=$VER/g" "$f"
done
echo "  ✓ → $VER"

# 1. 打包
echo "[1/5] 打包..."
tar czf "$TAR_FILE" \
  --exclude='node_modules' --exclude='.git' --exclude='.env' \
  --exclude='*.png' --exclude='*.jpg' \
  --exclude='server/db/*.db*' \
  --exclude='.playwright-mcp' --exclude='.claude' \
  --exclude='dist' --exclude='archive-scripts' \
  --exclude='test*' --exclude='temp*' --exclude='fix*' \
  --exclude='find*' --exclude='patch*' --exclude='search*' \
  --exclude='discord-proxy-worker.js' \
  --exclude='*.bat' --exclude='deploy.sh' \
  index.html manifest.json sw.js css/ js/ server/ public/ \
  package.json package-lock.json .env.example \
  2>/dev/null

echo "  ✓ $(du -h "$TAR_FILE" | cut -f1)"

# 2. 上传
echo "[2/5] 上传..."
scp $SSH_OPTS "$TAR_FILE" "$SERVER:/tmp/" || { echo "  ✗ 上传失败"; exit 1; }
echo "  ✓ 完成"

# 3. 部署到目标目录
echo "[3/5] 部署到 $MODE..."
ssh $SSH_OPTS "$SERVER" << ENDSSH
set -e
mkdir -p $TARGET_DIR
cd $TARGET_DIR
tar xzf /tmp/naruto-rpg-deploy.tar.gz 2>/dev/null
# 将 public/ 内容提升到根目录（nginx root 指向这里）
cp -r public/* . 2>/dev/null || true
chown -R www-data:www-data $TARGET_DIR/

# 生产环境同时更新后端
if [ "$RESTART_BACKEND" = "true" ]; then
  cd /opt/naruto-rpg
  tar xzf /tmp/naruto-rpg-deploy.tar.gz server/ 2>/dev/null || true
  npm install --omit=dev --silent 2>&1 | tail -1
  chmod 600 .env 2>/dev/null || true
  chown -R www-data:www-data . 2>/dev/null || true
fi

rm -f /tmp/naruto-rpg-deploy.tar.gz
echo "  ✓ 部署完成"
ENDSSH

# 4. 重启（仅生产）
echo "[4/5] 重启服务..."
if [ "$RESTART_BACKEND" = "true" ]; then
  ssh $SSH_OPTS "$SERVER" 'systemctl restart naruto-rpg && sleep 2 && systemctl reload nginx'
  echo "  ✓ 后端已重启"
else
  ssh $SSH_OPTS "$SERVER" 'systemctl reload nginx'
  echo "  ✓ Nginx 已重载（无需重启后端）"
fi

# 5. 验证
echo "[5/5] 验证..."
ssh $SSH_OPTS "$SERVER" "
echo '--- 后端 ---'
systemctl status naruto-rpg --no-pager -l | head -3
echo '--- 测试 ---'
curl -skI -H 'Host: $DOMAIN' https://localhost/ 2>&1 | head -2
"

echo ""
echo "========================================"
echo "  ✅ v$VER 部署完成"
echo "  https://$DOMAIN/"
echo "========================================"
