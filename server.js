/**
 * Street Racing – multiplayer server
 *
 *  - Serves the built game (./dist) so one URL is enough in production.
 *  - Manages rooms (4-letter codes), lobby, synchronized race start and results.
 *  - Relays player state to the other players in the room (client-side simulation,
 *    server-side sanity checks so nobody can teleport or finish instantly).
 *
 * Run:   node server.js           (PORT, CORS_ORIGIN and RACE_LENGTH are optional env vars)
 * Needs: npm i express socket.io  (and "type": "module" in package.json)
 */
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */
const CONFIG = {
  port: Number(process.env.PORT) || 3000,
  // In production the client is served from this same server, so CORS is not needed.
  // For local dev (Vite on :5173) every origin is allowed unless CORS_ORIGIN is set.
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(s => s.trim()) : true,
  maxPlayers: 4,
  raceLength: Number(process.env.RACE_LENGTH) || 4000, // metres
  countdownMs: 4000,
  finishGraceMs: 20_000,   // after the first finisher, others get this long
  maxSpeed: 100,           // m/s (nitro top speed) – used by the anti-cheat check
  minStateGapMs: 20,       // max 50 state packets per second per player
  roomTtlMs: 6 * 60 * 60 * 1000,
};

const COLORS = ['#e32135', '#2f6fed', '#f2b705', '#22a559'];
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1 – easy to read out loud

const log = (...args) => console.log(new Date().toISOString(), ...args);

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */
const rooms = new Map();

const num = (v, min, max, fallback = 0) =>
  Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

const safeAck = cb => (typeof cb === 'function' ? cb : () => {});

function cleanName(raw) {
  const n = String(raw ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
  return n || `Driver${randomInt(100, 999)}`;
}

function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (!rooms.has(code)) return code;
  }
}

function publicRoom(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    length: room.length,
    players: [...room.players.values()].map(({ id, name, color }) => ({ id, name, color })),
  };
}

function rateLimited(socket, key, max, windowMs) {
  const now = Date.now();
  const buckets = (socket.data.rl ??= {});
  const b = (buckets[key] ??= { n: 0, reset: now + windowMs });
  if (now > b.reset) { b.n = 0; b.reset = now + windowMs; }
  return ++b.n > max;
}

function schedule(room, ms, fn) {
  const t = setTimeout(() => { room.timers.delete(t); fn(); }, ms);
  room.timers.add(t);
}

function destroyRoom(room) {
  room.timers.forEach(clearTimeout);
  room.timers.clear();
  rooms.delete(room.code);
  log(`room ${room.code} closed (${rooms.size} open)`);
}

const roomOf = socket => rooms.get(socket.data.code);

/* ------------------------------------------------------------------ */
/*  HTTP app                                                           */
/* ------------------------------------------------------------------ */
const app = express();
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));

const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(path.join(distDir, 'index.html'))) {
  app.use(express.static(distDir, { maxAge: '1h' }));
  app.use((req, res, next) =>
    req.method === 'GET' && req.accepts('html') ? res.sendFile(path.join(distDir, 'index.html')) : next());
} else {
  app.get('/', (_req, res) =>
    res.type('text/plain').send('Game server is running.\nRun "npm run build" to serve the game from here too.'));
}

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: CONFIG.corsOrigin },
  pingInterval: 10_000,
  pingTimeout: 8_000,
  maxHttpBufferSize: 1e4, // our packets are tiny; reject anything big
});

/* ------------------------------------------------------------------ */
/*  Race flow                                                          */
/* ------------------------------------------------------------------ */
function resetPlayers(room) {
  for (const p of room.players.values()) {
    Object.assign(p, { d: 0, x: 0, lastAt: 0, finished: false, time: null, rank: null });
  }
  room.finishCount = 0;
}

function endRace(room) {
  if (room.state === 'finished') return;
  room.state = 'finished';
  room.timers.forEach(clearTimeout);
  room.timers.clear();

  const results = [...room.players.values()]
    .sort((a, b) => (a.finished && b.finished ? a.rank - b.rank : a.finished ? -1 : b.finished ? 1 : b.d - a.d))
    .map((p, i) => ({
      id: p.id, name: p.name, color: p.color, rank: i + 1,
      time: p.finished ? Math.round(p.time) : null,
      distance: Math.round(p.d),
    }));

  io.to(room.code).emit('race:end', { results });
  log(`room ${room.code} race finished`);
}

function finishPlayer(room, p, now) {
  p.finished = true;
  p.time = Math.max(0, now - room.startAt);
  p.rank = ++room.finishCount;
  io.to(room.code).emit('race:finish', { id: p.id, time: Math.round(p.time), rank: p.rank });

  if ([...room.players.values()].every(q => q.finished)) endRace(room);
  else if (room.finishCount === 1) schedule(room, CONFIG.finishGraceMs, () => endRace(room));
}

function leaveRoom(socket) {
  const code = socket.data.code;
  if (!code) return;
  socket.leave(code);
  socket.data.code = null;

  const room = rooms.get(code);
  if (!room) return;
  room.players.delete(socket.id);

  if (room.players.size === 0) return destroyRoom(room);
  if (room.hostId === socket.id) room.hostId = room.players.keys().next().value;

  io.to(code).emit('room:update', publicRoom(room));
  if (room.state === 'racing' && [...room.players.values()].every(p => p.finished)) endRace(room);
}

