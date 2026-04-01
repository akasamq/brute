import { connect, disconnect, subscribe, roundTrip } from '../client.js';
import { randomId, stats } from '../utils.js';

export const name = 'Round-Trip Latency';

const latencyTest = (label, qos, url, baseCfg) => ({
  name: `RTT ${label} (10 samples, QoS ${qos})`,
  fn: async () => {
    const topic = `brute/lat${qos}/${randomId()}`;
    const N = 10;

    const sub = await connect(url, { ...baseCfg, clientId: `brute_lats_${randomId()}` });
    const pub = await connect(url, { ...baseCfg, clientId: `brute_latp_${randomId()}` });
    await subscribe(sub, topic, { qos });

    const samples = [];
    for (let i = 0; i < N; i++) {
      const rtt = await roundTrip(pub, sub, topic, `ping_${i}`, { qos });
      samples.push(rtt);
    }

    const s = stats(samples);
    // Sanity: if average > 5 s something is seriously wrong
    if (s.avg > 5000) {
      throw new Error(`Average RTT ${s.avg.toFixed(0)} ms is unreasonably high`);
    }

    // Attach stats to result for reporters (stored on fn for post-processing)
    latencyTest[`${label}_stats`] = s;

    await Promise.all([disconnect(sub), disconnect(pub)]);
  },
});

export const tests = (url, baseCfg) => [
  latencyTest('QoS 0', 0, url, baseCfg),
  latencyTest('QoS 1', 1, url, baseCfg),
  latencyTest('QoS 2', 2, url, baseCfg),
];
