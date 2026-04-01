import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'Retained Messages';

export const tests = (url, baseCfg) => [
  {
    name: 'Retained message delivered to late subscriber',
    fn: async () => {
      const topic = `brute/ret/${randomId()}`;
      const payload = `retained_${randomId()}`;

      const pub = await connect(url, { ...baseCfg, clientId: `brute_rp_${randomId()}` });
      await publish(pub, topic, payload, { qos: 1, retain: true });
      await disconnect(pub);

      await sleep(100);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_rs_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      await subscribe(sub, topic, { qos: 1 });

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }
      if (!packet.retain) {
        throw new Error('retain flag not set on received packet');
      }

      // Cleanup
      const cleaner = await connect(url, { ...baseCfg, clientId: `brute_rc_${randomId()}` });
      await publish(cleaner, topic, '', { qos: 1, retain: true });
      await Promise.all([disconnect(sub), disconnect(cleaner)]);
    },
  },

  {
    name: 'Clear retained message with empty payload',
    fn: async () => {
      const topic = `brute/retclr/${randomId()}`;
      const payload = `to-clear_${randomId()}`;

      const pub = await connect(url, { ...baseCfg, clientId: `brute_rpc_${randomId()}` });
      await publish(pub, topic, payload, { qos: 1, retain: true });
      await sleep(100);
      // Clear
      await publish(pub, topic, '', { qos: 1, retain: true });
      await disconnect(pub);

      await sleep(150);

      // Late subscriber should NOT receive a retained message
      const sub = await connect(url, { ...baseCfg, clientId: `brute_rsc_${randomId()}` });
      await subscribe(sub, topic, { qos: 1 });

      let received = false;
      sub.once('message', () => {
        received = true;
      });
      await sleep(700);

      if (received) {
        throw new Error('Retained message was not cleared');
      }
      await disconnect(sub);
    },
  },

  {
    name: 'Retained message replaced by newer value',
    fn: async () => {
      const topic = `brute/retrpl/${randomId()}`;

      const pub = await connect(url, { ...baseCfg, clientId: `brute_rpr_${randomId()}` });
      await publish(pub, topic, 'old', { qos: 1, retain: true });
      await sleep(80);
      await publish(pub, topic, 'new', { qos: 1, retain: true });
      await disconnect(pub);

      await sleep(100);

      const sub = await connect(url, { ...baseCfg, clientId: `brute_rsr_${randomId()}` });
      const msgPromise = nextMessage(sub, 3000);
      await subscribe(sub, topic, { qos: 1 });

      const { payload: recvd } = await msgPromise;
      if (recvd.toString() !== 'new') {
        throw new Error(`Expected 'new', got '${recvd.toString()}'`);
      }

      // Cleanup
      await publish(sub, topic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },

  {
    name: 'MQTT 5 — RetainAsPublished subscription option',
    fn: async () => {
      const topic = `brute/rap/${randomId()}`;
      const payload = `rap_${randomId()}`;

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rapp_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, payload, { qos: 1, retain: true });
      await disconnect(pub);

      await sleep(100);

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_raps_${randomId()}`,
        protocolVersion: 5,
      });
      const msgPromise = nextMessage(sub, 3000);
      // retainAsPublished: true → broker preserves the retain flag on forwarded msgs
      await subscribe(sub, topic, { qos: 1, rap: true });

      const { packet } = await msgPromise;
      if (!packet.retain) {
        throw new Error('retain flag should be preserved with RetainAsPublished');
      }

      // Cleanup
      await publish(sub, topic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },

  {
    name: "MQTT 5 — RetainHandling=1 (don't send retained if already subscribed)",
    fn: async () => {
      const topic = `brute/rh1/${randomId()}`;
      const payload = `rh1_${randomId()}`;

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rh1p_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, payload, { qos: 1, retain: true });
      await disconnect(pub);

      await sleep(100);

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rh1s_${randomId()}`,
        protocolVersion: 5,
        clean: false,
      });

      // First subscription — retain delivered (retainHandling=0, default)
      const firstPromise = nextMessage(sub, 3000);
      await subscribe(sub, topic, { qos: 1, rh: 0 });
      await firstPromise; // consume retained message

      // Second subscription — retainHandling=1 → no retained message sent again
      await subscribe(sub, topic, { qos: 1, rh: 1 });
      let received = false;
      sub.once('message', () => {
        received = true;
      });
      await sleep(700);

      if (received) {
        throw new Error('Retained message sent again despite RetainHandling=1');
      }

      // Cleanup
      await publish(sub, topic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },

  {
    name: 'MQTT 5 — RetainHandling=2 (never send retained on subscribe)',
    fn: async () => {
      const topic = `brute/rh2/${randomId()}`;
      const payload = `rh2_${randomId()}`;

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rh2p_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, payload, { qos: 1, retain: true });
      await disconnect(pub);

      await sleep(100);

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rh2s_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 1, rh: 2 });

      let received = false;
      sub.once('message', () => {
        received = true;
      });
      await sleep(700);

      if (received) {
        throw new Error('Retained message delivered despite RetainHandling=2');
      }

      // Cleanup
      await publish(sub, topic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },
];
