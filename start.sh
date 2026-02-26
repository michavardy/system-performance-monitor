#!/usr/bin/env bash

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$SCRIPT_DIR"

FRONTEND_DIR="$SCRIPT_DIR/frontend"
BACKEND_DIR="$SCRIPT_DIR/backend"
NODE_MODULES_DIR="$FRONTEND_DIR/node_modules"

if [ ! -d "$NODE_MODULES_DIR" ]; then
  echo "Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  npm install
else
  cd "$FRONTEND_DIR"
fi

echo "Building frontend assets..."
npm run build

cd "$BACKEND_DIR"
echo "Starting backend on http://0.0.0.0:7000"
uvicorn main:app --host 0.0.0.0 --port 7000
