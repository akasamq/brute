#!/usr/bin/env node
/**
 * index.js — CLI entry point for brute MQTT testing tool.
 *
 * Usage:
 *   node src/index.js proto  [options]       # protocol feature tests
 *   node src/index.js arena  [options]       # throughput arena
 *   node src/index.js help                  # show help
 *
 * Proto options:
 *   --url <url>          broker URL (default: mqtt://localhost:1883)
 *   --user <user>        username
 *   --pass <pass>        password
 *   --only <filter>      run only modules whose name contains filter (comma-separated)
 *   --verbose            print each test name before running
 *
 * Arena options:
 *   --brokers <json>     JSON array of {url, label?, auth?} (required)
 *                        e.g. '[{"url":"mqtt://a:1883","label":"A"},{"url":"mqtt://b:1883","label":"B"}]'
 *   --url <url>          single broker shorthand (ignored if --brokers given)
 *   --messages <n>       messages per publisher (default: 1000)
 *   --payload <bytes>    payload size in bytes (default: 64)
 *   --publishers <n>     concurrent publisher clients (default: 1)
 *   --subscribers <n>    concurrent subscriber clients (default: 1)
 *   --qos <0|1|2>        QoS level (default: 0)
 *   --timeout <ms>       per-broker timeout ms (default: 30000)
 */

import minimist from 'minimist';
import chalk from 'chalk';
import { runProtocolTests } from './protocol/index.js';
import { runArena } from './arena.js';

// ─── help ────────────────────────────────────────────────────────────────────

const printHelp = () => {
  console.log(`
${chalk.bold.cyan('brute')} — MQTT server testing tool
${chalk.dim('─'.repeat(60))}

${chalk.bold('COMMANDS')}

  ${chalk.cyan('proto')}   Test all MQTT protocol features on a single broker.
  ${chalk.cyan('arena')}   Benchmark and compare throughput across multiple brokers.
  ${chalk.cyan('help')}    Show this help message.

${chalk.bold('PROTO OPTIONS')}

  ${chalk.yellow('--url')}       Broker URL                   ${chalk.dim('[mqtt://localhost:1883]')}
  ${chalk.yellow('--user')}      Username
  ${chalk.yellow('--pass')}      Password
  ${chalk.yellow('--only')}      Comma-separated module name filter  ${chalk.dim('e.g. "QoS,retain,MQTT 5"')}
  ${chalk.yellow('--verbose')}   Print each test name as it runs

${chalk.bold('ARENA OPTIONS')}

  ${chalk.yellow('--brokers')}   JSON array of broker configs (required for multi-broker)
               e.g. ${chalk.dim('[{"url":"mqtt://a:1883","label":"Broker A"},{"url":"mqtt://b:1883","label":"Broker B"}]')}
  ${chalk.yellow('--url')}       Single broker URL shorthand
  ${chalk.yellow('--messages')}  Messages per publisher        ${chalk.dim('[1000]')}
  ${chalk.yellow('--payload')}   Payload size in bytes         ${chalk.dim('[64]')}
  ${chalk.yellow('--publishers')} Concurrent publishers         ${chalk.dim('[1]')}
  ${chalk.yellow('--subscribers')} Concurrent subscribers       ${chalk.dim('[1]')}
  ${chalk.yellow('--qos')}       QoS level (0/1/2)             ${chalk.dim('[0]')}
  ${chalk.yellow('--timeout')}   Per-broker timeout (ms)       ${chalk.dim('[30000]')}

${chalk.bold('EXAMPLES')}

  # Protocol test with auth
  ${chalk.dim('node src/index.js proto --url mqtt://broker:1883 --user admin --pass secret')}

  # MQTT 5 protocol test
  ${chalk.dim('node src/index.js proto --url mqtt://broker:1883 --mqtt5')}

  # Arena: compare two brokers
  ${chalk.dim('node src/index.js arena --brokers \'[{"url":"mqtt://a:1883","label":"Mosquitto"},{"url":"mqtt://b:1883","label":"EMQX"}]\' --messages 5000 --publishers 4')}

  # Arena: single broker stress test
  ${chalk.dim('node src/index.js arena --url mqtt://localhost:1883 --messages 10000 --publishers 8 --subscribers 4 --qos 1')}
`);
};

// ─── parse args ──────────────────────────────────────────────────────────────

const argv = minimist(process.argv.slice(2), {
  string: ['url', 'user', 'pass', 'brokers', 'only'],
  boolean: ['verbose', 'help'],
  alias: { h: 'help' },
  default: {
    url: 'mqtt://localhost:1883',
    messages: 1000,
    payload: 64,
    publishers: 1,
    subscribers: 1,
    qos: 0,
    timeout: 30000,
  },
});

const [command] = argv._;

// ─── dispatch ─────────────────────────────────────────────────────────────────

const run = async () => {
  if (!command || command === 'help' || argv.help) {
    printHelp();
    return;
  }

  if (command === 'proto') {
    const authCfg = {
      username: argv.user,
      password: argv.pass,
    };
    await runProtocolTests(argv.url, authCfg, {
      verbose: argv.verbose,
      only: argv.only ? argv.only.split(',').map((s) => s.trim()) : [],
    });
    return;
  }

  if (command === 'arena') {
    let brokers;

    if (argv.brokers) {
      try {
        brokers = JSON.parse(argv.brokers);
        if (!Array.isArray(brokers)) {
          throw new Error('--brokers must be a JSON array');
        }
      } catch (err) {
        console.error(chalk.red(`Invalid --brokers JSON: ${err.message}`));
        process.exit(1);
      }
    } else {
      // Single broker shorthand
      brokers = [
        {
          url: argv.url,
          label: argv.url,
          auth: { username: argv.user, password: argv.pass },
        },
      ];
    }

    await runArena(brokers, {
      messages: Number(argv.messages),
      payloadBytes: Number(argv.payload),
      publishers: Number(argv.publishers),
      subscribers: Number(argv.subscribers),
      qos: Number(argv.qos),
      timeoutMs: Number(argv.timeout),
    });
    return;
  }

  console.error(chalk.red(`Unknown command: ${command}`));
  printHelp();
  process.exit(1);
};

run().catch((err) => {
  console.error(chalk.red(`\nFatal error: ${err.message}`));
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});
