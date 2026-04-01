import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — Topic Alias';

export const tests = (url, baseCfg) => [
  {
    name: 'Establish and reuse topic alias',
    fn: async () => {
      const topic = `brute/alias/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_als_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_alp_${randomId()}`,
        protocolVersion: 5,
      });

      // First publish: set alias 1 → topic
      const msg1 = nextMessage(sub, 3000);
      await publish(pub, topic, 'msg-with-alias', {
        qos: 0,
        properties: { topicAlias: 1 },
      });
      const { payload: p1 } = await msg1;
      if (p1.toString() !== 'msg-with-alias') {
        throw new Error('First alias publish failed');
      }

      // Second publish: use alias 1 with empty topic
      const msg2 = nextMessage(sub, 3000);
      await publish(pub, '', 'msg-alias-only', {
        qos: 0,
        properties: { topicAlias: 1 },
      });
      const { payload: p2, topic: t2 } = await msg2;
      if (p2.toString() !== 'msg-alias-only') {
        throw new Error('Alias-only publish failed');
      }
      if (t2 !== topic) {
        throw new Error(`Alias resolved to wrong topic: ${t2}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Multiple aliases coexist independently',
    fn: async () => {
      const topicA = `brute/aliasA/${randomId()}`;
      const topicB = `brute/aliasB/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_alma_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topicA, { qos: 0 });
      await subscribe(sub, topicB, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_almp_${randomId()}`,
        protocolVersion: 5,
      });

      // Establish alias 1 → topicA, alias 2 → topicB
      await publish(pub, topicA, 'init-a', { qos: 0, properties: { topicAlias: 1 } });
      await nextMessage(sub, 2000);
      await publish(pub, topicB, 'init-b', { qos: 0, properties: { topicAlias: 2 } });
      await nextMessage(sub, 2000);

      // Now use both aliases
      const mA = nextMessage(sub, 2000);
      await publish(pub, '', 'use-a', { qos: 0, properties: { topicAlias: 1 } });
      const { topic: ta } = await mA;
      if (ta !== topicA) {
        throw new Error(`Alias 1 resolved to ${ta}, expected ${topicA}`);
      }

      const mB = nextMessage(sub, 2000);
      await publish(pub, '', 'use-b', { qos: 0, properties: { topicAlias: 2 } });
      const { topic: tb } = await mB;
      if (tb !== topicB) {
        throw new Error(`Alias 2 resolved to ${tb}, expected ${topicB}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
