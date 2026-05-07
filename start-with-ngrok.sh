#!/bin/bash

# Start backend with ngrok tunnel
# This script starts the backend server and creates an ngrok tunnel

echo "🚀 Starting Nexio Backend with ngrok..."

# Check if ngrok is installed
if ! command -v ngrok &> /dev/null; then
    echo "❌ ngrok is not installed"
    echo "Install it with: brew install ngrok"
    exit 1
fi

# Start ngrok in the background
echo "📡 Starting ngrok tunnel on port 3000..."
ngrok http 3000 > /dev/null &
NGROK_PID=$!

# Wait for ngrok to start
sleep 2

# Get the ngrok URL
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"https://[^"]*' | grep -o 'https://[^"]*' | head -1)

if [ -z "$NGROK_URL" ]; then
    echo "❌ Failed to get ngrok URL"
    kill $NGROK_PID
    exit 1
fi

echo "✅ ngrok tunnel created: $NGROK_URL"
echo "📝 Webhook URL: $NGROK_URL/api/v1/webhooks/helius"
echo ""
echo "⚠️  Update your client config to use: $NGROK_URL/api/v1"
echo ""

# Start the backend server
echo "🔧 Starting backend server..."
bun run dev

# Cleanup on exit
trap "kill $NGROK_PID" EXIT
