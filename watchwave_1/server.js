const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 5000, pingTimeout: 10000, maxHttpBufferSize: 1e6 });
const PORT = process.env.PORT || 3000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'WatchWave', rooms: rooms.size }));

const clean = (value, max = 140) => String(value ?? '').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0, max);
const makeCode = () => Math.random().toString(36).slice(2, 7).toUpperCase();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      hostId: null,
      users: new Map(),
      messages: [{ id: 'welcome', system: true, text: 'Welcome to WatchWave. Pick a trailer, grab a seat, and let the movie night begin.', at: Date.now() }],
      playlist: [
        { id: 'p1', title: 'Interstellar', subtitle: 'The impossible journey', videoId: 'zSWdZVtXT7E', genre: 'Sci-Fi', year: '2014', addedBy: 'WatchWave' },
        { id: 'p2', title: 'Spider-Man: Across the Spider-Verse', subtitle: 'Miles goes beyond', videoId: 'shW9i6k8cB0', genre: 'Animation', year: '2023', addedBy: 'WatchWave' },
        { id: 'p3', title: 'Dune: Part Two', subtitle: 'Destiny is written in sand', videoId: 'Way9eso7i8g', genre: 'Sci-Fi', year: '2024', addedBy: 'WatchWave' }
      ],
      media: { videoId: 'zSWdZVtXT7E', title: 'Interstellar', playing: false, currentTime: 0, updatedAt: Date.now() },
      poll: null
    });
  }
  return rooms.get(code);
}
function currentMedia(room) {
  const media = { ...room.media };
  if (media.playing) media.currentTime += Math.max(0, Date.now() - media.updatedAt) / 1000;
  media.updatedAt = Date.now();
  return media;
}
function publicState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    users: [...room.users.entries()].map(([id, u]) => ({ id, name: u.name, color: u.color, joinedAt: u.joinedAt })),
    messages: room.messages.slice(-70),
    playlist: room.playlist,
    media: currentMedia(room),
    poll: room.poll ? { ...room.poll, votes: { ...room.poll.votes }, results: room.poll.options.map((option, index) => ({ option, count: Object.values(room.poll.votes).filter(v => v === index).length })) } : null
  };
}
function sendState(room) { io.to(room.code).emit('room:state', publicState(room)); }
function systemMessage(room, text) {
  room.messages.push({ id: `${Date.now()}-${Math.random()}`, system: true, text: clean(text, 200), at: Date.now() });
  room.messages = room.messages.slice(-100);
}
function sendMedia(room) { io.to(room.code).emit('media:sync', currentMedia(room)); }

