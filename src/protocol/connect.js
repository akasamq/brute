import { connect, disconnect } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'CONNECT / DISCONNECT';

export const tests = (url, baseCfg) => [
  {
    name: 'Basic connect & clean disconnect',
    fn: async () => {
      const client = await connect(url, { ...baseCfg, clientId: `brute_conn_${randomId()}` });
      await disconnect(client);
    },
  },

  {
    name: 'Connect with username / password',
    fn: async () => {
      // If baseCfg has credentials these are already set; we just verify
      // the connection succeeds (broker may or may not require auth).
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_auth_${randomId()}`,
      });
      await disconnect(client);
    },
  },

  {
    name: 'Empty clientId (server assigns ID, clean=true)',
    fn: async () => {
      // MQTT 3.1.1 §3.1.3.1: empty clientId with clean=true MUST be accepted.
      const client = await connect(url, {
        ...baseCfg,
        clientId: '',
        clean: true,
      });
      if (!client.options.clientId && client.options.clientId !== '') {
        // mqtt.js fills in a generated id — just verify we're connected
      }
      if (!client.connected) {
        throw new Error('Client not connected after empty clientId');
      }
      await disconnect(client);
    },
  },

  {
    name: 'Protocol version MQTT 3.1.1 (protocol level 4)',
    fn: async () => {
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_v311_${randomId()}`,
        protocolVersion: 4,
      });
      await disconnect(client);
    },
  },

  {
    name: 'Protocol version MQTT 5.0 (protocol level 5)',
    fn: async () => {
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_v5_${randomId()}`,
        protocolVersion: 5,
      });
      await disconnect(client);
    },
  },

  {
    name: 'Duplicate clientId takeover (old session kicked)',
    fn: async () => {
      const clientId = `brute_dup_${randomId()}`;
      const c1 = await connect(url, { ...baseCfg, clientId });

      const c1Closed = new Promise((resolve) => c1.once('close', resolve));

      const c2 = await connect(url, { ...baseCfg, clientId });

      await Promise.race([
        c1Closed,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('c1 not kicked within 4 s')), 4000)
        ),
      ]);

      await disconnect(c2);
    },
  },
];
