import {
  connect,
  disconnect,
  subscribe,
  publish,
  nextMessage,
  collectMessages,
} from '../client.js';
import { randomId } from '../utils.js';

export const name = 'QoS';

export const tests = (url, baseCfg) => [
  {
    name: 'QoS 0 — fire-and-forget delivery',
    fn: async () => {
      const topic = `brute/qos0/${randomId()}`;
      const payload = randomId(16);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_s0_${randomId()}` });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_p0_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, payload, { qos: 0 });

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }
      if (packet.qos !== 0) {
        throw new Error(`Expected QoS 0, got ${packet.qos}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'QoS 1 — at-least-once (PUBACK)',
    fn: async () => {
      const topic = `brute/qos1/${randomId()}`;
      const payload = randomId(16);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_s1_${randomId()}` });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_p1_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, payload, { qos: 1 });

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }
      if (packet.qos !== 1) {
        throw new Error(`Expected QoS 1, got ${packet.qos}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'QoS 2 — exactly-once (PUBREC/PUBREL/PUBCOMP)',
    fn: async () => {
      const topic = `brute/qos2/${randomId()}`;
      const payload = randomId(16);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_s2_${randomId()}` });
      await subscribe(sub, topic, { qos: 2 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_p2_${randomId()}` });
      const msgPromise = nextMessage(sub, 5000);
      await publish(pub, topic, payload, { qos: 2 });

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }
      if (packet.qos !== 2) {
        throw new Error(`Expected QoS 2, got ${packet.qos}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'QoS downgrade: pub QoS 2, sub QoS 0 → delivered at QoS 0',
    fn: async () => {
      const topic = `brute/qosdg/${randomId()}`;
      const payload = randomId(12);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_sdg_${randomId()}` });
      await subscribe(sub, topic, { qos: 0 }); // subscribe at QoS 0

      const pub = await connect(url, { ...baseCfg, clientId: `brute_pdg_${randomId()}` });
      const msgPromise = nextMessage(sub, 4000);
      await publish(pub, topic, payload, { qos: 2 }); // publish at QoS 2

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }
      // Broker MUST downgrade: delivered QoS = min(pub QoS, sub QoS) = 0
      if (packet.qos !== 0) {
        throw new Error(`Expected downgraded QoS 0, got ${packet.qos}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'QoS 1 — sequential burst (20 messages, ordered)',
    fn: async () => {
      const topic = `brute/qos1b/${randomId()}`;
      const N = 20;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_sb_${randomId()}` });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_pb_${randomId()}` });
      const collect = collectMessages(sub, N, 10000);

      for (let i = 0; i < N; i++) {
        await publish(pub, topic, String(i), { qos: 1 });
      }

      const msgs = await collect;
      if (msgs.length !== N) {
        throw new Error(`Expected ${N} messages, got ${msgs.length}`);
      }

      // Check ordering (MQTT 3.1.1 §4.6: ordered for same QoS on single connection)
      const got = msgs.map((m) => Number(m.payload.toString()));
      for (let i = 0; i < N; i++) {
        if (got[i] !== i) {
          throw new Error(`Message out of order at index ${i}: got ${got[i]}`);
        }
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'QoS 2 — duplicate suppression (exactly-once guarantee)',
    fn: async () => {
      const topic = `brute/qos2dup/${randomId()}`;
      const payload = randomId(12);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_s2d_${randomId()}` });
      await subscribe(sub, topic, { qos: 2 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_p2d_${randomId()}` });

      let count = 0;
      sub.on('message', () => count++);

      await publish(pub, topic, payload, { qos: 2 });

      // Wait for potential duplicate delivery window
      await new Promise((r) => setTimeout(r, 1500));

      if (count !== 1) {
        throw new Error(`Expected exactly 1 delivery, got ${count}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