io.on('connection', socket => {
  socket.on('room:join', (payload = {}, reply = () => {}) => {
    const name = clean(payload.name, 24) || 'Guest';
    const code = clean(payload.roomCode, 8).toUpperCase().replace(/[^A-Z0-9]/g, '') || makeCode();
    if (code.length < 4) return reply({ ok: false, error: 'Room codes need at least 4 characters.' });
    const room = getRoom(code);
    if (room.users.size >= 20) return reply({ ok: false, error: 'This room is full (20 people max for this demo).' });
    if (socket.data.roomCode) {
      const previous = rooms.get(socket.data.roomCode);
      if (previous) previous.users.delete(socket.id);
      socket.leave(socket.data.roomCode);
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.name = name;
    const colors = ['#f2a65a', '#91c7b1', '#b4a7ff', '#ff8d9d', '#85bdf2', '#e6cf6a'];
    room.users.set(socket.id, { name, color: colors[room.users.size % colors.length], joinedAt: Date.now() });
    if (!room.hostId || !room.users.has(room.hostId)) room.hostId = socket.id;
    systemMessage(room, `${name} joined the party`);
    reply({ ok: true, state: publicState(room), socketId: socket.id });
    sendState(room);
  });

  socket.on('chat:send', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.users.has(socket.id)) return;
    const text = clean(payload?.text, 300);
    if (!text) return;
    room.messages.push({ id: `${Date.now()}-${Math.random()}`, userId: socket.id, name: room.users.get(socket.id).name, text, at: Date.now() });
    room.messages = room.messages.slice(-100);
    io.to(room.code).emit('chat:new', room.messages[room.messages.length - 1]);
  });

  socket.on('reaction:send', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.users.has(socket.id)) return;
    const allowed = ['😂', '🔥', '👏', '😭', '🍿', '❤️', '🤯', '👀'];
    const emoji = allowed.includes(payload?.emoji) ? payload.emoji : '🍿';
    io.to(room.code).emit('reaction:new', { emoji, name: room.users.get(socket.id).name, id: `${Date.now()}-${Math.random()}` });
  });

  socket.on('media:update', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    const videoId = clean(payload?.videoId, 24);
    if (videoId) room.media.videoId = videoId;
    if (typeof payload?.title === 'string' && payload.title.trim()) room.media.title = clean(payload.title, 100);
    if (typeof payload?.playing === 'boolean') room.media.playing = payload.playing;
    if (Number.isFinite(payload?.currentTime)) room.media.currentTime = Math.max(0, Math.min(24 * 60 * 60, payload.currentTime));
    room.media.updatedAt = Date.now();
    sendMedia(room);
  });

  socket.on('playlist:add', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || !room.users.has(socket.id)) return;
    const title = clean(payload?.title, 100);
    const videoId = clean(payload?.videoId, 20).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!title || videoId.length < 6) return;
    if (room.playlist.some(item => item.videoId === videoId)) return;
    room.playlist.push({ id: `${Date.now()}-${Math.random()}`, title, subtitle: clean(payload?.subtitle, 100), videoId, genre: clean(payload?.genre, 32) || 'Community pick', year: clean(payload?.year, 8), addedBy: room.users.get(socket.id).name });
    room.playlist = room.playlist.slice(-30);
    systemMessage(room, `${room.users.get(socket.id).name} added “${title}” to the queue`);
    sendState(room);
  });

  socket.on('playlist:play', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    const item = room.playlist.find(entry => entry.id === payload?.id);
    if (!item) return;
    room.media = { videoId: item.videoId, title: item.title, playing: false, currentTime: 0, updatedAt: Date.now() };
    systemMessage(room, `Now screening: ${item.title}`);
    sendState(room);
  });

  socket.on('host:transfer', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id || !room.users.has(payload?.userId)) return;
    const next = room.users.get(payload.userId).name;
    room.hostId = payload.userId;
    systemMessage(room, `${next} is now the host`);
    sendState(room);
  });

  socket.on('poll:create', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    const prompt = clean(payload?.prompt, 110);
    const options = Array.isArray(payload?.options) ? payload.options.map(v => clean(v, 55)).filter(Boolean).slice(0, 4) : [];
    if (!prompt || options.length < 2) return;
    room.poll = { id: `${Date.now()}`, prompt, options, votes: {}, createdAt: Date.now() };
    systemMessage(room, 'The host started a room poll');
    sendState(room);
  });
  socket.on('poll:vote', payload => {
    const room = rooms.get(socket.data.roomCode);
    if (!room?.poll || !room.users.has(socket.id)) return;
    const index = Number(payload?.index);
    if (!Number.isInteger(index) || index < 0 || index >= room.poll.options.length) return;
    room.poll.votes[socket.id] = index;
    sendState(room);
  });
  socket.on('poll:close', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.hostId !== socket.id) return;
    room.poll = null;
    sendState(room);
  });
  socket.on('latency:ping', sentAt => socket.emit('latency:pong', { sentAt, serverAt: Date.now() }));

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const user = room.users.get(socket.id);
    room.users.delete(socket.id);
    if (user) systemMessage(room, `${user.name} left the party`);
    if (room.hostId === socket.id) room.hostId = room.users.keys().next().value || null;
    if (room.users.size === 0) {
      setTimeout(() => { const current = rooms.get(room.code); if (current && current.users.size === 0) rooms.delete(room.code); }, 5 * 60 * 1000);
    } else sendState(room);
  });
});

server.listen(PORT, () => console.log(`\n🎬 WatchWave is running at http://localhost:${PORT}\n`));
