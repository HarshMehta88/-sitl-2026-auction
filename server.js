const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const XLSX = require('xlsx');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;

const ADMIN_PIN = process.env.ADMIN_PIN || '2026';

const TEAM_PINS = {
  1: process.env.TEAM1_PIN || '1001',
  2: process.env.TEAM2_PIN || '1002',
  3: process.env.TEAM3_PIN || '1003',
  4: process.env.TEAM4_PIN || '1004',
  5: process.env.TEAM5_PIN || '1005',
  6: process.env.TEAM6_PIN || '1006'
};

function loadPlayers() {
  const wb = XLSX.readFile(path.join(__dirname, 'players.xlsx'));
  const ws =
    wb.Sheets['Auction Players'] ||
    wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
  return rows.map((r, i) => {
    const keys = Object.keys(r);
    const findKey = (names) => {
      return keys.find(k => {
        const clean = k
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '');
        return names.includes(clean);
      });
    };
    const idKey = findKey([
      'playerid',
      'id',
      'playernumber',
      'number'
    ]);
    const nameKey = findKey([
      'playername',
      'playersname',
      'players',
      'name',
      'player',
      'fullname',
      'nameofplayer',
      'playerfullname'
    ]);
    const roleKey = findKey([
      'role',
      'playingrole',
      'playerrole'
    ]);
    const battingKey = findKey([
      'batting',
      'battingstyle',
      'batstyle',
      'battingtype'
    ]);
    const bowlingKey = findKey([
      'bowling',
      'bowlingstyle',
      'bowlstyle',
      'bowlingtype'
    ]);
    const keeperKey = findKey([
      'keeper',
      'wicketkeeper',
      'wicketkeeperstatus',
      'wk',
      'iswicketkeeper'
    ]);
    return {
      id: String(
        r[idKey] ||
        `P${String(i + 1).padStart(3, '0')}`
      ),
      name: String(
        r[nameKey] ||
        `Player ${i + 1}`
      ),
      role: String(
        r[roleKey] ||
        'Registered Player'
      ),
      batting: String(
        r[battingKey] ||
        ''
      ),
      bowling: String(
        r[bowlingKey] ||
        ''
      ),
      wicketkeeper: String(
        r[keeperKey] ||
        ''
      ),
      base: 10000,
      status: 'available'
    };
  });
}function current() {
  return players[state.index] || null;
}

function nextBid(v) {
  return v < 50000 ? v + 5000 : v + 10000;
}

function canBid(teamId, amount) {
  const t = teams[teamId - 1];

  if (!t) return false;
  if (t.count >= 9) return false;

  const reserve = (9 - t.count - 1) * 10000;

  return t.purse - amount >= reserve;
}

function publicState() {
  return {
    players,
    teams,
    state,
    current: current(),

    settings: {
      base: 10000,
      incrementBelowOrEqual50000: 5000,
      incrementAbove50000: 10000,
      maxPlayers: 9,
      purse: 500000
    }
  };
}

function emit() {
  io.emit('state', publicState());
}

function addLog(text) {
  state.history.unshift({
    time: new Date().toISOString(),
    text
  });

  state.history = state.history.slice(0, 100);
}

function resetBid() {
  state.open = false;
  state.leader = null;
  state.bid = current()?.base || 10000;
}

function advance() {
  state.index++;

  if (state.index >= players.length) {
    state.finished = true;
    state.open = false;
    state.leader = null;
  } else {
    resetBid();
  }
}

