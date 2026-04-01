import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'MQTT 5 — Message Expiry';

export const tests = (url, baseCfg) => [
  {
    name: 'Non-expired message delivered (long TTL)',
    fn: async () => {
      const topic = `brute/exp/${randomId()}`;
      const payload = `exp_live_${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_exs_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_exp_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 4000);
      await publish(pub, topic, payload, {
        qos: 1,
        properties: { messageExpiryInterval: 60 }, // 60 s
      });

      const { payload: recvd } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Expired message NOT delivered to offline subscriber',
    fn: async () => {
      const clientId = `brute_exi_${randomId()}`;
      const topic = `brute/expoffline/${randomId()}`;

      // Persistent session — subscribe then disconnect
      const c1 = await connect(url, {
        ...baseCfg,
        clientId,
        clean: false,
        protocolVersion: 5,
        properties: { sessionExpiryInterval: 120 },
      });
      await subscribe(c1, topic, { qos: 1 });
      await disconnect(c1);

      // Publish with 1 s expiry while subscriber is offline
      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_expub_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, 'will-expire', {
        qos: 1,
        properties: { messageExpiryInterval: 1 },
      });
      await disconnect(pub);

      // Wait for message to expire
      await sleep(2500);

      // Reconnect — expired message should NOT arrive
      const c2 = await connect(url, {
        ...baseCfg,
        clientId,
        clean: false,
        protocolVersion: 5,
        properties: { sessionExpiryInterval: 120 },
      });

      let received = false;
      c2.once('message', () => {
        received = true;
      });
      await sleep(1200);

      if (received) {
        throw new Error('Expired message was delivered');
      }

      await disconnect(c2);
      // Clear session
      const cleaner = await connect(url, {
        ...baseCfg,
        clientId,
        clean: true,
        protocolVersion: 5,
        properties: { sessionExpiryInterval: 0 },
      });
      await disconnect(cleaner);
    },
  },

  {
    name: 'Retained message with expiry — not delivered after expiry',
    fn: async () => {
      const topic = `brute/expret/${randomId()}`;

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_erp_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, 'expiring-retained', {
        qos: 1,
        retain: true,
        properties: { messageExpiryInterval: 1 },
      });
      await disconnect(pub);

      // Wait for expiry
      await sleep(2500);

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_ers_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 1 });

      let received = false;
      sub.once('message', () => {
        received = true;
      });
      await sleep(800);

      if (received) {
        throw new Error('Expired retained message was delivered');
      }

      // Clean up any residual retained
      await publish(sub, topic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },
];
