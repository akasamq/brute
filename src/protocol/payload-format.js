import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — Payload Format & Content Type';

export const tests = (url, baseCfg) => [
  {
    name: 'PayloadFormatIndicator=0 (binary) forwarded',
    fn: async () => {
      const topic = `brute/pfi0/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_pf0s_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_pf0p_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, Buffer.from([0x00, 0xff, 0x42]), {
        qos: 0,
        properties: { payloadFormatIndicator: false },
      });

      const { packet } = await msgPromise;
      // payloadFormatIndicator 0 may or may not be explicitly set (it's the default)
      // Just verify the message arrived
      if (!packet) {
        throw new Error('No packet received');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'PayloadFormatIndicator=1 (UTF-8) forwarded',
    fn: async () => {
      const topic = `brute/pfi1/${randomId()}`;
      const payload = 'Hello UTF-8 World 🌍';

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_pf1s_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_pf1p_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, payload, {
        qos: 0,
        properties: { payloadFormatIndicator: true },
      });

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString('utf8') !== payload) {
        throw new Error('Payload mismatch');
      }
      if (packet.properties?.payloadFormatIndicator !== true) {
        throw new Error('PayloadFormatIndicator not forwarded');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'ContentType forwarded transparently',
    fn: async () => {
      const topic = `brute/ct/${randomId()}`;
      const contentType = 'application/json';

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_cts_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_ctp_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, '{"key":"value"}', {
        qos: 0,
        properties: { contentType },
      });

      const { packet } = await msgPromise;
      if (packet.properties?.contentType !== contentType) {
        throw new Error(`ContentType mismatch: ${packet.properties?.contentType}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'PayloadFormatIndicator + ContentType combined',
    fn: async () => {
      const topic = `brute/pfict/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_pfcs_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_pfcp_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, '{"combined":true}', {
        qos: 1,
        properties: {
          payloadFormatIndicator: true,
          contentType: 'application/json',
        },
      });

      const { packet } = await msgPromise;
      const props = packet.properties;
      if (!props) {
        throw new Error('No properties');
      }
      if (props.payloadFormatIndicator !== true) {
        throw new Error('PayloadFormatIndicator missing');
      }
      if (props.contentType !== 'application/json') {
        throw new Error('ContentType missing');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
