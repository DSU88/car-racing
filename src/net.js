/**
 * Client networking for Street Racing.
 * Wraps Socket.IO, keeps a synchronized server clock, and exposes small helpers.
 *
 * Server URL:
 *   - production: same origin as the page (server.js serves the game)
 *   - dev (vite):  http://<same host>:3000
 *   - override:    VITE_SERVER_URL in a .env file
 */
import { io } from 'socket.io-client';

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ||
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3000` : undefined);

let socket = null;
let offset = 0; // serverTime - localTime

/* tiny event emitter ------------------------------------------------ */
const handlers = new Map();
export function on(evt, fn) {
  if (!handlers.has(evt)) handlers.set(evt, []);
  handlers.get(evt).push(fn);
}
const emit = (evt, ...args) => handlers.get(evt)?.forEach(fn => fn(...args));

/* clock ------------------------------------------------------------- */
export const now = () => Date.now() + offset;

async function syncClock(samples = 6) {
  let best = { rtt: Infinity, off: 0 };
  for (let i = 0; i < samples; i++) {
    const t0 = Date.now();
    const serverTime = await new Promise(res =>
      socket.timeout(2000).emit('time:ping', null, (err, t) => res(err ? null : t))
    );
    const t1 = Date.now();
    if (serverTime == null) continue;
    const rtt = t1 - t0;
    if (rtt < best.rtt) best = { rtt, off: serverTime + rtt / 2 - t1 };
  }
  if (best.rtt < Infinity) offset = best.off;
}

/* connection -------------------------------------------------------- */
export function connect() {
  if (socket?.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    socket?.close();
    const s = io(SERVER_URL, { reconnection: false, timeout: 6000 });
    socket = s;

    s.once('connect', async () => {
      await syncClock();
      resolve();
    });
    s.once('connect_error', () => {
      s.close();
      reject(new Error('Cannot reach the game server. Is server.js running?'));
    });

    s.on('disconnect', reason => emit('disconnect', reason));
    s.on('room:update', room => emit('room', room));
    s.on('race:start', data => emit('start', data));
    s.on('player:state', state => emit('state', state));
    s.on('race:finish', info => emit('finish', info));
    s.on('race:end', data => emit('end', data));
  });
}

function request(evt, payload) {
  return new Promise(resolve => {
    if (!socket?.connected) return resolve({ ok: false, error: 'Not connected to the server.' });
    socket.timeout(6000).emit(evt, payload, (err, res) =>
      resolve(err ? { ok: false, error: 'The server did not respond.' } : res)
    );
  });
}

/* api --------------------------------------------------------------- */
export const createRoom = name => request('room:create', { name });
export const joinRoom = (code, name) => request('room:join', { code, name });
export const startRace = () => request('room:start');
export const rematch = () => request('room:rematch');
export const leaveRoom = () => socket?.connected && socket.emit('room:leave');
export const sendState = s => socket?.connected && socket.volatile.emit('player:state', s);