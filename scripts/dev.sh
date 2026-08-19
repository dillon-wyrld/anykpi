#!/bin/bash
set -e

echo "🚀 Starting ANYKPI..."

if [ ! -d "data" ]; then
  echo "📦 First run detected - initializing database..."
  pnpm run db:init
fi

echo "🔥 Starting development server..."
pnpm next dev
