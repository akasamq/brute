import {
  connect,
  disconnect,
  subscribe,
  unsubscribe,
  publish,
  nextMessage,
  collectMessages,
} from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'Wildcard Subscriptions';

export const tests = (url, baseCfg) => [
  {
    name: '+ matches exactly one level',
    fn: async () => {
      const prefix = `brute/wc/${randomId()}`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_wcs_${randomId()}` });
      await subscribe(sub, `${prefix}/+`, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_wcp_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, `${prefix}/sensor1`, 'val', { qos: 0 });

      const { topic } = await msgPromise;
      if (topic !== `${prefix}/sensor1`) {
        throw new Error(`Unexpected topic: ${topic}`);
      }

      // Two-level deep should NOT match +
      let received = false;
      sub.once('message', () => {
        received = true;
      });
      await publish(pub, `${prefix}/sensor1/extra`, 'no', { qos: 0 });
      await sleep(500);
      if (received) {
        throw new Error('+ matched two levels');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: '# matches all remaining levels',
    fn: async () => {
      const prefix = `brute/wch/${randomId()}`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_wchs_${randomId()}` });
      await subscribe(sub, `${prefix}/#`, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_wchp_${randomId()}` });

      const msgs = collectMessages(sub, 3, 5000);
      await publish(pub, `${prefix}/a`, '1', { qos: 0 });
      await publish(pub, `${prefix}/a/b`, '2', { qos: 0 });
      await publish(pub, `${prefix}/a/b/c`, '3', { qos: 0 });

      const received = await msgs;
      if (received.length !== 3) {
        throw new Error(`Expected 3 messages, got ${received.length}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: '# matches the parent topic itself',
    fn: async () => {
      const prefix = `brute/wchp/${randomId()}`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_wchps_${randomId()}` });
      await subscribe(sub, `${prefix}/#`, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_wchpp_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      // publish to the prefix itself (no trailing slash)
      await publish(pub, prefix, 'root', { qos: 0 });

      const { topic } = await msgPromise;
      if (topic !== prefix) {
        throw new Error(`Topic mismatch: ${topic}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Combined +/# pattern',
    fn: async () => {
      const prefix = `brute/wcmix/${randomId()}`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_wcms_${randomId()}` });
      await subscribe(sub, `${prefix}/+/data/#`, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_wcmp_${randomId()}` });

      const msgs = collectMessages(sub, 2, 5000);
      await publish(pub, `${prefix}/node1/data/temp`, '22', { qos: 0 });
      await publish(pub, `${prefix}/node2/data/hum/raw`, '60', { qos: 0 });

      const received = await msgs;
      if (received.length !== 2) {
        throw new Error(`Expected 2 messages, got ${received.length}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Unsubscribe stops message delivery',
    fn: async () => {
      const topic = `brute/unsub/${randomId()}`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_usu_${randomId()}` });
      await subscribe(sub, topic, { qos: 0 });
      await unsubscribe(sub, topic);

      const pub = await connect(url, { ...baseCfg, clientId: `brute_usp_${randomId()}` });
      await publish(pub, topic, 'after-unsub', { qos: 1 });

      await sleep(600);
      let received = false;
      sub.once('message', () => {
        received = true;
      });
      await sleep(300);

      if (received) {
        throw new Error('Message received after unsubscribe');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Topic with leading separator (/topic)',
    fn: async () => {
      const id = randomId();
      const topic = `/brute/slash/${id}`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_sls_${randomId()}` });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_slp_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, 'slash-test', { qos: 0 });

      const { topic: recvdTopic } = await msgPromise;
      if (recvdTopic !== topic) {
        throw new Error(`Topic mismatch: ${recvdTopic}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Same message delivered to overlapping subscriptions',
    fn: async () => {
      const prefix = `brute/overlap/${randomId()}`;
      const topic = `${prefix}/x/y`;

      const sub = await connect(url, { ...baseCfg, clientId: `brute_ovs_${randomId()}` });
      await subscribe(sub, `${prefix}/+/y`, { qos: 0 });
      await subscribe(sub, `${prefix}/#`, { qos: 0 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_ovp_${randomId()}` });

      // Both subscriptions match → expect 2 deliveries
      const msgs = collectMessages(sub, 2, 4000);
      await publish(pub, topic, 'ov', { qos: 0 });

      const received = await msgs;
      if (received.length < 2) {
        throw new Error(`Expected ≥2 deliveries (overlapping subs), got ${received.length}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
