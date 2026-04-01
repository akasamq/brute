import { connect, disconnect, subscribe, publish } from './client.js';
import { randomId, stats, sleep } from './utils.js';
import { printArenaReport, printProgress, info, error as reportError } from './reporters.js';

/**
 * @typedef {object} ArenaOptions
 * @property {number} [messages=1000]     total messages per publisher
 * @property {number} [payloadBytes=64]   payload size in bytes
 * @property {number} [publishers=1]      concurrent publisher clients
 * @property {number} [subscribers=1]     concurrent subscriber clients
 * @property {number} [qos=0]            QoS level
 * @property {number} [timeoutMs=30000]   max time per broker run
 * @property {number} [warmupMs=200]      time to wait after subscribers connect
 */

/**
 * Build a fixed-size payload with a 8-byte timestamp prefix (ms as float64 BE).
 * @param {number} totalBytes
 * @returns {Buffer}
 */
const buildPayload = (totalBytes) => {
  const buf = Buffer.allocUnsafe(Math.max(totalBytes, 8));
  // first 8 bytes = timestamp placeholder (written at send time)
  buf.fill(0x41, 8); // fill rest with 'A'
  return buf;
};

/**
 * Stamp current time into the first 8 bytes of a buffer (mutates).
 * @param {Buffer} buf
 * @returns {Buffer}
 */
const stampTime = (buf) => {
  buf.writeDoubleBE(performance.now(), 0);
  return buf;
};

/**
 * Read the timestamp from the first 8 bytes.
 * @param {Buffer} buf
 * @returns {number} ms
 */
const readTime = (buf) => buf.readDoubleBE(0);

/**
 * Run the benchmark against one broker.
 *
 * @param {string} url
 * @param {string} label
 * @param {ArenaOptions} opts
 * @param {object} [authCfg={}]
 * @returns {Promise<object>}  result record
 */
const benchmarkBroker = async (url, label, opts, authCfg = {}) => {
  const {
    messages = 1000,
    payloadBytes = 64,
    publishers = 1,
    subscribers = 1,
    qos = 0,
    timeoutMs = 30000,
    warmupMs = 200,
  } = opts;

  const topic = `brute/arena/${randomId()}`;
  const totalMsg = messages * publishers;

  info(`  [${label}] connecting ${subscribers} sub(s) + ${publishers} pub(s) …`);

  const subClients = await Promise.all(
    Array.from({ length: subscribers }, (_, i) =>
      connect(url, { ...authCfg, clientId: `brute_arena_sub${i}_${randomId()}` })
    )
  );

  const latencies = [];
  let received = 0;

  for (const sc of subClients) {
    sc.on('message', (_topic, payload) => {
      const sent = readTime(payload);
      latencies.push(performance.now() - sent);
      received++;
    });
  }

  await Promise.all(subClients.map((sc) => subscribe(sc, topic, { qos })));

  await sleep(warmupMs);

  const pubClients = await Promise.all(
    Array.from({ length: publishers }, (_, i) =>
      connect(url, { ...authCfg, clientId: `brute_arena_pub${i}_${randomId()}` })
    )
  );

  // publish
  const payload = buildPayload(payloadBytes);
  const t0 = performance.now();

  const publisherTasks = pubClients.map(async (pc) => {
    for (let i = 0; i < messages; i++) {
      await publish(pc, topic, stampTime(payload), { qos });
    }
  });

  await Promise.all(publisherTasks);
  const publishDoneMs = performance.now() - t0;

  const expected = totalMsg * subscribers;
  const deadline = performance.now() + timeoutMs;

  while (received < expected && performance.now() < deadline) {
    printProgress(label, received, expected);
    await sleep(100);
  }
  printProgress(label, received, expected);

  const totalMs = performance.now() - t0;

  // cleanup
  await Promise.all([
    ...subClients.map((sc) => disconnect(sc)),
    ...pubClients.map((pc) => disconnect(pc)),
  ]);

  const lost = expected - received;
  const msgPerSec = (received / totalMs) * 1000;
  const bytesPerSec = msgPerSec * payloadBytes;

  return {
    url,
    label,
    msgPerSec,
    bytesPerSec,
    latency: stats(latencies),
    sent: expected,
    lost: Math.max(0, lost),
    totalMs,
    publishDoneMs,
    error: null,
  };
};

/**
 * Run the throughput arena against multiple brokers sequentially,
 * then print a comparison report.
 *
 * @param {Array<{url:string, label?:string, auth?:object}>} brokers
 * @param {ArenaOptions} [opts={}]
 * @returns {Promise<void>}
 */
export const runArena = async (brokers, opts = {}) => {
  const results = [];

  for (const broker of brokers) {
    const label = broker.label || broker.url;
    info(`\nBenchmarking: ${label}`);
    try {
      const result = await benchmarkBroker(broker.url, label, opts, broker.auth ?? {});
      results.push(result);
    } catch (err) {
      reportError(`${label}: ${err.message}`);
      results.push({ url: broker.url, label, error: err.message });
    }
  }

  printArenaReport(results, {
    messages: opts.messages ?? 1000,
    payloadBytes: opts.payloadBytes ?? 64,
    publishers: opts.publishers ?? 1,
    subscribers: opts.subscribers ?? 1,
    qos: opts.qos ?? 0,
  });
};
