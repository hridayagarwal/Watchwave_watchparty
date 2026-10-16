(() => {
  const $ = id => document.getElementById(id);
  const socket = io({ transports: ['websocket', 'polling'] });
  const colors = ['#0ea5e9', '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b'];
  const catalog = [
    { title: 'Interstellar', subtitle: 'The impossible journey', videoId: 'zSWdZVtXT7E', genre: 'Sci-Fi', year: '2014', length: '2h 49m', description: 'A journey beyond the stars.', mark: 'I' },
    { title: 'Spider-Man: Across the Spider-Verse', subtitle: 'Miles goes beyond', videoId: 'shW9i6k8cB0', genre: 'Animation', year: '2023', length: '2h 20m', description: 'Leap into a whole new dimension.', mark: 'SP' },
    { title: 'Dune: Part Two', subtitle: 'Destiny is written in sand', videoId: 'Way9eso7i8g', genre: 'Sci-Fi', year: '2024', length: '2h 46m', description: 'The desert has a destiny.', mark: 'D' },
    { title: 'The Shawshank Redemption', subtitle: 'Hope can set you free', videoId: 'NmzuHjWmXOc', genre: 'Drama', year: '1994', length: '2h 22m', description: 'A little hope goes a long way.', mark: 'SR' },
    { title: 'Everything Everywhere All at Once', subtitle: 'Nothing makes sense. All at once.', videoId: 'wxN1T1uxQ2g', genre: 'Drama', year: '2022', length: '2h 19m', description: 'One family. Infinite possibilities.', mark: 'EE' },
    { title: 'The Mitchells vs. the Machines', subtitle: 'Family is a little glitchy', videoId: '_ak5dFt8Ar0', genre: 'Animation', year: '2021', length: '1h 54m', description: 'The weirdest family saves the world.', mark: 'MV' }
  ];
  let joined = false;
  let myId = null;
  let myName = 'Guest';
  let state = null;
  let player = null;
  let ytApiReady = false;
  let playerReady = false;
  let activeGenre = 'All';
  let activeTab = 'chat';
  let lastMediaId = '';
  let lastChatCount = 0;
  let lastRenderedMessageIds = new Set();
  let toastTimer = null;
  let lastPingAt = 0;
  let pingValue = null;
  let driftValue = null;
  let lastHostSyncAt = 0;
  let pendingMedia = null;
  let playerApplyingRemote = false;
  let lastRemotePlayState = null;

  function showToast(message) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
  }
  function initials(name) { return (String(name || 'G').trim().split(/\s+/).map(s => s[0]).join('').slice(0, 2) || 'G').toUpperCase(); }
  function isHost() { return !!state && state.hostId === myId; }
  function formatTime(timestamp) {
    const date = new Date(timestamp || Date.now());
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function videoIdFromInput(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/(?:youtube\.com\/(?:watch\?.*v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i);
    if (match) return match[1];
    return /^[\w-]{11}$/.test(raw) ? raw : '';
  }
  function roomLink() { return `${location.origin}${location.pathname}?room=${encodeURIComponent(state?.code || '')}`; }

  function enterParty(name, roomCode) {
    myName = name.trim().slice(0, 24) || 'Guest';
    $('lobbyError').textContent = '';
    socket.emit('room:join', { name: myName, roomCode }, result => {
      if (!result?.ok) {
        $('lobbyError').textContent = result?.error || 'Could not enter that room. Try again.';
        return;
      }
      joined = true;
      myId = result.socketId;
      state = result.state;
      $('lobby').classList.add('hidden');
      $('party').classList.remove('hidden');
      $('myAvatar').textContent = initials(myName);
      $('myAvatar').style.background = colors[(myName.charCodeAt(0) || 0) % colors.length];
      document.title = `WatchWave · ${state.code}`;
      renderAll();
      if (ytApiReady) createPlayer();
      else showToast('Room ready — warming up the projector…');
      startLatencyProbe();
      history.replaceState({}, '', `${location.pathname}?room=${encodeURIComponent(state.code)}`);
    });
  }

  // --- LOBBY LOGIC ---
  $('join-btn').addEventListener('click', () => {
      const name = $('lobby-name').value.trim();
      let room = $('lobby-room').value.trim().toUpperCase();
      if (!room) room = Math.random().toString(36).slice(2, 7).toUpperCase();
      enterParty(name, room);
  });
  $('lobby-name').addEventListener('keydown', e => { if (e.key === 'Enter') $('join-btn').click(); });
  $('lobby-room').addEventListener('keydown', e => { if (e.key === 'Enter') $('join-btn').click(); });
  $('lobby-room').addEventListener('input', e => { e.target.value = e.target.value.replace(/[^a-z0-9]/ig, '').toUpperCase(); });

  const queryParams = new URLSearchParams(location.search);
  if (queryParams.get('room')) {
      $('lobby-room').value = queryParams.get('room').slice(0, 8).toUpperCase();
      setTimeout(() => $('lobby-name').focus(), 120);
  }

  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (joined && !player) createPlayer();
  };

  function createPlayer() {
    if (player || !ytApiReady || !$('ytPlayer')) return;
    player = new YT.Player('ytPlayer', {
      width: '100%', height: '100%', videoId: state?.media?.videoId || catalog[0].videoId,
      playerVars: { autoplay: 0, controls: 1, rel: 0, modestbranding: 1, playsinline: 1, origin: location.origin },
      events: {
        onReady: () => {
          playerReady = true;
          $('playerFallback').classList.add('is-hidden');
          $('playPause').disabled = false;
          $('syncStatus').textContent = 'SYNC ENGINE ONLINE';
          pendingMedia = state?.media || pendingMedia;
          if (pendingMedia) applyRemoteMedia(pendingMedia, true);
          renderAll();
          showToast(isHost() ? 'You’re the host. You have the remote.' : 'You’re in. Grab some popcorn.');
        },
        onStateChange: event => {
          if (!joined || !state || !playerReady || !isHost() || playerApplyingRemote) return;
          if (event.data === YT.PlayerState.PLAYING || event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.BUFFERING || event.data === YT.PlayerState.ENDED) {
            const playing = event.data === YT.PlayerState.PLAYING;
            const currentTime = safeCurrentTime();
            state.media.playing = playing;
            state.media.currentTime = currentTime;
            state.media.updatedAt = Date.now();
            socket.emit('media:update', { videoId: getPlayerVideoId() || state.media.videoId, title: currentTitle(), playing, currentTime });
            refreshMediaUi();
          }
        },
        onError: event => {
          if (event.data === 101 || event.data === 150) showToast('This video does not allow embedding. Try another YouTube trailer.');
          else if (event.data === 2) showToast('That YouTube video ID looks invalid. Try another one.');
        }
      }
    });
  }
  function safeCurrentTime() { try { return player && typeof player.getCurrentTime === 'function' ? player.getCurrentTime() || 0 : 0; } catch { return 0; } }
  function getPlayerVideoId() { try { return player?.getVideoData?.().video_id || ''; } catch { return ''; } }
  function currentTitle() { return state?.media?.title || 'Shared screening'; }
  function applyRemoteMedia(media, force = false) {
    if (!media) return;
    pendingMedia = media;
    if (!playerReady || !player || !joined) return;
    if (isHost() && !force) return;
    const currentId = getPlayerVideoId();
    const newVideo = media.videoId && currentId !== media.videoId;
    const targetTime = Math.max(0, media.currentTime + (media.playing ? (Date.now() - (media.updatedAt || Date.now())) / 1000 : 0));
    if (newVideo || force) {
      playerApplyingRemote = true;
      lastMediaId = media.videoId;
      if (media.playing) player.loadVideoById({ videoId: media.videoId, startSeconds: targetTime });
      else player.cueVideoById({ videoId: media.videoId, startSeconds: targetTime });
      setTimeout(() => { playerApplyingRemote = false; }, 900);
      lastRemotePlayState = media.playing;
      return;
    }
    const currentState = player.getPlayerState?.();
    const playingNow = currentState === YT.PlayerState.PLAYING || currentState === YT.PlayerState.BUFFERING;
    if (media.playing !== lastRemotePlayState || (media.playing && !playingNow) || (!media.playing && playingNow)) {
      playerApplyingRemote = true;
      if (media.playing) player.playVideo(); else player.pauseVideo();
      setTimeout(() => { playerApplyingRemote = false; }, 500);
      lastRemotePlayState = media.playing;
    }
    const drift = safeCurrentTime() - targetTime;
    driftValue = Math.round(Math.abs(drift) * 1000);
    if (Math.abs(drift) > 0.3) {
      playerApplyingRemote = true;
      player.seekTo(targetTime, true);
      setTimeout(() => { playerApplyingRemote = false; }, 300);
      $('driftMeter').textContent = `DRIFT ${driftValue}ms · FIXED`;
    } else {
      $('driftMeter').textContent = `DRIFT ${driftValue}ms · OK`;
    }
    refreshMediaUi();
  }

  socket.on('room:state', nextState => {
    if (!joined || !nextState) return;
    state = nextState;
    renderAll();
    if (state.media && state.media.videoId !== lastMediaId) lastMediaId = state.media.videoId;
    if (!isHost()) applyRemoteMedia(state.media);
    else if (playerReady && getPlayerVideoId() !== state.media.videoId) applyHostLoadedMedia(state.media);
  });
  function applyHostLoadedMedia(media) {
    if (!playerReady || !player || !media || media.videoId === getPlayerVideoId()) return;
    playerApplyingRemote = true;
    player.cueVideoById({ videoId: media.videoId, startSeconds: media.currentTime || 0 });
    setTimeout(() => { playerApplyingRemote = false; }, 700);
  }
  socket.on('media:sync', media => {
    if (!joined || !state) return;
    state.media = media;
    $('currentTitle').textContent = media.title || 'Shared screening';
    if (!isHost()) applyRemoteMedia(media);
    refreshMediaUi();
  });
  socket.on('chat:new', message => {
    if (!state) return;
    state.messages = [...(state.messages || []), message].slice(-70);
    renderChat(true);
    $('chatCount').textContent = String(Math.max(0, (state.messages || []).filter(m => !m.system).length));
  });
  socket.on('reaction:new', item => {
    animateReaction(item.emoji, item.name);
    $('lastReaction').textContent = `${(item.name || 'SOMEONE').toUpperCase()} SENT ${item.emoji}`;
  });
  socket.on('latency:pong', packet => {
    if (packet?.sentAt) {
      pingValue = Math.max(0, Date.now() - packet.sentAt);
      $('latency').textContent = pingValue;
      $('onlineLabel').textContent = pingValue < 250 ? '● ONLINE' : '● CONNECTED';
    }
  });
  socket.on('disconnect', () => { if (joined) { $('onlineLabel').textContent = '○ RECONNECTING'; $('syncStatus').textContent = 'RECONNECTING TO ROOM…'; } });
  socket.on('connect', () => { if (joined) $('onlineLabel').textContent = '● BACK ONLINE'; });

  function startLatencyProbe() {
    const ping = () => { if (!joined || !socket.connected) return; lastPingAt = Date.now(); socket.emit('latency:ping', lastPingAt); };
    ping();
    setInterval(ping, 5000);
    setInterval(() => {
      if (!joined || !state || !playerReady) return;
      if (isHost()) {
        const now = Date.now();
        if (now - lastHostSyncAt > 3500) {
          lastHostSyncAt = now;
          socket.emit('media:update', { videoId: getPlayerVideoId() || state.media.videoId, title: currentTitle(), playing: player.getPlayerState() === YT.PlayerState.PLAYING, currentTime: safeCurrentTime() });
        }
      } else if (pendingMedia) {
        applyRemoteMedia({ ...pendingMedia, updatedAt: pendingMedia.updatedAt || Date.now() });
      }
    }, 2000);
  }

  function renderAll() {
    if (!state) return;
    $('topRoomName').textContent = `ROOM ${state.code}`;
    $('watchingCount').textContent = state.users.length;
    $('peopleCount').textContent = state.users.length;
    $('peopleSubhead').textContent = `(${state.users.length}/20)`;
    $('queueCount').textContent = state.playlist.length;
    $('chatCount').textContent = String(state.messages.filter(m => !m.system).length);
    $('currentTitle').textContent = state.media.title || 'Shared screening';
    const playing = !!state.media.playing;
    $('mediaState').textContent = playing ? 'NOW PLAYING TOGETHER' : 'READY WHEN YOU ARE';
    $('playPause').innerHTML = `${playing ? 'Ⅱ Pause' : '▶ Play'}`;
    $('playPause').disabled = !isHost() || !playerReady;
    $('hostNote').textContent = isHost() ? 'You have the remote' : `${state.users.find(u => u.id === state.hostId)?.name || 'Host'} has the remote`;
    $('startPoll').disabled = !isHost();
    $('createPollInline').disabled = !isHost();
    $('syncStatus').textContent = playerReady ? 'SYNC ENGINE ONLINE' : 'SYNC ENGINE STANDBY';
    renderMovies();
    renderPlaylist();
    renderPeople();
    renderChat(false);
    renderPoll();
    if (!playerReady) $('playerFallback').classList.remove('is-hidden');
  }
  function refreshMediaUi() {
    if (!state) return;
    const playing = !!state.media.playing;
    $('mediaState').textContent = playing ? 'NOW PLAYING TOGETHER' : 'READY WHEN YOU ARE';
    $('playPause').innerHTML = `${playing ? 'Ⅱ Pause' : '▶ Play'}`;
  }
  function fuzzyScore(query, text) {
    query = query.toLowerCase().trim(); text = text.toLowerCase();
    if (!query) return 1;
    if (text.includes(query)) return 2 + query.length / Math.max(1, text.length);
    const tokens = text.split(/\W+/);
    if (tokens.some(t => t.startsWith(query))) return 1.6;
    if (query.length > 2 && tokens.some(t => editDistance(query, t) <= (query.length > 6 ? 2 : 1))) return 1;
    return 0;
  }
  function editDistance(a, b) {
    const dp = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return dp[a.length][b.length];
  }
  function renderMovies() {
    const query = $('movieSearch').value;
    const filtered = catalog.map(m => ({ ...m, score: fuzzyScore(query, `${m.title} ${m.subtitle} ${m.genre} ${m.year}`) })).filter(m => m.score > 0 && (activeGenre === 'All' || m.genre === activeGenre)).sort((a, b) => b.score - a.score);
    $('movieResults').innerHTML = filtered.slice(0, 5).map((movie, index) => `
      <article class="movie-result" data-movie="${escapeHtml(movie.videoId)}" tabindex="0" role="button" aria-label="Add ${escapeHtml(movie.title)} to the queue">
        <div class="poster-thumb"><img loading="lazy" alt="" src="https://img.youtube.com/vi/${encodeURIComponent(movie.videoId)}/mqdefault.jpg" onerror="this.style.display='none'" /></div>
        <div><b>${escapeHtml(movie.title)}</b><small>${escapeHtml(movie.genre)} · ${escapeHtml(movie.year)}</small></div>
      </article>`).join('') || '<p class="dock-status" style="padding:10px;">No match found.</p>';
    document.querySelectorAll('[data-movie]').forEach(card => {
      const add = () => {
        const movie = catalog.find(item => item.videoId === card.dataset.movie);
        if (!movie) return;
        socket.emit('playlist:add', { title: movie.title, videoId: movie.videoId, subtitle: movie.subtitle, genre: movie.genre, year: movie.year });
        showToast(`Added ${movie.title} to the queue`);
      };
      card.addEventListener('click', add);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } });
    });
  }
  document.querySelectorAll('.genre-chip').forEach(button => button.addEventListener('click', () => {
    activeGenre = button.dataset.genre;
    document.querySelectorAll('.genre-chip').forEach(b => b.classList.toggle('active', b === button));
    renderMovies();
  }));
  $('movieSearch').addEventListener('input', renderMovies);

  function renderPlaylist() {
    $('playlist').innerHTML = state.playlist.map((item, index) => `
      <div class="playlist-item"><div><b>${escapeHtml(item.title)}</b><small>Added by ${escapeHtml(item.addedBy || 'WatchWave')}</small></div>${isHost() ? `<button class="queue-play" title="Play ${escapeHtml(item.title)}" data-playlist-id="${escapeHtml(item.id)}">▶</button>` : ''}</div>`).join('') || '<p class="dock-status" style="padding:10px;">Queue is empty.</p>';
    document.querySelectorAll('[data-playlist-id]').forEach(btn => btn.addEventListener('click', () => socket.emit('playlist:play', { id: btn.dataset.playlistId })));
  }
  function renderPeople() {
    $('participants').innerHTML = state.users.map((user, index) => {
      const host = user.id === state.hostId;
      const self = user.id === myId;
      return `<div class="participant"><div class="participant-avatar" style="background:${escapeHtml(user.color || colors[index % colors.length])}">${escapeHtml(initials(user.name))}</div><div class="participant-info"><b>${escapeHtml(user.name)}${self ? ' (you)' : ''}</b><small>${host ? 'Host' : 'Viewer'}</small></div>${host ? '<span class="host-badge">HOST</span>' : isHost() ? `<button class="make-host" data-make-host="${escapeHtml(user.id)}">Make host</button>` : ''}</div>`;
    }).join('');
    document.querySelectorAll('[data-make-host]').forEach(btn => btn.addEventListener('click', () => {
      if (confirm('Pass playback control to this person?')) socket.emit('host:transfer', { userId: btn.dataset.makeHost });
    }));
  }
  function renderChat(scrollToBottom = false) {
    if (!state) return;
    const messages = state.messages || [];
    const oldScrollHeight = $('chatMessages').scrollHeight;
    const shouldStick = scrollToBottom || $('chatMessages').scrollHeight - $('chatMessages').scrollTop - $('chatMessages').clientHeight < 80;
    $('chatMessages').innerHTML = messages.slice(-70).map(message => {
      if (message.system) return `<div class="message system"><div class="message-text">${escapeHtml(message.text)}</div></div>`;
      const index = (message.name?.charCodeAt(0) || 0) % colors.length;
      return `<div class="message"><div class="message-avatar" style="background:${colors[index]}">${escapeHtml(initials(message.name))}</div><div class="message-body"><div class="message-meta"><b>${escapeHtml(message.name || 'Guest')}</b><time>${formatTime(message.at)}</time></div><div class="message-text">${escapeHtml(message.text)}</div></div></div>`;
    }).join('');
    if (shouldStick) $('chatMessages').scrollTop = $('chatMessages').scrollHeight;
    lastChatCount = messages.length;
  }
  function renderPoll() {
    const poll = state.poll;
    if (!poll) {
      $('pollContent').innerHTML = `<div class="poll-empty"><p>No active poll.</p><button id="createPollInline2" ${isHost() ? '' : 'disabled'}>Start Poll</button></div>`;
      $('createPollInline2').addEventListener('click', openPollDialog);
      return;
    }
    const myVote = poll.votes?.[myId];
    const total = poll.results.reduce((sum, result) => sum + result.count, 0);
    $('pollContent').innerHTML = `<div class="poll-content-prompt">${escapeHtml(poll.prompt)}</div>${poll.results.map((result, index) => { const pct = total ? Math.round(result.count / total * 100) : 0; return `<button class="poll-choice ${myVote === index ? 'selected' : ''}" data-vote="${index}"><span class="poll-bar" style="width:${pct}%"></span><span class="poll-choice-text"><span>${escapeHtml(result.option)}</span><span>${pct}%</span></span></button>`; }).join('')}<div class="poll-footer"><span>${total} votes</span>${isHost() ? '<button class="dock-btn secondary" id="closePoll">Close poll</button>' : ''}</div>`;
    document.querySelectorAll('[data-vote]').forEach(button => button.addEventListener('click', () => socket.emit('poll:vote', { index: Number(button.dataset.vote) })));
    if (isHost()) $('closePoll').addEventListener('click', () => socket.emit('poll:close'));
  }

  $('playPause').addEventListener('click', () => {
    if (!isHost() || !playerReady) return showToast('Ask the host to pass you the remote.');
    const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
    if (playing) player.pauseVideo(); else player.playVideo();
  });
  $('resync').addEventListener('click', () => {
    if (!state?.media) return;
    if (isHost() && playerReady) {
      const currentTime = safeCurrentTime();
      socket.emit('media:update', { videoId: getPlayerVideoId() || state.media.videoId, title: currentTitle(), playing: player.getPlayerState() === YT.PlayerState.PLAYING, currentTime });
      showToast('Room timing broadcast refreshed.');
    } else {
      applyRemoteMedia(state.media, true);
      showToast('Checking your playback against the room…');
    }
  });
  $('copyInvite').addEventListener('click', copyInvite);
  $('peopleInvite').addEventListener('click', copyInvite);
  function copyInvite() {
    const text = `${roomLink()} — Join my WatchWave room with code ${state?.code || ''}`;
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => showToast('Invite link copied.')).catch(() => fallbackCopy(text));
    else fallbackCopy(text);
  }
  function fallbackCopy(text) { window.prompt('Copy this WatchWave invite:', text); }
  $('leaveRoom').addEventListener('click', () => {
    joined = false;
    if (player) { try { player.destroy(); } catch {} player = null; playerReady = false; }
    socket.disconnect();
    $('party').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    state = null;
    showToast('Disconnected.');
    setTimeout(() => socket.connect(), 200);
    history.replaceState({}, '', location.pathname);
  });

  $('chatForm').addEventListener('submit', event => {
    event.preventDefault();
    const text = $('chatInput').value.trim();
    if (!text) return;
    socket.emit('chat:send', { text });
    $('chatInput').value = '';
  });
  document.querySelectorAll('[data-emoji]').forEach(button => button.addEventListener('click', () => socket.emit('reaction:send', { emoji: button.dataset.emoji })));
  function animateReaction(emoji, name) {
    const layer = $('reactionFloats');
    const element = document.createElement('span');
    element.className = 'floating-reaction'; element.textContent = emoji;
    element.style.left = `${12 + Math.random() * 76}%`;
    element.style.animationDuration = `${1.9 + Math.random() * .9}s`;
    element.title = name || 'Reaction';
    layer.appendChild(element);
    setTimeout(() => element.remove(), 3000);
  }
  document.querySelectorAll('.social-tab').forEach(button => button.addEventListener('click', () => {
    activeTab = button.dataset.tab;
    document.querySelectorAll('.social-tab').forEach(tab => tab.classList.toggle('active', tab === button));
    $('chatTab').classList.toggle('hidden', activeTab !== 'chat');
    $('peopleTab').classList.toggle('hidden', activeTab !== 'people');
  }));

  $('addCustomMovie').addEventListener('click', () => $('customMovieDialog').showModal());
  $('cancelCustom').addEventListener('click', () => $('customMovieDialog').close());
  $('customMovieForm').addEventListener('submit', event => {
    event.preventDefault();
    const title = $('customTitle').value.trim();
    const videoId = videoIdFromInput($('customYoutube').value);
    if (!videoId) { showToast('Invalid YouTube URL.'); return; }
    socket.emit('playlist:add', { title, videoId, subtitle: 'Community pick', genre: 'Custom pick' });
    $('customMovieDialog').close(); $('customTitle').value = ''; $('customYoutube').value = '';
    showToast(`Queued: ${title}`);
  });
  function openPollDialog() {
    if (!isHost()) return showToast('Only the host can start a poll in this demo.');
    $('pollDialog').showModal();
  }
  $('startPoll').addEventListener('click', openPollDialog);
  $('createPollInline').addEventListener('click', openPollDialog);
  $('cancelPoll').addEventListener('click', () => $('pollDialog').close());
  $('pollForm').addEventListener('submit', event => {
    event.preventDefault();
    const options = [...document.querySelectorAll('.poll-option-input')].map(input => input.value.trim()).filter(Boolean);
    if (options.length < 2) return showToast('Add at least two poll options.');
    socket.emit('poll:create', { prompt: $('pollQuestion').value.trim(), options });
    $('pollDialog').close(); showToast('Poll launched.');
  });

  window.addEventListener('beforeunload', () => { if (joined) socket.emit('room:leave'); });
})();
