import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId } from '../utils.js';

export const name = 'MQTT 5 — Request / Response';

export const tests = (url, baseCfg) => [
  {
    name: 'Basic request/response with ResponseTopic',
    fn: async () => {
      const reqTopic = `brute/rr/req/${randomId()}`;
      const respTopic = `brute/rr/resp/${randomId()}`;

      // Requester
      const requester = await connect(url, {
        ...baseCfg,
        clientId: `brute_rrq_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(requester, respTopic, { qos: 1 });

      // Responder (simulates a service)
      const responder = await connect(url, {
        ...baseCfg,
        clientId: `brute_rrr_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(responder, reqTopic, { qos: 1 });

      // Responder echoes back on ResponseTopic
      responder.on('message', async (_topic, payload, packet) => {
        const rt = packet.properties?.responseTopic;
        if (!rt) {
          return;
        }
        await publish(responder, rt, `echo:${payload.toString()}`, {
          qos: 1,
          properties: {
            correlationData: packet.properties.correlationData,
          },
        });
      });

      // Send request
      const corrData = Buffer.from(randomId());
      const replyPromise = nextMessage(requester, 4000);

      await publish(requester, reqTopic, 'hello', {
        qos: 1,
        properties: {
          responseTopic: respTopic,
          correlationData: corrData,
        },
      });

      const { payload: reply, packet: replyPacket } = await replyPromise;
      if (reply.toString() !== 'echo:hello') {
        throw new Error(`Wrong reply: ${reply.toString()}`);
      }

      const echoed = replyPacket.properties?.correlationData;
      if (!echoed || !echoed.equals(corrData)) {
        throw new Error('CorrelationData not echoed correctly');
      }

      await Promise.all([disconnect(requester), disconnect(responder)]);
    },
  },

  {
    name: 'Multiple in-flight requests matched by CorrelationData',
    fn: async () => {
      const reqTopic = `brute/rrmulti/req/${randomId()}`;
      const respTopic = `brute/rrmulti/resp/${randomId()}`;

      const requester = await connect(url, {
        ...baseCfg,
        clientId: `brute_rrmq_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(requester, respTopic, { qos: 1 });

      const responder = await connect(url, {
        ...baseCfg,
        clientId: `brute_rrmr_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(responder, reqTopic, { qos: 1 });

      responder.on('message', async (_topic, payload, packet) => {
        const rt = packet.properties?.responseTopic;
        if (!rt) {
          return;
        }
        await publish(responder, rt, `resp:${payload.toString()}`, {
          qos: 1,
          properties: { correlationData: packet.properties.correlationData },
        });
      });

      // Send 3 requests
      const requests = [
        { id: Buffer.from('req-1'), payload: 'A' },
        { id: Buffer.from('req-2'), payload: 'B' },
        { id: Buffer.from('req-3'), payload: 'C' },
      ];

      const replyMap = new Map();
      const allReplies = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout waiting for replies')), 5000);
        requester.on('message', (_t, pl, pkt) => {
          const cd = pkt.properties?.correlationData;
          if (cd) {
            replyMap.set(cd.toString(), pl.toString());
          }
          if (replyMap.size >= requests.length) {
            clearTimeout(timer);
            resolve();
          }
        });
      });

      for (const req of requests) {
        await publish(requester, reqTopic, req.payload, {
          qos: 1,
          properties: { responseTopic: respTopic, correlationData: req.id },
        });
      }

      await allReplies;

      for (const req of requests) {
        const key = req.id.toString();
        if (!replyMap.has(key)) {
          throw new Error(`No reply for ${key}`);
        }
        if (replyMap.get(key) !== `resp:${req.payload}`) {
          throw new Error(`Wrong reply for ${key}: ${replyMap.get(key)}`);
        }
      }

      await Promise.all([disconnect(requester), disconnect(responder)]);
    },
  },
];
