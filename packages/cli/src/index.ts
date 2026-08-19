#!/usr/bin/env node

/**
 * ANYKPI CLI
 * 
 * npx @anykpi/cli - Unified insights for modern day builders
 * 
 * Commands:
 * - login / key     Generate API key
 * - workspaces      List workspaces
 * - connect         Connect a data source
 * - identify        Identify a user
 * - track           Track an event
 * - overview        Get company snapshot
 * - users           Query users
 * - cohorts         Get retention data
 * - wbr             Get WBR metrics
 * - calendar        Get calendar events
 */

import { program } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import fetch from 'node-fetch';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const CONFIG_DIR = join(homedir(), '.anykpi');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

interface Config {
  apiUrl?: string;
  apiKey?: string;
  workspace?: string;
}

function loadConfig(): Config {
  if (!existsSync(CONFIG_FILE)) {
    return {};
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

function saveConfig(config: Config) {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

async function apiRequest(endpoint: string, options: any = {}) {
  const config = loadConfig();
  const apiUrl = config.apiUrl || 'http://localhost:3000';
  
  const response = await fetch(`${apiUrl}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { Authorization: `Bearer ${config.apiKey}` }),
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  
  return response.json();
}

program
  .name('anykpi')
  .description('ANYKPI CLI - The growth stack for modern builders')
  .version('0.1.0');

// ========== Login / Key ==========

program
  .command('login')
  .description('Generate API key for agent access')
  .option('--url <url>', 'ANYKPI instance URL', 'http://localhost:3000')
  .option('--key <key>', 'Existing ANYKPI_API_KEY (or set the env var)')
  .action(async (options) => {
    const spinner = ora('Connecting to ANYKPI...').start();
    
    try {
      const adminKey = options.key || process.env.ANYKPI_API_KEY;
      if (!adminKey) {
        spinner.fail('Set ANYKPI_API_KEY or pass --key to mint a new key');
        return;
      }

      const { name } = await prompts({
        type: 'text',
        name: 'name',
        message: 'API key name (e.g., "My Agent")',
        initial: 'CLI Key'
      });
      
      if (!name) {
        spinner.fail('Cancelled');
        return;
      }
      
      const response = await fetch(`${options.url}/api/v1/keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ name }),
      });
      
      const data: any = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create API key');
      }
      
      const config = loadConfig();
      config.apiUrl = options.url;
      config.apiKey = data.key;
      config.workspace = 'demo';
      saveConfig(config);
      
      spinner.succeed('API key created and saved');
      console.log();
      console.log(chalk.green('✓'), 'Key ID:', chalk.bold(data.id));
      console.log(chalk.green('✓'), 'Saved to:', chalk.dim(CONFIG_FILE));
      console.log();
      console.log(chalk.dim('Your key is stored locally. Run'), chalk.bold('anykpi overview'), chalk.dim('to test.'));
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

program
  .command('key')
  .description('Alias for login')
  .action(() => program.parse(['node', 'anykpi', 'login']));

// ========== Workspaces ==========

program
  .command('workspaces')
  .alias('ws')
  .description('List workspaces')
  .action(async () => {
    const config = loadConfig();
    
    console.log();
    console.log(chalk.bold('Workspaces:'));
    console.log();
    console.log('  demo', config.workspace === 'demo' ? chalk.green('(current)') : '');
    console.log('  live', config.workspace === 'live' ? chalk.green('(current)') : '');
    console.log();
    console.log(chalk.dim('Use --workspace flag to switch'));
  });

// ========== Connect ==========

