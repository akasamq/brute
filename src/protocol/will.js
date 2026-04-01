import {
  connect,
  disconnect,
  forceDisconnect,
  subscribe,
  publish,
  nextMessage,
} from '../client.js';
import { randomId, sleep } from '../utils.js';

export const name = 'Last Will & Testament (LWT)';

export const tests = (url, baseCfg) => [
  {
    name: 'Will published on unexpected disconnect (QoS 1)',
    fn: async () => {
      const willTopic = `brute/will/${randomId()}`;
      const willPayload = `will_${randomId()}`;

      const watcher = await connect(url, { ...baseCfg, clientId: `brute_ww_${randomId()}` });
      await subscribe(watcher, willTopic, { qos: 1 });

      const dying = await connect(url, {
        ...baseCfg,
        clientId: `brute_wd_${randomId()}`,
        will: { topic: willTopic, payload: willPayload, qos: 1, retain: false },
      });

      const willPromise = nextMessage(watcher, 8000);
      forceDisconnect(dying); // no DISCONNECT packet → will fires

      const { payload: recvd } = await willPromise;
      if (recvd.toString() !== willPayload) {
        throw new Error(`Will payload mismatch: '${recvd.toString()}'`);
      }

      await disconnect(watcher);
    },
  },

  {
    name: 'Will NOT sent on clean DISCONNECT',
    fn: async () => {
      const willTopic = `brute/nowill/${randomId()}`;

      const watcher = await connect(url, { ...baseCfg, clientId: `brute_nww_${randomId()}` });
      await subscribe(watcher, willTopic, { qos: 1 });

      const clean = await connect(url, {
        ...baseCfg,
        clientId: `brute_nwd_${randomId()}`,
        will: { topic: willTopic, payload: 'should-not-arrive', qos: 1, retain: false },
      });

      await disconnect(clean); // proper DISCONNECT — no will

      let received = false;
      watcher.once('message', () => {
        received = true;
      });
      await sleep(1000);

      if (received) {
        throw new Error('Will was published after clean disconnect');
      }
      await disconnect(watcher);
    },
  },

  {
    name: 'Will with retain=true',
    fn: async () => {
      const willTopic = `brute/willret/${randomId()}`;
      const willPayload = `willret_${randomId()}`;

      const dying = await connect(url, {
        ...baseCfg,
        clientId: `brute_wdr_${randomId()}`,
        will: { topic: willTopic, payload: willPayload, qos: 1, retain: true },
      });
      forceDisconnect(dying);

      await sleep(800); // let will propagate

      // Late subscriber should get retained will
      const sub = await connect(url, { ...baseCfg, clientId: `brute_wrs_${randomId()}` });
      const msgPromise = nextMessage(sub, 4000);
      await subscribe(sub, willTopic, { qos: 1 });

      const { payload: recvd, packet } = await msgPromise;
      if (recvd.toString() !== willPayload) {
        throw new Error('Will payload mismatch');
      }
      if (!packet.retain) {
        throw new Error('retain flag not set on will message');
      }

      // Cleanup retained will
      await publish(sub, willTopic, '', { qos: 1, retain: true });
      await disconnect(sub);
    },
  },

  {
    name: 'Will QoS 0',
    fn: async () => {
      const willTopic = `brute/willq0/${randomId()}`;
      const willPayload = `wq0_${randomId()}`;

      const watcher = await connect(url, { ...baseCfg, clientId: `brute_wq0w_${randomId()}` });
      await subscribe(watcher, willTopic, { qos: 0 });

      const dying = await connect(url, {
        ...baseCfg,
        clientId: `brute_wq0d_${randomId()}`,
        will: { topic: willTopic, payload: willPayload, qos: 0, retain: false },
      });

      const willPromise = nextMessage(watcher, 8000);
      forceDisconnect(dying);

      const { payload: recvd } = await willPromise;
      if (recvd.toString() !== willPayload) {
        throw new Error('Will payload mismatch');
      }

      await disconnect(watcher);
    },
  },

  {
    name: 'Will QoS 2',
    fn: async () => {
      const willTopic = `brute/willq2/${randomId()}`;
      const willPayload = `wq2_${randomId()}`;

      const watcher = await connect(url, { ...baseCfg, clientId: `brute_wq2w_${randomId()}` });
      await subscribe(watcher, willTopic, { qos: 2 });

      const dying = await connect(url, {
        ...baseCfg,
        clientId: `brute_wq2d_${randomId()}`,
        will: { topic: willTopic, payload: willPayload, qos: 2, retain: false },
      });

      const willPromise = nextMessage(watcher, 8000);
      forceDisconnect(dying);

      const { payload: recvd } = await willPromise;
      if (recvd.toString() !== willPayload) {
        throw new Error('Will payload mismatch');
      }

      await disconnect(watcher);
    },
  },

  {
    name: 'MQTT 5 — Will Delay Interval',
    fn: async () => {
      const willTopic = `brute/willdelay/${randomId()}`;
      const willPayload = `wd_${randomId()}`;
      const delaySeconds = 2;

      const watcher = await connect(url, {
        ...baseCfg,
        clientId: `brute_wdiw_${randomId()}`,
        protocolVersion: 5,
      });
      await subscribe(watcher, willTopic, { qos: 1 });

      const dying = await connect(url, {
        ...baseCfg,
        clientId: `brute_wdid_${randomId()}`,
        protocolVersion: 5,
        will: {
          topic: willTopic,
          payload: willPayload,
          qos: 1,
          retain: false,
          properties: { willDelayInterval: delaySeconds },
        },
      });

      const t0 = Date.now();
      forceDisconnect(dying);

      const { payload: recvd } = await nextMessage(watcher, (delaySeconds + 5) * 1000);
      const elapsed = Date.now() - t0;

      if (recvd.toString() !== willPayload) {
        throw new Error('Will payload mismatch');
      }
      if (elapsed < (delaySeconds - 1) * 1000) {
        throw new Error(`Will arrived too early: ${elapsed} ms (delay=${delaySeconds} s)`);
      }

      await disconnect(watcher);
    },
  },
];
