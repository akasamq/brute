/**
 * Sleep for ms milliseconds.
 * @param {number} ms
 * @returns {Promise<void>}
 */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Generate a random alphanumeric string of given length.
 * @param {number} len
 * @returns {string}
 */
export const randomId = (len = 8) =>
  Math.random()
    .toString(36)
    .slice(2, 2 + len)
    .padEnd(len, '0');

/**
 * Generate a Buffer of random bytes.
 * @param {number} bytes
 * @returns {Buffer}
 */
export const randomPayload = (bytes) => {
  const buf = Buffer.allocUnsafe(bytes);
  for (let i = 0; i < bytes; i++) {
    buf[i] = (Math.random() * 256) | 0;
  }
  return buf;
};

/**
 * Compute basic statistics from an array of numbers.
 * @param {number[]} values
 * @returns {{min:number, max:number, avg:number, p50:number, p95:number, p99:number, stddev:number}}
 */
export const stats = (values) => {
  if (!values.length) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0, stddev: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  const avg = sum / n;
  const variance = sorted.reduce((acc, v) => acc + (v - avg) ** 2, 0) / n;
  const pct = (p) => sorted[Math.floor((p / 100) * n)] ?? sorted[n - 1];
  return {
    min: sorted[0],
    max: sorted[n - 1],
    avg,
    p50: pct(50),
    p95: pct(95),
    p99: pct(99),
    stddev: Math.sqrt(variance),
  };
};

/**
 * Format a number to fixed decimal places.
 * @param {number} n
 * @param {number} [d=2]
 * @returns {string}
 */
export const fixed = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : '—');

/**
 * Format bytes into human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
export const formatBytes = (bytes) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
};

/**
 * Format ms duration.
 * @param {number} ms
 * @returns {string}
 */
export const formatMs = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`);

/**
 * Wrap an async function and capture result + error into a test result object.
 * @param {string} name
 * @param {() => Promise<void>} fn
 * @returns {Promise<{name:string, passed:boolean, error?:string, durationMs:number}>}
 */
export const runTest = async (name, fn) => {
  const t0 = performance.now();
  try {
    await fn();
    return { name, passed: true, durationMs: performance.now() - t0 };
  } catch (err) {
    return { name, passed: false, error: err.message, durationMs: performance.now() - t0 };
  }
};

/**
 * Run an array of test specs sequentially.
 * @param {Array<{name:string, fn:()=>Promise<void>}>} specs
 * @returns {Promise<Array>}
 */
export const runAll = (specs) =>
  specs.reduce(
    (chain, spec) =>
      chain.then(async (results) => {
        const r = await runTest(spec.name, spec.fn);
        return [...results, r];
      }),
    Promise.resolve([])
  );

/**
 * Throttle: run fn concurrently up to `limit` at a time over items array.
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T)=>Promise<void>} fn
 * @returns {Promise<void>}
 */
export const throttledMap = async (items, limit, fn) => {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) {
      await fn(queue.shift());
    }
  });
  await Promise.all(workers);
};
