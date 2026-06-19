#!/bin/bash
# Image-MetaHub 开发模式启动脚本
# 启动 Vite dev server + Electron，支持代码热重载
# 使用：在项目根目录运行 bash start-dev.sh

set -e

export IMH_LICENSE_SECRET="test-secret-for-build"

echo "=== Image-MetaHub 开发模式启动 ==="
echo "1. 启动 Vite dev server..."
npm run dev &
VITE_PID=$!

echo "2. 等待 Vite 启动..."
sleep 5

echo "3. 启动 Electron..."
npx electron .

# 当 Electron 关闭时停止 Vite
kill $VITE_PID 2>/dev/null || true
echo "=== 启动完成 ==="