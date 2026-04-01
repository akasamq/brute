import { connect, disconnect, subscribe, publish, collectMessages } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — Flow Control (Receive Maximum)';

export const tests = (url, baseCfg) => [
  {
    name: 'ReceiveMaximum respected — all messages eventually delivered',
    fn: async () => {
      const topic = `brute/fc/${randomId()}`;
      const N = 20;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_fcs_${randomId()}`,
        protocolVersion: 5,
        properties: { receiveMaximum: 5 },
      });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_fcp_${randomId()}`,
        protocolVersion: 5,
      });

      const collectPromise = collectMessages(sub, N, 15000);

      // Publish all at once — broker must queue excess beyond ReceiveMaximum
      const publishes = Array.from({ length: N }, (_, i) =>
        publish(pub, topic, String(i), { qos: 1 })
      );
      await Promise.all(publishes);

      const msgs = await collectPromise;
      if (msgs.length !== N) {
        throw new Error(`Expected ${N} messages, got ${msgs.length}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'ReceiveMaximum=1 — serial QoS 1 delivery',
    fn: async () => {
      const topic = `brute/fc1/${randomId()}`;
      const N = 5;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_fc1s_${randomId()}`,
        protocolVersion: 5,
        properties: { receiveMaximum: 1 },
      });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_fc1p_${randomId()}`,
        protocolVersion: 5,
      });

      const collectPromise = collectMessages(sub, N, 15000);
      for (let i = 0; i < N; i++) {
        await publish(pub, topic, String(i), { qos: 1 });
      }

      const msgs = await collectPromise;
      if (msgs.length !== N) {
        throw new Error(`Expected ${N}, got ${msgs.length}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
