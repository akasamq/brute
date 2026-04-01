import {
  connect,
  disconnect,
  subscribe,
  unsubscribe,
  publish,
  nextMessage,
} from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — Reason Codes';

export const tests = (url, baseCfg) => [
  {
    name: 'SUBACK returns success reason code (0x00)',
    fn: async () => {
      const topic = `brute/rc/sub/${randomId()}`;

      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_rcs_${randomId()}`,
        protocolVersion: 5,
      });

      const granted = await subscribe(client, topic, { qos: 1 });
      // mqtt.js returns granted as [{topic, qos}]
      if (!granted || granted.length === 0) {
        throw new Error('No SUBACK granted info');
      }
      if (granted[0].qos > 2) {
        throw new Error(`SUBACK error code: 0x${granted[0].qos.toString(16)}`);
      }

      await disconnect(client);
    },
  },

  {
    name: 'SUBACK QoS grant matches or downgrades requested QoS',
    fn: async () => {
      const topic = `brute/rc/subqos/${randomId()}`;

      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_rcq_${randomId()}`,
        protocolVersion: 5,
      });

      const granted = await subscribe(client, topic, { qos: 2 });
      const grantedQos = granted[0].qos;
      // Broker may grant exactly 2, or downgrade to 1 or 0 — all ≤ 2 are valid
      if (grantedQos > 2) {
        throw new Error(`Granted QoS ${grantedQos} exceeds requested 2`);
      }

      await disconnect(client);
    },
  },

  {
    name: 'UNSUBACK returns success reason code',
    fn: async () => {
      const topic = `brute/rc/unsub/${randomId()}`;

      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_rcu_${randomId()}`,
        protocolVersion: 5,
      });

      await subscribe(client, topic, { qos: 0 });
      // unsubscribe should not throw on success
      await unsubscribe(client, topic);

      await disconnect(client);
    },
  },

  {
    name: 'PUBACK returned for QoS 1 (implicit success)',
    fn: async () => {
      const topic = `brute/rc/pub/${randomId()}`;
      const payload = randomId(8);

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rcps_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_rcpp_${randomId()}`,
        protocolVersion: 5,
      });

      // publish() resolves only after PUBACK — if it resolves, PUBACK was success
      const msgPromise = nextMessage(sub, 4000);
      await publish(pub, topic, payload, { qos: 1 });
      const { payload: recvd } = await msgPromise;
      if (recvd.toString() !== payload) {
        throw new Error('Payload mismatch');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'CONNACK reason code 0x00 on successful connect',
    fn: async () => {
      // mqtt.js fires 'connect' only on rc=0; any other rc causes 'error'.
      // Reaching here means CONNACK rc was 0x00.
      const client = await connect(url, {
        ...baseCfg,
        clientId: `brute_rcc_${randomId()}`,
        protocolVersion: 5,
      });
      await disconnect(client);
    },
  },
];
