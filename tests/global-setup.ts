/**
 * Playwright global setup - seeds demo database before E2E tests
 */
import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';

export default async function globalSetup() {
  console.log('Setting up test database...');
  
  // Ensure data directory exists
  const dataDir = resolve(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  
  // Initialize and seed database
  try {
    execSync('pnpm db:init', { stdio: 'inherit' });
    console.log('Test database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize test database:', error);
    throw error;
  }

  console.log('Building @anykpi/cli for smoke tests...');
  execSync('pnpm --filter @anykpi/cli build', { stdio: 'inherit' });
}
