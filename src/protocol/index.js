import * as connectModule from './connect.js';
import * as persistentSessionModule from './persistent-session.js';
import * as qosModule from './qos.js';
import * as retainModule from './retain.js';
import * as willModule from './will.js';
import * as wildcardsModule from './wildcards.js';
import * as keepaliveModule from './keepalive.js';
import * as largePayloadModule from './large-payload.js';
import * as latencyModule from './latency.js';
import * as topicAliasModule from './topic-alias.js';
import * as messageExpiryModule from './message-expiry.js';
import * as userPropertiesModule from './user-properties.js';
import * as sharedSubscriptions from './shared-subscriptions.js';
import * as requestResponseModule from './request-response.js';
import * as flowControlModule from './flow-control.js';
import * as payloadFormatModule from './payload-format.js';
import * as reasonCodesModule from './reason-codes.js';
import * as enhancedAuthModule from './enhanced-auth.js';

import { runTest } from '../utils.js';
import { printProtocolReport, info } from '../reporters.js';
import chalk from 'chalk';

/** All modules in execution order. */
const ALL_MODULES = [
  connectModule,
  qosModule,
  retainModule,
  willModule,
  wildcardsModule,
  keepaliveModule,
  persistentSessionModule,
  largePayloadModule,
  latencyModule,
  // MQTT 5 features
  topicAliasModule,
  messageExpiryModule,
  userPropertiesModule,
  sharedSubscriptions,
  requestResponseModule,
  flowControlModule,
  payloadFormatModule,
  reasonCodesModule,
  enhancedAuthModule,
];

/**
 * Run all protocol tests against a single broker.
 *
 * @param {string} url
 * @param {object} [baseCfg={}]   username, password, etc.
 * @param {object} [opts={}]
 * @param {boolean} [opts.mqtt5Only=false]  run only MQTT 5 modules
 * @param {boolean} [opts.verbose=false]    print each test name as it starts
 * @param {string[]} [opts.only=[]]         run only modules whose name matches (partial, case-insensitive)
 */
export const runProtocolTests = async (url, baseCfg = {}, opts = {}) => {
  const { verbose = false, only = [] } = opts;

  // Filter modules if --only is specified
  const modules = only.length
    ? ALL_MODULES.filter((m) => only.some((f) => m.name.toLowerCase().includes(f.toLowerCase())))
    : ALL_MODULES;

  if (modules.length === 0) {
    console.log(chalk.yellow(`  No modules matched filter: ${only.join(', ')}`));
    return;
  }

  const allResults = [];

  for (const mod of modules) {
    const specs = mod.tests(url, baseCfg);

    if (verbose) {
      console.log('\n' + chalk.bold.white(`  ▸ ${mod.name}`));
    }

    for (const spec of specs) {
      if (verbose) {
        info(`    → ${spec.name}`);
      }
      const result = await runTest(spec.name, async () => {
        let rejectOnUnhandled;
        let settled = false;

        const normalizeReason = (reason) => {
          if (reason instanceof Error) {
            return reason.message;
          }
          if (typeof reason === 'string') {
            return reason;
          }
          try {
            return JSON.stringify(reason);
          } catch {
            return String(reason);
          }
        };

        const failCurrentTest = (kind, reason) => {
          if (settled || !rejectOnUnhandled) {
            return;
          }
          rejectOnUnhandled(
            new Error(
              `${kind} in "${mod.name}" / "${spec.name}": ${normalizeReason(reason)}`
            )
          );
        };

        const onUnhandledRejection = (reason) => {
          failCurrentTest('Unhandled rejection', reason);
        };

        const onUncaughtException = (err) => {
          failCurrentTest('Uncaught exception', err);
        };

        process.on('unhandledRejection', onUnhandledRejection);
        process.on('uncaughtException', onUncaughtException);
        try {
          await Promise.race([
            spec.fn(),
            new Promise((_, reject) => {
              rejectOnUnhandled = reject;
            }),
          ]);
        } finally {
          settled = true;
          rejectOnUnhandled = null;
          process.removeListener('unhandledRejection', onUnhandledRejection);
          process.removeListener('uncaughtException', onUncaughtException);
        }
      });
      // Tag result with module name for grouped display
      result.group = mod.name;
      allResults.push(result);
    }
  }

  printProtocolReport(url, allResults);
};
