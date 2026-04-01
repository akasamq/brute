import mqtt from 'mqtt';

/**
 * Build connection options from a config object.
 * @param {object} cfg
 * @returns {object} mqtt connect options
 */
const buildConnectOptions = (cfg) => ({
  clientId: cfg.clientId ?? `brute_${Math.random().toString(16).slice(2, 10)}`,
  username: cfg.username,
  password: cfg.password,
  clean: cfg.clean ?? true,
  keepalive: cfg.keepalive ?? 60,
  connectTimeout: cfg.connectTimeout ?? 5000,
  reconnectPeriod: 0, // never auto-reconnect during tests
  protocolVersion: cfg.protocolVersion ?? 4,
  will: cfg.will,
  properties: cfg.properties, // MQTT 5 only
});

/**
 * Connect to an MQTT broker and return a promise that resolves with the client.
 * Rejects on connection error or timeout.
 *
 * @param {string} url  e.g. 'mqtt://localhost:1883'
 * @param {object} [cfg={}]
 * @returns {Promise<mqtt.MqttClient>}
 */
export const connect = (url, cfg = {}) =>
  new Promise((resolve, reject) => {
    const opts = buildConnectOptions(cfg);
    const client = mqtt.connect(url, opts);

    const onConnect = () => {
      cleanup();
      resolve(client);
    };
    const onError = (err) => {
      cleanup();
      client.end(true);
      reject(err);
    };

    const timer = setTimeout(() => {
      cleanup();
      client.end(true);
      reject(new Error(`Connection timeout to ${url}`));
    }, opts.connectTimeout);

    const cleanup = () => {
      clearTimeout(timer);
      client.removeListener('connect', onConnect);
      client.removeListener('error', onError);
    };

    client.once('connect', onConnect);
    client.once('error', onError);
  });

/**
 * Disconnect a client gracefully and return a promise.
 * @param {mqtt.MqttClient} client
 * @returns {Promise<void>}
 */
export const disconnect = (client) => new Promise((resolve) => client.end(false, {}, resolve));

/**
 * Force-disconnect (useful when we don't care about clean disconnect).
 * @param {mqtt.MqttClient} client
 */
export const forceDisconnect = (client) => client.end(true);

/**
 * Subscribe to a topic and return a promise that resolves with granted QoS.
 * @param {mqtt.MqttClient} client
 * @param {string|string[]} topic
 * @param {object} [opts]
 * @returns {Promise<object[]>}
 */
export const subscribe = (client, topic, opts = { qos: 0 }) =>
  new Promise((resolve, reject) =>
    client.subscribe(topic, opts, (err, granted) => (err ? reject(err) : resolve(granted)))
  );

/**
 * Unsubscribe from a topic.
 * @param {mqtt.MqttClient} client
 * @param {string|string[]} topic
 * @returns {Promise<void>}
 */
export const unsubscribe = (client, topic) =>
  new Promise((resolve, reject) =>
    client.unsubscribe(topic, (err) => (err ? reject(err) : resolve()))
  );

/**
 * Publish a message and return a promise.
 * @param {mqtt.MqttClient} client
 * @param {string} topic
 * @param {string|Buffer} payload
 * @param {object} [opts]
 * @returns {Promise<void>}
 */
export const publish = (client, topic, payload, opts = { qos: 0 }) =>
  new Promise((resolve, reject) =>
    client.publish(topic, payload, opts, (err) => (err ? reject(err) : resolve()))
  );

/**
 * Wait for the next message on the given topic pattern (already subscribed).
 * Resolves with { topic, payload, packet }.
 * Rejects after timeoutMs.
 *
 * @param {mqtt.MqttClient} client
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<{topic:string, payload:Buffer, packet:object}>}
 */
export const nextMessage = (client, timeoutMs = 3000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.removeListener('message', onMessage);
      reject(new Error('Message timeout'));
    }, timeoutMs);

    const onMessage = (topic, payload, packet) => {
      clearTimeout(timer);
      client.removeListener('message', onMessage);
      resolve({ topic, payload, packet });
    };

    client.on('message', onMessage);
  });

/**
 * Publish and wait for a single echoed message on the same topic.
 * Useful for round-trip latency measurement.
 *
 * @param {mqtt.MqttClient} pub
 * @param {mqtt.MqttClient} sub  (already subscribed to topic)
 * @param {string} topic
 * @param {string|Buffer} payload
 * @param {object} [pubOpts]
 * @returns {Promise<number>} round-trip time in ms
 */
export const roundTrip = async (pub, sub, topic, payload, pubOpts = { qos: 0 }) => {
  const msgPromise = nextMessage(sub, 5000);
  const t0 = performance.now();
  await publish(pub, topic, payload, pubOpts);
  await msgPromise;
  return performance.now() - t0;
};

/**
 * Collect N messages into an array, then resolve.
 * @param {mqtt.MqttClient} client
 * @param {number} count
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<Array<{topic,payload,packet}>>}
 */
export const collectMessages = (client, count, timeoutMs = 10000) =>
  new Promise((resolve, reject) => {
    const msgs = [];
    const timer = setTimeout(() => {
      client.removeListener('message', onMessage);
      reject(new Error(`Timeout: received ${msgs.length}/${count} messages`));
    }, timeoutMs);

    const onMessage = (topic, payload, packet) => {
      msgs.push({ topic, payload, packet });
      if (msgs.length >= count) {
        clearTimeout(timer);
        client.removeListener('message', onMessage);
        resolve(msgs);
      }
    };

    client.on('message', onMessage);
  });
