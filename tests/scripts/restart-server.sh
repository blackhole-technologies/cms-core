#!/bin/bash
# Restart script for CMS Core server

echo "Stopping existing server..."
pkill node

echo "Waiting for server to stop..."
sleep 2

cd /Users/Alchemy/Projects/experiments/cms-core

echo "Starting server..."
node index.js &

echo "Waiting for server to start..."
sleep 3

echo "Checking server status..."
if lsof -ti:3000 > /dev/null 2>&1; then
  echo "✅ Server is running on port 3000"
  echo "Test the route at: http://localhost:3000/admin/config/ai"
else
  echo "❌ Server failed to start. Check logs."
fi
