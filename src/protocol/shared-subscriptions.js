import { connect, disconnect, subscribe, publish } from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'MQTT 5 — Shared Subscriptions';

export const tests = (url, baseCfg) => [
  {
    name: 'Messages distributed across shared subscriber group',
    fn: async () => {
      const group = `brute_${randomId()}`;
      const topic = `brute/shared/${randomId()}`;
      const shared = `$share/${group}/${topic}`;
      const N = 10;

      const s1 = await connect(url, {
        ...baseCfg,
        clientId: `brute_ss1_${randomId()}`,
        protocolVersion: 5,
      });
      const s2 = await connect(url, {
        ...baseCfg,
        clientId: `brute_ss2_${randomId()}`,
        protocolVersion: 5,
      });

      let count1 = 0;
      let count2 = 0;
      s1.on('message', () => count1++);
      s2.on('message', () => count2++);

      await subscribe(s1, shared, { qos: 1 });
      await subscribe(s2, shared, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_ssp_${randomId()}`,
        protocolVersion: 5,
      });

      for (let i = 0; i < N; i++) {
        await publish(pub, topic, String(i), { qos: 1 });
      }

      // Allow delivery to settle
      await sleep(1500);

      const total = count1 + count2;
      if (total !== N) {
        throw new Error(
          `Expected ${N} total deliveries, got ${total} (s1=${count1}, s2=${count2})`
        );
      }
      // Each subscriber should receive at least some messages (load-balancing)
      if (count1 === 0 || count2 === 0) {
        throw new Error(`Messages not distributed: s1=${count1}, s2=${count2}`);
      }

      await Promise.all([disconnect(s1), disconnect(s2), disconnect(pub)]);
    },
  },

  {
    name: 'Each message delivered exactly once across the group',
    fn: async () => {
      const group = `brute_${randomId()}`;
      const topic = `brute/sharedexact/${randomId()}`;
      const shared = `$share/${group}/${topic}`;
      const N = 6;

      const subscribers = await Promise.all(
        Array.from({ length: 3 }, (_, i) =>
          connect(url, {
            ...baseCfg,
            clientId: `brute_sse${i}_${randomId()}`,
            protocolVersion: 5,
          })
        )
      );

      let total = 0;
      subscribers.forEach((s) => s.on('message', () => total++));
      await Promise.all(subscribers.map((s) => subscribe(s, shared, { qos: 1 })));

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_ssep_${randomId()}`,
        protocolVersion: 5,
      });

      for (let i = 0; i < N; i++) {
        await publish(pub, topic, String(i), { qos: 1 });
      }
      await sleep(1500);

      if (total !== N) {
        throw new Error(`Expected exactly ${N} deliveries (one per message), got ${total}`);
      }

      await Promise.all([...subscribers.map((s) => disconnect(s)), disconnect(pub)]);
    },
  },

  {
    name: 'Multiple share groups each receive all messages',
    fn: async () => {
      const topic = `brute/sharedmulti/${randomId()}`;
      const groupA = `brute_ga_${randomId()}`;
      const groupB = `brute_gb_${randomId()}`;
      const N = 4;

      const sA = await connect(url, {
        ...baseCfg,
        clientId: `brute_sma_${randomId()}`,
        protocolVersion: 5,
      });
      const sB = await connect(url, {
        ...baseCfg,
        clientId: `brute_smb_${randomId()}`,
        protocolVersion: 5,
      });

      let cA = 0,
        cB = 0;
      sA.on('message', () => cA++);
      sB.on('message', () => cB++);

      await subscribe(sA, `$share/${groupA}/${topic}`, { qos: 1 });
      await subscribe(sB, `$share/${groupB}/${topic}`, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_smp_${randomId()}`,
        protocolVersion: 5,
      });
      for (let i = 0; i < N; i++) {
        await publish(pub, topic, String(i), { qos: 1 });
      }
      await sleep(1500);

      if (cA !== N) {
        throw new Error(`Group A received ${cA}/${N}`);
      }
      if (cB !== N) {
        throw new Error(`Group B received ${cB}/${N}`);
      }

      await Promise.all([disconnect(sA), disconnect(sB), disconnect(pub)]);
    },
  },
];