/* ------------------------------------------------------------------ */
/*  Socket events                                                      */
/* ------------------------------------------------------------------ */
io.on('connection', socket => {
  log(`+ ${socket.id} connected (${io.engine.clientsCount} online)`);

  socket.on('time:ping', (_payload, cb) => safeAck(cb)(Date.now()));

  socket.on('room:create', (payload, cb) => {
    const ack = safeAck(cb);
    if (rateLimited(socket, 'join', 6, 10_000)) return ack({ ok: false, error: 'Too many attempts. Wait a moment.' });

    leaveRoom(socket);
    const room = {
      code: makeCode(), hostId: socket.id, state: 'lobby', length: CONFIG.raceLength,
      players: new Map(), seed: 0, startAt: 0, finishCount: 0, timers: new Set(), createdAt: Date.now(),
    };
    rooms.set(room.code, room);
    addPlayer(room, socket, cleanName(payload?.name));
    log(`room ${room.code} created (${rooms.size} open)`);
    ack({ ok: true, you: socket.id, room: publicRoom(room) });
  });

  socket.on('room:join', (payload, cb) => {
    const ack = safeAck(cb);
    if (rateLimited(socket, 'join', 6, 10_000)) return ack({ ok: false, error: 'Too many attempts. Wait a moment.' });

    const code = String(payload?.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Room not found. Check the code.' });
    if (room.state !== 'lobby') return ack({ ok: false, error: 'That race has already started.' });
    if (room.players.size >= CONFIG.maxPlayers) return ack({ ok: false, error: 'Room is full.' });

    leaveRoom(socket);
    addPlayer(room, socket, cleanName(payload?.name));
    ack({ ok: true, you: socket.id, room: publicRoom(room) });
    io.to(code).emit('room:update', publicRoom(room));
  });

  socket.on('room:start', (_payload, cb) => {
    const ack = safeAck(cb);
    const room = roomOf(socket);
    if (!room) return ack({ ok: false, error: 'You are not in a room.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Only the host can start.' });
    if (room.state !== 'lobby') return ack({ ok: false, error: 'Race already running.' });
    if (room.players.size < 2) return ack({ ok: false, error: 'Wait for at least one more player.' });

    resetPlayers(room);
    room.state = 'countdown';
    room.seed = randomInt(1, 2 ** 31 - 1);
    room.startAt = Date.now() + CONFIG.countdownMs;

    io.to(room.code).emit('race:start', { seed: room.seed, startAt: room.startAt, length: room.length });
    schedule(room, CONFIG.countdownMs, () => { if (room.state === 'countdown') room.state = 'racing'; });
    log(`room ${room.code} race started (${room.players.size} players)`);
    ack({ ok: true });
  });

  socket.on('player:state', s => {
    const room = roomOf(socket);
    const p = room?.players.get(socket.id);
    if (!p || (room.state !== 'countdown' && room.state !== 'racing')) return;

    const now = Date.now();
    if (room.state === 'countdown') {
      if (now < room.startAt - 150) return;
      room.state = 'racing';
    }
    if (now - p.lastAt < CONFIG.minStateGapMs) return;
    const dt = p.lastAt ? Math.min((now - p.lastAt) / 1000, 1) : 0.05;
    p.lastAt = now;

    // Anti-cheat: distance can only grow, and not faster than the car physically can.
    const maxStep = CONFIG.maxSpeed * 1.25 * dt + 5;
    const d = num(s?.d, 0, room.length + 300);
    p.d = Math.min(Math.max(d, p.d), p.d + maxStep);
    p.x = num(s?.x, -8, 8);

    socket.to(room.code).volatile.emit('player:state', {
      id: socket.id,
      x: p.x,
      d: p.d,
      s: num(s?.s, 0, CONFIG.maxSpeed * 1.1),
      y: num(s?.y, -1000, 1000),
      b: s?.b ? 1 : 0,
      w: s?.w ? 1 : 0,
    });

    if (!p.finished && p.d >= room.length) finishPlayer(room, p, now);
  });

  socket.on('room:rematch', (_payload, cb) => {
    const ack = safeAck(cb);
    const room = roomOf(socket);
    if (!room || room.hostId !== socket.id) return ack({ ok: false, error: 'Only the host can do that.' });
    if (room.state !== 'finished') return ack({ ok: false, error: 'Race is not over yet.' });
    room.state = 'lobby';
    resetPlayers(room);
    io.to(room.code).emit('room:update', publicRoom(room));
    ack({ ok: true });
  });

  socket.on('room:leave', () => leaveRoom(socket));

  socket.on('disconnect', reason => {
    leaveRoom(socket);
    log(`- ${socket.id} left (${reason})`);
  });
});

function addPlayer(room, socket, name) {
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = COLORS.find(c => !used.has(c)) ?? COLORS[0];
  room.players.set(socket.id, {
    id: socket.id, name, color,
    d: 0, x: 0, lastAt: 0, finished: false, time: null, rank: null,
  });
  socket.join(room.code);
  socket.data.code = room.code;
}

/* ------------------------------------------------------------------ */
/*  Housekeeping + start                                               */
/* ------------------------------------------------------------------ */
setInterval(() => {
  const cutoff = Date.now() - CONFIG.roomTtlMs;
  for (const room of rooms.values()) if (room.createdAt < cutoff) destroyRoom(room);
}, 10 * 60 * 1000).unref();

function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal)
    .map(i => i.address);
}

server.listen(CONFIG.port, '0.0.0.0', () => {
  log(`Street Racing server on port ${CONFIG.port}`);
  console.log(`  Local:   http://localhost:${CONFIG.port}`);
  for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${CONFIG.port}   (friends on the same Wi-Fi)`);
});

function shutdown(signal) {
  log(`${signal} received, shutting down`);
  io.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));