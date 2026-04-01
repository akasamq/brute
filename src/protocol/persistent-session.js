import {
  connect,
  disconnect,
  subscribe,
  unsubscribe,
  publish,
  nextMessage,
} from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'Persistent Session';

export const tests = (url, baseCfg) => [
  {
    name: 'Subscriptions survive disconnect (QoS 1 queued delivery)',
    fn: async () => {
      const clientId = `brute_ps1_${randomId()}`;
      const topic = `brute/ps/${randomId()}`;
      const cfg = { ...baseCfg, clientId, clean: false };

      // First session — subscribe then disconnect
      const c1 = await connect(url, cfg);
      await subscribe(c1, topic, { qos: 1 });
      await disconnect(c1);

      // Publish while offline
      const pub = await connect(url, { ...baseCfg, clientId: `brute_pub_${randomId()}` });
      await publish(pub, topic, 'queued-msg', { qos: 1 });
      await disconnect(pub);

      // Reconnect — should receive queued message
      const c2 = await connect(url, cfg);
      const { payload } = await nextMessage(c2, 4000);
      if (payload.toString() !== 'queued-msg') {
        throw new Error(`Expected 'queued-msg', got '${payload.toString()}'`);
      }

      // Cleanup: unsubscribe + clear session
      await unsubscribe(c2, topic);
      await disconnect(c2);
      const cleaner = await connect(url, { ...baseCfg, clientId, clean: true });
      await disconnect(cleaner);
    },
  },

  {
    name: 'QoS 2 messages queued while offline',
    fn: async () => {
      const clientId = `brute_ps2_${randomId()}`;
      const topic = `brute/ps2/${randomId()}`;
      const cfg = { ...baseCfg, clientId, clean: false };

      const c1 = await connect(url, cfg);
      await subscribe(c1, topic, { qos: 2 });
      await disconnect(c1);

      const pub = await connect(url, { ...baseCfg, clientId: `brute_pub2_${randomId()}` });
      await publish(pub, topic, 'qos2-queued', { qos: 2 });
      await disconnect(pub);

      const c2 = await connect(url, cfg);
      const { payload, packet } = await nextMessage(c2, 5000);
      if (payload.toString() !== 'qos2-queued') {
        throw new Error(`Payload mismatch: '${payload.toString()}'`);
      }
      if (packet.qos !== 2) {
        throw new Error(`Expected QoS 2, got ${packet.qos}`);
      }

      await unsubscribe(c2, topic);
      await disconnect(c2);
      const cleaner = await connect(url, { ...baseCfg, clientId, clean: true });
      await disconnect(cleaner);
    },
  },

  {
    name: 'Clean session clears previous subscriptions',
    fn: async () => {
      const clientId = `brute_psc_${randomId()}`;
      const topic = `brute/psc/${randomId()}`;

      // Persistent session — subscribe
      const c1 = await connect(url, { ...baseCfg, clientId, clean: false });
      await subscribe(c1, topic, { qos: 1 });
      await disconnect(c1);

      // Reconnect with clean=true — old subscription should be gone
      const c2 = await connect(url, { ...baseCfg, clientId, clean: true });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_pubcs_${randomId()}` });
      await publish(pub, topic, 'should-not-arrive', { qos: 0 });
      await disconnect(pub);

      await sleep(600);
      let received = false;
      c2.once('message', () => {
        received = true;
      });
      await sleep(300);

      if (received) {
        throw new Error('Received message after clean session cleared subscription');
      }
      await disconnect(c2);
    },
  },

  {
    name: 'MQTT 5 — Session Expiry Interval',
    fn: async () => {
      const clientId = `brute_sei_${randomId()}`;
      const topic = `brute/sei/${randomId()}`;
      const cfg = {
        ...baseCfg,
        clientId,
        clean: false,
        protocolVersion: 5,
        properties: { sessionExpiryInterval: 60 }, // 60 s
      };

      const c1 = await connect(url, cfg);
      await subscribe(c1, topic, { qos: 1 });
      await disconnect(c1);

      // Session should persist for 60 s — publish while offline
      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_seipub_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, 'sei-queued', { qos: 1 });
      await disconnect(pub);

      const c2 = await connect(url, cfg);
      const { payload } = await nextMessage(c2, 4000);
      if (payload.toString() !== 'sei-queued') {
        throw new Error(`Payload mismatch: '${payload.toString()}'`);
      }

      // Clean up session
      await disconnect(c2);
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
];
