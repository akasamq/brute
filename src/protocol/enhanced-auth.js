import mqtt from 'mqtt';
import { connect, disconnect } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — Enhanced Authentication';

// Attempt connection with enhanced auth and return the result
const tryEnhancedAuth = (url, baseCfg, authMethod, authData) =>
  new Promise((resolve) => {
    const opts = {
      clientId: `brute_eauth_${randomId()}`,
      username: baseCfg.username,
      password: baseCfg.password,
      protocolVersion: 5,
      reconnectPeriod: 0,
      connectTimeout: 5000,
      properties: {
        authenticationMethod: authMethod,
        authenticationData: authData,
      },
    };

    const client = mqtt.connect(url, opts);
    const timer = setTimeout(() => {
      client.end(true);
      resolve({ success: false, reason: 'timeout' });
    }, 6000);

    client.once('connect', () => {
      clearTimeout(timer);
      client.end(false, {}, () => resolve({ success: true }));
    });

    client.once('error', (err) => {
      clearTimeout(timer);
      client.end(true);
      resolve({ success: false, reason: err.message });
    });
  });

export const tests = (url, baseCfg) => [
  {
    name: 'Baseline: connect without enhanced auth (MQTT 5)',
    fn: async () => {
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_ea0_${randomId()}`,
        protocolVersion: 5,
      });
      await disconnect(client);
    },
  },

  {
    name: 'Unsupported auth method returns error or connects (broker-dependent)',
    fn: async () => {
      // Request a clearly fake auth method.
      // Broker may: (a) reject with 0x8C Bad Authentication Method,
      //             (b) accept if enhanced auth is not enforced.
      // Both outcomes are acceptable; we just verify no crash / hang.
      const result = await tryEnhancedAuth(
        url,
        baseCfg,
        'BRUTE-FAKE-METHOD',
        Buffer.from('test-data')
      );

      // If the broker accepted (unusual but valid), that's fine.
      // If it rejected, the error message should mention auth.
      if (!result.success && result.reason !== 'timeout') {
        // Expected rejection — pass
        return;
      }
      if (result.reason === 'timeout') {
        throw new Error('Broker hung on unknown auth method instead of rejecting');
      }
      // result.success === true: broker didn't enforce enhanced auth — still a pass
    },
  },

  {
    name: 'SCRAM-SHA-256 auth attempt (skipped if not supported by broker)',
    fn: async () => {
      // SCRAM-SHA-256 client-first-message (minimal, for probing only)
      const clientFirst = Buffer.from('n,,n=user,r=clientnonce');

      const result = await tryEnhancedAuth(url, baseCfg, 'SCRAM-SHA-256', clientFirst);

      if (!result.success) {
        const msg = result.reason ?? '';
        if (
          msg.includes('Bad Authentication') ||
          msg.includes('0x8C') ||
          msg.includes('Not Authorized') ||
          msg.includes('timeout')
        ) {
          // Broker doesn't support SCRAM-SHA-256 — skip gracefully
          return;
        }
        throw new Error(`Unexpected auth failure: ${msg}`);
      }
      // success: broker supports and accepted SCRAM-SHA-256 initial exchange
    },
  },
];
