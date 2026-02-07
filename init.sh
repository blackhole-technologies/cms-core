#!/bin/bash
# CMS-Core Development Environment Setup
# Zero-dependency Node.js CMS with Drupal-inspired architecture
#
# Usage: ./init.sh
# This script starts the CMS-Core server on port 3001

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check Node.js version (requires 20+)
NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ]; then
    echo "ERROR: Node.js not found. Please install Node.js 20+"
    exit 1
fi

if [ "$NODE_VERSION" -lt 20 ]; then
    echo "ERROR: Node.js 20+ required. Found: v$(node -v)"
    exit 1
fi

echo "=== CMS-Core Development Server ==="
echo "Node.js: $(node -v)"
echo "Project: $SCRIPT_DIR"
echo ""

# Kill any existing server on port 3001
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
sleep 1

# No npm install needed - zero dependencies by design
echo "Starting CMS-Core server..."
echo "  URL: http://localhost:3001"
echo "  API: http://localhost:3001/api"
echo "  CLI: node index.js help"
echo ""

# Start server in background
node index.js &
SERVER_PID=$!

# Wait for server to be ready
echo "Waiting for server to start..."
for i in $(seq 1 30); do
    if curl -s http://localhost:3001 > /dev/null 2>&1; then
        echo "Server started successfully (PID: $SERVER_PID)"
        echo ""
        echo "=== Quick Commands ==="
        echo "  node index.js help              # List all CLI commands"
        echo "  node index.js modules:list       # Show enabled modules"
        echo "  node index.js content:list       # List content"
        echo "  curl http://localhost:3001/api   # API root"
        echo ""
        exit 0
    fi
    sleep 1
done

echo "WARNING: Server may not have started correctly. Check logs."
echo "PID: $SERVER_PID"