io.on('connection', socket => {

  // Authentication state belongs to this socket/browser connection.
  socket.isAdmin = false;
  socket.teamId = null;

  socket.emit('state', publicState());

  // -------------------------
  // ADMIN AUTHENTICATION
  // -------------------------

  socket.on('admin:auth', pin => {
    const ok = String(pin) === String(ADMIN_PIN);

    if (ok) {
      socket.isAdmin = true;
    } else {
      socket.isAdmin = false;
    }

    socket.emit('admin:auth', ok);
  });

  // -------------------------
  // TEAM AUTHENTICATION
  // -------------------------

  socket.on('team:auth', ({ teamId, pin }) => {
    teamId = Number(teamId);

    const ok =
      TEAM_PINS[teamId] &&
      String(pin) === String(TEAM_PINS[teamId]);

    if (ok) {
      socket.teamId = teamId;

      socket.emit('team:auth', {
        ok: true,
        teamId
      });
    } else {
      socket.teamId = null;

      socket.emit('team:auth', {
        ok: false,
        teamId
      });
    }
  });

  // -------------------------
  // ADMIN CONTROLS
  // -------------------------

  socket.on('admin:start', () => {
    if (!socket.isAdmin) return;

    state.started = true;
    addLog('Auction started');
    emit();
  });

  socket.on('admin:open', () => {
    if (!socket.isAdmin) return;
    if (state.finished) return;

    state.started = true;
    state.open = true;

    addLog(
      `Bidding opened for ${current()?.name}`
    );

    emit();
  });

  socket.on('admin:pause', () => {
    if (!socket.isAdmin) return;

    state.open = false;
    addLog('Bidding paused');

    emit();
  });

  socket.on('admin:sold', () => {
    if (!socket.isAdmin) return;
    if (!state.open || !state.leader) return;

    const t = teams[state.leader - 1];
    const p = current();

    if (!t || !p) return;

    t.purse -= state.bid;
    t.count++;

    t.players.push({
      id: p.id,
      name: p.name,
      role: p.role,
      price: state.bid
    });

    p.status = 'sold';
    p.soldTo = t.id;
    p.soldPrice = state.bid;

    addLog(
      `SOLD — ${p.name} to ${t.name} for ₹${state.bid.toLocaleString('en-IN')}`
    );

    advance();
    emit();
  });

  socket.on('admin:unsold', () => {
    if (!socket.isAdmin) return;

    const p = current();

    if (!p) return;

    p.status = 'unsold';

    addLog(`UNSOLD — ${p.name}`);

    advance();
    emit();
  });

  socket.on('admin:next', () => {
    if (!socket.isAdmin) return;

    if (!state.started) {
      state.started = true;
    }

    if (current()) {
      advance();
    }

    emit();
  });

  socket.on('admin:undo', () => {
    if (!socket.isAdmin) return;

    const last = state.history.find(
      h => h.text.startsWith('SOLD')
    );

    if (!last) return;

    const match = last.text.match(
      /SOLD — (.+) to Team (\d+) for ₹([\d,]+)/
    );

    if (!match) return;

    const [, name, tid, priceText] = match;

    const price = Number(
      priceText.replace(/,/g, '')
    );

    const t = teams[Number(tid) - 1];

    const pi = players.findIndex(
      p =>
        p.name === name &&
        p.status === 'sold'
    );

    if (pi < 0 || !t) return;

    const p = players[pi];

    t.purse += price;
    t.count--;

    t.players = t.players.filter(
      x => x.id !== p.id
    );

    p.status = 'available';

    delete p.soldTo;
    delete p.soldPrice;

    state.index = pi;
    state.finished = false;

    state.history.shift();

    resetBid();

    addLog(`UNDO — ${p.name}`);

    emit();
  });

  // -------------------------
  // TEAM BIDDING
  // -------------------------

  socket.on('team:bid', teamId => {

    teamId = Number(teamId);

    // SECURITY CHECK:
    // Browser must have authenticated as THIS team.
    if (socket.teamId !== teamId) {
      socket.emit('team:error', 'Team PIN required');
      return;
    }

    if (!state.open) return;
    if (!state.started) return;
    if (state.finished) return;

    const amount = state.bid;

    if (state.leader === teamId) {
      return;
    }

    if (!canBid(teamId, amount)) {
      socket.emit(
        'team:error',
        'Insufficient purse or squad limit reached'
      );
      return;
    }

    state.leader = teamId;

    addLog(
      `Team ${teamId} bid ₹${amount.toLocaleString('en-IN')} for ${current()?.name}`
    );

    state.bid = nextBid(amount);

    emit();
  });

  socket.on('admin:settings', s => {
    if (!socket.isAdmin) return;

    // Reserved for future settings UI
  });
});

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/state', (req, res) => {
  res.json(publicState());
});

server.listen(PORT, () => {
  console.log(
    `SITL auction running on http://localhost:${PORT}`
  );
});
