import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — User Properties';

export const tests = (url, baseCfg) => [
  {
    name: 'Single user property forwarded transparently',
    fn: async () => {
      const topic = `brute/uprops/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_ups_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_upp_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, 'payload', {
        qos: 0,
        properties: { userProperties: { source: 'brute-test', version: '1' } },
      });

      const { packet } = await msgPromise;
      const up = packet.properties?.userProperties;
      if (!up) {
        throw new Error('userProperties missing from received packet');
      }
      if (up.source !== 'brute-test') {
        throw new Error(`source mismatch: ${up.source}`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'Multiple user properties (duplicate keys allowed)',
    fn: async () => {
      const topic = `brute/upropsmulti/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_upms_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 0 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_upmp_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      // mqtt.js represents multiple same-key props as an array
      await publish(pub, topic, 'multi', {
        qos: 0,
        properties: {
          userProperties: { tag: ['a', 'b', 'c'] },
        },
      });

      const { packet } = await msgPromise;
      const up = packet.properties?.userProperties;
      if (!up) {
        throw new Error('userProperties missing');
      }

      // Broker must forward all values
      const tags = Array.isArray(up.tag) ? up.tag : [up.tag];
      if (tags.length < 1) {
        throw new Error('tag values not forwarded');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'User properties on retained message forwarded to late subscriber',
    fn: async () => {
      const topic = `brute/upropret/${randomId()}`;

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_uprp_${randomId()}`,
        protocolVersion: 5,
      });
      await publish(pub, topic, 'retained-with-props', {
        qos: 1,
        retain: true,
        properties: { userProperties: { env: 'test' } },
      });
      await disconnect(pub);

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_uprs_${randomId()}`,
        protocolVersion: 5,
      });
      const msgPromise = nextMessage(sub, 3000);
      await subscribe(sub, topic, { qos: 1 });

      const { packet } = await msgPromise;
      const up = packet.properties?.userProperties;
      if (!up || up.env !== 'test') {
        throw new Error(`userProperties not preserved on retained: ${JSON.stringify(up)}`);
      }

      // Cleanup
      await publish(sub, topic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },

  {
    name: 'User properties combined with contentType and responseTopic',
    fn: async () => {
      const topic = `brute/upropcombo/${randomId()}`;
      const responseTopic = `brute/reply/${randomId()}`;

      const sub = await connect(url, {
        ...baseCfg,
        clientId: `brute_upcs_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, {
        ...baseCfg,
        clientId: `brute_upcp_${randomId()}`,
        protocolVersion: 5,
      });

      const msgPromise = nextMessage(sub, 3000);
      await publish(pub, topic, '{"hello":"world"}', {
        qos: 1,
        properties: {
          contentType: 'application/json',
          responseTopic,
          correlationData: Buffer.from('req-001'),
          userProperties: { traceId: 'abc-123' },
        },
      });

      const { packet } = await msgPromise;
      const props = packet.properties;
      if (!props) {
        throw new Error('No properties on received packet');
      }
      if (props.contentType !== 'application/json') {
        throw new Error('contentType mismatch');
      }
      if (props.responseTopic !== responseTopic) {
        throw new Error('responseTopic mismatch');
      }
      if (props.userProperties?.traceId !== 'abc-123') {
        throw new Error('traceId mismatch');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
