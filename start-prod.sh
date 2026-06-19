#!/bin/bash
# Image-MetaHub 生产模式启动脚本
# 先 build 项目，然后用 Electron 加载 dist 目录
# 使用：在项目根目录运行 bash start-prod.sh

set -e

export IMH_LICENSE_SECRET="test-secret-for-build"

echo "=== Image-MetaHub 生产模式启动 ==="
echo "1. 构建项目..."
npm run build

echo "2. 启动 Electron (加载 dist)..."
npx electron .

echo "=== 启动完成 ==="