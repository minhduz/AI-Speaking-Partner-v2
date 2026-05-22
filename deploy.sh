#!/bin/bash
# =============================================================
# deploy.sh — Deploy AI Speaking Partner v2 lên DigitalOcean
# Chạy trên SERVER (sau khi SSH vào)
# Usage: bash deploy.sh
# =============================================================

set -e

REPO_DIR="/opt/AI-Speaking-Partner-v2"
COMPOSE_FILE="docker-compose.prod.yml"

echo "🚀 Bắt đầu deploy..."

# Pull code mới nhất
cd $REPO_DIR
git pull origin main

# Đọc biến môi trường từ .env.production nếu có
if [ -f ".env.production" ]; then
    export $(cat .env.production | grep -v '^#' | xargs)
fi

# Build và restart tất cả services
echo "🔨 Building Docker images..."
docker compose -f $COMPOSE_FILE build --no-cache

echo "🔄 Restarting services..."
docker compose -f $COMPOSE_FILE up -d

# Xóa images cũ không dùng
echo "🧹 Cleaning up old images..."
docker image prune -f

echo "✅ Deploy xong! Đang kiểm tra services..."
docker compose -f $COMPOSE_FILE ps

echo ""
echo "📋 Xem logs: docker compose -f $COMPOSE_FILE logs -f"
