import { connect, disconnect } from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'Keep-Alive (PINGREQ/PINGRESP)';

export const tests = (url, baseCfg) => [
  {
    name: 'Connection survives 2× keepalive interval',
    fn: async () => {
      const keepalive = 3; // seconds
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_ka_${randomId()}`,
        keepalive,
      });

      // Wait 2.5× keepalive — client must send PINGREQ; broker must respond
      await sleep(keepalive * 2500);

      if (!client.connected) {
        throw new Error('Client disconnected during keep-alive test');
      }
      await disconnect(client);
    },
  },

  {
    name: 'keepalive=0 disables PINGREQ (long idle stays connected)',
    fn: async () => {
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_ka0_${randomId()}`,
        keepalive: 0,
      });

      await sleep(3000); // 3 s idle — no ping needed
      if (!client.connected) {
        throw new Error('Client unexpectedly disconnected with keepalive=0');
      }
      await disconnect(client);
    },
  },
];