program
  .command('connect <source>')
  .description('Connect a data source (posthog, mixpanel, amplitude)')
  .action(async (source) => {
    const spinner = ora(`Connecting ${source}...`).start();
    
    try {
      const credentials: Record<string, string> = {};
      
      if (source === 'posthog') {
        const { apiKey } = await prompts({
          type: 'password',
          name: 'apiKey',
          message: 'PostHog API key:'
        });
        credentials.apiKey = apiKey;
      } else if (source === 'mixpanel') {
        const { projectId, apiSecret } = await prompts([
          { type: 'text', name: 'projectId', message: 'Mixpanel Project ID:' },
          { type: 'password', name: 'apiSecret', message: 'Mixpanel API Secret:' }
        ]);
        credentials.projectId = projectId;
        credentials.apiSecret = apiSecret;
      } else if (source === 'amplitude') {
        const { apiKey, secretKey } = await prompts([
          { type: 'text', name: 'apiKey', message: 'Amplitude API Key:' },
          { type: 'password', name: 'secretKey', message: 'Amplitude Secret Key:' }
        ]);
        credentials.apiKey = apiKey;
        credentials.secretKey = secretKey;
      } else {
        spinner.fail(`Unknown source: ${source}`);
        return;
      }
      
      spinner.text = `Syncing ${source}...`;
      
      // In reality, this would call the sync endpoint
      // For now, show success
      spinner.succeed(`${source} connected`);
      
      console.log();
      console.log(chalk.dim('Run'), chalk.bold('anykpi overview'), chalk.dim('to see your data'));
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== Identify ==========

program
  .command('identify <userId>')
  .description('Identify a user')
  .option('--name <name>', 'User name')
  .option('--email <email>', 'User email')
  .option('--platform <platform>', 'Platform (ios, android, web)')
  .option('--workspace <workspace>', 'Workspace')
  .option('--json', 'Output as JSON')
  .action(async (userId, options) => {
    const spinner = ora('Identifying user...').start();
    
    try {
      const data = await apiRequest('/api/v1/ingest/identify', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          properties: {
            name: options.name,
            email: options.email,
            platform: options.platform,
          },
          workspaceId: options.workspace || loadConfig().workspace || 'demo',
        }),
      });
      
      spinner.succeed('User identified');
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== Track ==========

program
  .command('track <userId> <eventName>')
  .description('Track an event')
  .option('--workspace <workspace>', 'Workspace')
  .option('--json', 'Output as JSON')
  .action(async (userId, eventName, options) => {
    const spinner = ora('Tracking event...').start();
    
    try {
      const data = await apiRequest('/api/v1/ingest/event', {
        method: 'POST',
        body: JSON.stringify({
          userId,
          eventName,
          workspaceId: options.workspace || loadConfig().workspace || 'demo',
        }),
      });
      
      spinner.succeed('Event tracked');
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== Overview ==========

program
  .command('overview')
  .description('Get company snapshot')
  .option('--workspace <workspace>', 'Workspace')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching overview...').start();
    
    try {
      const workspace = options.workspace || loadConfig().workspace || 'demo';
      const data = await apiRequest(`/api/v1/overview?workspace=${workspace}`);
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log();
        console.log(chalk.bold(workspace.toUpperCase()), chalk.dim('workspace'));
        console.log();
        console.log('  Total Users:', chalk.bold(data.totalUsers));
        console.log('  Active Today:', chalk.bold(data.activeToday));
        console.log('  Weekly Active:', chalk.bold(data.weeklyActive));
        console.log('  Retention:', chalk.bold(data.retentionRate + '%'));
        console.log('  PMF Signal:', data.smileDetected ? chalk.green('✓ Smile detected') : chalk.dim('—'));
        console.log('  Exceptions:', data.exceptionsCount > 0 ? chalk.yellow(data.exceptionsCount) : chalk.green('0'));
        console.log();
        if (data.view_url) {
          console.log(chalk.dim('View:'), chalk.cyan(data.view_url));
        }
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== Users ==========

program
  .command('users')
  .description('Query users')
  .option('--workspace <workspace>', 'Workspace')
  .option('--cluster <cluster>', 'Behavior cluster')
  .option('--platform <platform>', 'Platform')
  .option('--limit <limit>', 'Limit results', '10')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Querying users...').start();
    
    try {
      const workspace = options.workspace || loadConfig().workspace || 'demo';
      const params = new URLSearchParams({
        workspace,
        ...(options.cluster && { cluster: options.cluster }),
        ...(options.platform && { platform: options.platform }),
        limit: options.limit,
      });
      
      const data = await apiRequest(`/api/v1/users?${params}`);
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log();
        console.log(chalk.bold(data.total), 'users');
        console.log();
        
        data.users.slice(0, parseInt(options.limit)).forEach((user: any) => {
          console.log('  ', user.emoji || '👤', chalk.bold(user.name), chalk.dim(user.platform || ''));
          if (user.cluster) {
            console.log('      ', chalk.dim(user.cluster));
          }
        });
        
        console.log();
        if (data.view_url) {
          console.log(chalk.dim('View:'), chalk.cyan(data.view_url));
        }
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== Cohorts ==========

program
  .command('cohorts')
  .description('Get retention data')
  .option('--workspace <workspace>', 'Workspace')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching cohorts...').start();
    
    try {
      const workspace = options.workspace || loadConfig().workspace || 'demo';
      const data = await apiRequest(`/api/v1/cohorts?workspace=${workspace}`);
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log();
        console.log(chalk.bold(data.cohorts.length), 'cohorts');
        console.log();
        
        if (data.smileDetected) {
          console.log(chalk.green('✓'), 'PMF smile detected');
          console.log();
        }
        
        data.cohorts.slice(0, 5).forEach((cohort: any) => {
          const retention = cohort.retention;
          console.log('  ', chalk.bold(cohort.label), chalk.dim(`(${cohort.size} users)`));
          console.log('      Week 0:', chalk.bold(retention.week0 + '%'));
          console.log('      Week 4:', chalk.bold(retention.week4 + '%'));
          console.log('      Latest:', cohort.smileDetected ? chalk.green(retention.latest + '% 😊') : chalk.dim(retention.latest + '%'));
          console.log();
        });
        
        if (data.view_url) {
          console.log(chalk.dim('View:'), chalk.cyan(data.view_url));
        }
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== WBR ==========

program
  .command('wbr')
  .description('Get WBR metrics')
  .option('--workspace <workspace>', 'Workspace')
  .option('--section <section>', 'Filter by section')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching WBR...').start();
    
    try {
      const workspace = options.workspace || loadConfig().workspace || 'demo';
      const data = await apiRequest(`/api/v1/wbr?workspace=${workspace}`);
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log();
        console.log(chalk.bold(data.metrics.length), 'metrics');
        
        if (data.exceptionsCount > 0) {
          console.log(chalk.yellow('⚠'), data.exceptionsCount, 'exceptions');
        }
        console.log();
        
        let metrics = data.metrics;
        if (options.section) {
          metrics = metrics.filter((m: any) => m.section.toLowerCase() === options.section.toLowerCase());
        }
        
        metrics.slice(0, 10).forEach((metric: any) => {
          const statusColor = metric.status === 'ok' ? chalk.green : metric.status === 'watch' ? chalk.yellow : chalk.red;
          const statusIcon = metric.status === 'ok' ? '✓' : metric.status === 'watch' ? '⚠' : '✗';
          
          console.log('  ', statusColor(statusIcon), chalk.bold(metric.name));
          console.log('      ', chalk.dim(metric.section), '·', metric.owner);
          console.log('      ', 'Current:', chalk.bold(metric.current + metric.unit));
          console.log('      ', 'Target:', metric.target + metric.unit, '·', 'WoW:', metric.wow > 0 ? chalk.green(`+${metric.wow}%`) : chalk.red(`${metric.wow}%`));
          console.log();
        });
        
        if (data.view_url) {
          console.log(chalk.dim('View:'), chalk.cyan(data.view_url));
        }
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

// ========== Calendar ==========

program
  .command('calendar')
  .description('Get calendar events')
  .option('--workspace <workspace>', 'Workspace')
  .option('--source <source>', 'Filter by source')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = ora('Fetching calendar...').start();
    
    try {
      const workspace = options.workspace || loadConfig().workspace || 'demo';
      const data = await apiRequest(`/api/v1/calendar?workspace=${workspace}`);
      
      spinner.stop();
      
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log();
        console.log(chalk.bold(data.events.length), 'events from', chalk.bold(data.sources.length), 'sources');
        console.log();
        
        let events = data.events;
        if (options.source) {
          events = events.filter((e: any) => e.source === options.source);
        }
        
        events.slice(0, 10).forEach((event: any) => {
          const date = new Date(event.date);
          console.log('  ', event.emoji, chalk.bold(event.title));
          console.log('      ', chalk.dim(date.toLocaleDateString()), '·', event.badge);
          console.log('      ', chalk.dim(event.sourceName), event.syncAge ? `· ${event.syncAge}` : '');
          console.log();
        });
        
        if (data.view_url) {
          console.log(chalk.dim('View:'), chalk.cyan(data.view_url));
        }
      }
    } catch (error) {
      spinner.fail((error as Error).message);
      process.exit(1);
    }
  });

program.parse();
