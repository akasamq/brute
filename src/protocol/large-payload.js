import { connect, disconnect, subscribe, publish, nextMessage } from '../client.js';
import { randomId, randomPayload } from '../utils.js';

export const name = 'Payload Sizes';

const payloadTest = (label, bytes, url, baseCfg) => ({
  name: label,
  fn: async () => {
    const topic = `brute/large/${randomId()}`;
    const payload = bytes === 0 ? Buffer.alloc(0) : randomPayload(bytes);

    const sub = await connect(url, { ...baseCfg, clientId: `brute_lgs_${randomId()}` });
    await subscribe(sub, topic, { qos: 1 });

    const pub = await connect(url, { ...baseCfg, clientId: `brute_lgp_${randomId()}` });
    const msgPromise = nextMessage(sub, 15000);
    await publish(pub, topic, payload, { qos: 1 });

    const { payload: recvd } = await msgPromise;
    if (recvd.length !== payload.length) {
      throw new Error(`Length mismatch: sent ${payload.length}, got ${recvd.length}`);
    }
    if (bytes > 0 && !recvd.equals(payload)) {
      throw new Error('Payload content corrupted in transit');
    }

    await Promise.all([disconnect(sub), disconnect(pub)]);
  },
});

export const tests = (url, baseCfg) => [
  payloadTest('Zero-byte (empty) payload', 0, url, baseCfg),
  payloadTest('1 KB payload', 1 * 1024, url, baseCfg),
  payloadTest('64 KB payload', 64 * 1024, url, baseCfg),
  payloadTest('128 KB payload', 128 * 1024, url, baseCfg),
  payloadTest('256 KB payload', 256 * 1024, url, baseCfg),

  {
    name: 'Binary payload (all byte values 0x00–0xFF)',
    fn: async () => {
      const topic = `brute/binary/${randomId()}`;
      // 256-byte buffer with every byte value
      const payload = Buffer.from(Array.from({ length: 256 }, (_, i) => i));

      const sub = await connect(url, { ...baseCfg, clientId: `brute_bins_${randomId()}` });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_binp_${randomId()}` });
      const msgPromise = nextMessage(sub, 5000);
      await publish(pub, topic, payload, { qos: 1 });

      const { payload: recvd } = await msgPromise;
      if (!recvd.equals(payload)) {
        throw new Error('Binary payload content corrupted');
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },

  {
    name: 'UTF-8 payload (emoji + CJK characters)',
    fn: async () => {
      const topic = `brute/utf8/${randomId()}`;
      const text = '你好世界 🌍 MQTT テスト مرحبا';
      const payload = Buffer.from(text, 'utf8');

      const sub = await connect(url, { ...baseCfg, clientId: `brute_u8s_${randomId()}` });
      await subscribe(sub, topic, { qos: 1 });

      const pub = await connect(url, { ...baseCfg, clientId: `brute_u8p_${randomId()}` });
      const msgPromise = nextMessage(sub, 5000);
      await publish(pub, topic, payload, { qos: 1 });

      const { payload: recvd } = await msgPromise;
      if (recvd.toString('utf8') !== text) {
        throw new Error(`UTF-8 mismatch: '${recvd.toString('utf8')}'`);
      }

      await Promise.all([disconnect(sub), disconnect(pub)]);
    },
  },
];
