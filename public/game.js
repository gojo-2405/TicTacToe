// Tic-Tac-Toe Client — AWS X-Ray Telemetry Engine
// AI-only mode: Player = X, AWS Lambda AI = O

const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

let gameState = {
  board: Array(9).fill(''),
  isGameOver: false,
  isAITurn: false,
  movesCount: 0,
  token: localStorage.getItem('tictactoe_jwt') || null,
  user: null
};

let aiMoveTimer = null; // safety timer so AI never hangs forever

document.addEventListener('DOMContentLoaded', () => {
  logActivity('🚀 Tic-Tac-Toe AWS X-Ray App initialized. You are X — AI is O.', 'system');
  initBoardUI();
  checkAuthStatus();
  loadLeaderboard();
  setStatus("Your turn! Click a cell — you are ❌ X");
});

/* ─────────────────────────────────────────────
   UI HELPERS
───────────────────────────────────────────── */
function setStatus(msg) {
  const el = document.getElementById('gameStatusText');
  if (el) el.textContent = msg;
}

function logActivity(text, type = 'info') {
  const logContainer = document.getElementById('activityLog');
  if (!logContainer) return;
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  const ts = new Date().toLocaleTimeString();
  item.innerHTML = `<span style="opacity:0.6;">[${ts}]</span> ${text}`;
  logContainer.appendChild(item);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function updateXRayInspector(traceId, lambdaMs = 0, dbMs = 0, subsegmentName = '') {
  const safe = el => document.getElementById(el);
  if (safe('traceIdDisplay'))     safe('traceIdDisplay').textContent     = traceId || 'Trace-Disabled';
  if (safe('lambdaLatency'))      safe('lambdaLatency').textContent      = `${lambdaMs} ms`;
  if (safe('dbLatency'))          safe('dbLatency').textContent          = `${dbMs} ms`;
  if (safe('subsegmentDisplay'))  safe('subsegmentDisplay').textContent  = subsegmentName || 'None';
}

/* ─────────────────────────────────────────────
   BOARD INIT
───────────────────────────────────────────── */
function initBoardUI() {
  document.querySelectorAll('.cell').forEach(cell => {
    cell.addEventListener('click', () => handlePlayerClick(parseInt(cell.dataset.index, 10)));
  });
}

/* ─────────────────────────────────────────────
   PLAYER CLICK
───────────────────────────────────────────── */
async function handlePlayerClick(index) {
  if (gameState.board[index] !== '' || gameState.isGameOver || gameState.isAITurn) return;

  // Place X
  placeSymbol(index, 'X');
  gameState.movesCount++;

  if (checkAndHandleWin('X', 'You Win! 🎉')) return;
  if (checkDraw()) return;

  // AI's turn
  gameState.isAITurn = true;
  disableBoard(true);
  setStatus('⏳ AWS Lambda AI is thinking...');
  logActivity('Invoking AWS Lambda AI for O move...', 'info');

  // Safety timeout — if Lambda doesn't respond in 5s, fallback locally
  let responded = false;
  aiMoveTimer = setTimeout(() => {
    if (!responded && !gameState.isGameOver) {
      logActivity('⚠️ Lambda timeout — using local fallback AI.', 'error');
      performLocalFallbackMove();
    }
  }, 5000);

  const lambdaStart = performance.now();

  try {
    const difficulty = document.getElementById('difficultySelect')?.value || 'hard';
    const res = await fetch('/api/game/ai-move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        board: [...gameState.board],
        difficulty,
        aiSymbol: 'O',
        playerSymbol: 'X'
      })
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const lambdaMs = Math.round(performance.now() - lambdaStart);

    responded = true;
    clearTimeout(aiMoveTimer);

    if (!gameState.isGameOver) {
      if (!data.success || data.bestMove === undefined || data.bestMove === -1) {
        throw new Error(data.error || 'AI returned invalid move');
      }

      logActivity(`✅ Lambda AI moved to cell ${data.bestMove} via ${data.lambdaSource} (${data.durationMs}ms)`, 'success');
      updateXRayInspector(data.traceId, lambdaMs, 0, 'AWS-Lambda-TicTacToe-AI-Node');

      placeSymbol(data.bestMove, 'O');
      gameState.movesCount++;

      if (checkAndHandleWin('O', 'AWS Lambda AI Wins! 🤖')) return;
      if (checkDraw()) return;

      gameState.isAITurn = false;
      disableBoard(false);
      setStatus("Your turn! Click a cell — you are ❌ X");
    }
  } catch (err) {
    responded = true;
    clearTimeout(aiMoveTimer);
    logActivity(`Lambda error: ${err.message}. Using local fallback.`, 'error');
    if (!gameState.isGameOver) performLocalFallbackMove();
  }
}

/* ─────────────────────────────────────────────
   LOCAL FALLBACK AI (when Lambda fails/times out)
───────────────────────────────────────────── */
function performLocalFallbackMove() {
  if (gameState.isGameOver) return;

  const board = gameState.board;
  let move = -1;

  // 1. Win if possible
  move = findWinningMove(board, 'O');
  // 2. Block player
  if (move === -1) move = findWinningMove(board, 'X');
  // 3. Center
  if (move === -1 && board[4] === '') move = 4;
  // 4. Corner
  if (move === -1) {
    const corners = [0,2,6,8].filter(i => board[i] === '');
    if (corners.length) move = corners[Math.floor(Math.random() * corners.length)];
  }
  // 5. Random
  if (move === -1) {
    const empty = board.reduce((a, v, i) => (v === '' ? [...a, i] : a), []);
    if (empty.length) move = empty[Math.floor(Math.random() * empty.length)];
  }

  if (move === -1) return; // board full, draw handled elsewhere

  logActivity(`Local fallback AI chose cell ${move}`, 'info');
  placeSymbol(move, 'O');
  gameState.movesCount++;

  if (checkAndHandleWin('O', 'AWS Lambda AI Wins! 🤖')) return;
  if (checkDraw()) return;

  gameState.isAITurn = false;
  disableBoard(false);
  setStatus("Your turn! Click a cell — you are ❌ X");
}

function findWinningMove(board, symbol) {
  for (const [a, b, c] of WINNING_COMBOS) {
    const v = [board[a], board[b], board[c]];
    if (v.filter(x => x === symbol).length === 2 && v.includes('')) {
      return [a, b, c][v.indexOf('')];
    }
  }
  return -1;
}

/* ─────────────────────────────────────────────
   GAME LOGIC
───────────────────────────────────────────── */
function placeSymbol(index, symbol) {
  gameState.board[index] = symbol;
  const cell = document.querySelector(`.cell[data-index="${index}"]`);
  if (cell) {
    cell.textContent = symbol;
    cell.classList.add(symbol.toLowerCase());
    cell.disabled = true;
  }
}

function checkAndHandleWin(symbol, message) {
  for (const [a, b, c] of WINNING_COMBOS) {
    if (gameState.board[a] === symbol &&
        gameState.board[b] === symbol &&
        gameState.board[c] === symbol) {
      // Highlight winning cells
      [a, b, c].forEach(i =>
        document.querySelector(`.cell[data-index="${i}"]`)?.classList.add('winning')
      );
      endGame(symbol === 'X' ? 'PLAYER' : 'AI', message);
      return true;
    }
  }
  return false;
}

function checkDraw() {
  if (gameState.board.every(c => c !== '')) {
    endGame('DRAW', "It's a Draw! 🤝");
    return true;
  }
  return false;
}

async function endGame(result, message) {
  gameState.isGameOver = true;
  clearTimeout(aiMoveTimer);
  disableBoard(true);
  setStatus(message);
  logActivity(`Match ended: ${message}`, result === 'PLAYER' ? 'success' : (result === 'AI' ? 'error' : 'system'));

  if (gameState.token) {
    logActivity('Saving result to AWS RDS PostgreSQL...', 'info');
    const dbStart = performance.now();
    try {
      const res = await fetch('/api/game/save-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gameState.token}`
        },
        body: JSON.stringify({
          winner: result,
          movesCount: gameState.movesCount,
          boardHistory: gameState.board,
          opponent: 'AWS Lambda AI'
        })
      });
      const data = await res.json();
      if (data.success) {
        const dbMs = Math.round(performance.now() - dbStart);
        logActivity('✅ Match saved in RDS PostgreSQL!', 'success');
        updateXRayInspector(data.traceId, 0, dbMs, 'Postgres-INSERT-Match-Record');
        renderUserStatus(data.user);
        loadLeaderboard();
      }
    } catch (err) {
      logActivity(`Save error: ${err.message}`, 'error');
    }
  } else {
    logActivity('💡 Login to record your match results in AWS RDS!', 'trace');
  }
}

function disableBoard(disabled) {
  document.querySelectorAll('.cell').forEach(cell => {
    const idx = parseInt(cell.dataset.index, 10);
    if (gameState.board[idx] === '') cell.disabled = disabled;
  });
}

function resetGame() {
  clearTimeout(aiMoveTimer);
  gameState.board = Array(9).fill('');
  gameState.isGameOver = false;
  gameState.isAITurn = false;
  gameState.movesCount = 0;

  document.querySelectorAll('.cell').forEach(cell => {
    cell.textContent = '';
    cell.className = 'cell';
    cell.disabled = false;
  });

  setStatus("Your turn! Click a cell — you are ❌ X");
  logActivity('Board reset. New game started.', 'system');
}

/* ─────────────────────────────────────────────
   LEADERBOARD
───────────────────────────────────────────── */
async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;
  try {
    const start = performance.now();
    const res = await fetch('/api/game/leaderboard');
    const duration = Math.round(performance.now() - start);
    const data = await res.json();
    tbody.innerHTML = '';
    if (data.leaderboard && data.leaderboard.length > 0) {
      data.leaderboard.forEach((row, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>#${idx + 1}</td>
          <td><strong>${escapeHtml(row.username)}</strong></td>
          <td style="color:var(--neon-green);font-weight:700;">${row.wins || 0}</td>
          <td style="color:var(--danger-red);">${row.losses || 0}</td>
          <td>${row.draws || 0}</td>
        `;
        tbody.appendChild(tr);
      });
      updateXRayInspector(data.traceId, 0, duration, 'Postgres-SELECT-Leaderboard');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No matches yet. Play a game!</td></tr>';
    }
  } catch (err) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">DB not connected yet.</td></tr>';
  }
}

/* ─────────────────────────────────────────────
   AUTH
───────────────────────────────────────────── */
async function checkAuthStatus() {
  if (!gameState.token) { renderUserStatus(null); return; }
  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${gameState.token}` }
    });
    const data = await res.json();
    if (data.success) {
      gameState.user = data.user;
      renderUserStatus(data.user);
      logActivity(`Logged in: ${data.user.username} (W:${data.user.wins} L:${data.user.losses} D:${data.user.draws})`, 'success');
    } else { logout(); }
  } catch (err) { console.warn('[Auth]', err.message); }
}

function renderUserStatus(user) {
  const area = document.getElementById('userStatusArea');
  if (!area) return;
  if (user) {
    area.innerHTML = `
      <div class="user-badge">
        <span class="user-name">👤 ${escapeHtml(user.username)}</span>
        <span class="user-stats">W: ${user.wins||0} | L: ${user.losses||0} | D: ${user.draws||0}</span>
        <button class="btn btn-small" onclick="logout()">Logout</button>
      </div>`;
  } else {
    area.innerHTML = `<button class="btn btn-primary" onclick="openAuthModal('login')">🔑 Login / Register</button>`;
  }
}

function logout() {
  localStorage.removeItem('tictactoe_jwt');
  gameState.token = null;
  gameState.user = null;
  renderUserStatus(null);
  logActivity('Logged out.', 'system');
}

/* ─────────────────────────────────────────────
   AUTH MODAL
───────────────────────────────────────────── */
function openAuthModal(tab = 'login') {
  document.getElementById('authModal')?.classList.add('active');
  switchAuthTab(tab);
}
function closeAuthModal() {
  document.getElementById('authModal')?.classList.remove('active');
}
function switchAuthTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
  if (tab === 'login') {
    document.getElementById('tabLogin')?.classList.add('active');
    document.getElementById('loginForm')?.classList.add('active');
  } else if (tab === 'register') {
    document.getElementById('tabRegister')?.classList.add('active');
    document.getElementById('registerForm')?.classList.add('active');
  } else if (tab === 'confirm') {
    document.getElementById('tabConfirm')?.classList.add('active');
    document.getElementById('tabConfirm').style.display = 'inline-block';
    document.getElementById('confirmForm')?.classList.add('active');
  }
}

document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;
  logActivity(`Authenticating '${username}'...`, 'info');
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      localStorage.setItem('tictactoe_jwt', data.token);
      gameState.token = data.token;
      gameState.user = data.user;
      renderUserStatus(data.user);
      closeAuthModal();
      logActivity(`✅ Logged in via ${data.authProvider || 'Auth'} as ${data.user.username}`, 'success');
      updateXRayInspector(data.traceId, 0, 15, 'Cognito-InitiateAuth-Subsegment');
    } else {
      logActivity(`Login failed: ${data.error}`, 'error');
      alert(`Login failed: ${data.error}`);
    }
  } catch (err) {
    logActivity(`Login error: ${err.message}`, 'error');
  }
});

document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;
  logActivity(`Registering '${username}' with Cognito...`, 'info');
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();
    if (data.success) {
      if (data.requiresConfirmation) {
        logActivity(`📩 Registration code sent to email for ${username}. Please verify!`, 'success');
        document.getElementById('confirmUsername').value = username;
        switchAuthTab('confirm');
        alert(`Account created in AWS Cognito! Please enter the verification code sent to ${email}.`);
      } else {
        localStorage.setItem('tictactoe_jwt', data.token);
        gameState.token = data.token;
        gameState.user = data.user;
        renderUserStatus(data.user);
        closeAuthModal();
        logActivity(`✅ Registered! Welcome ${data.user.username}`, 'success');
        loadLeaderboard();
      }
      updateXRayInspector(data.traceId, 0, 22, 'Cognito-SignUp-Subsegment');
    } else {
      logActivity(`Registration failed: ${data.error}`, 'error');
      alert(`Registration failed: ${data.error}`);
    }
  } catch (err) {
    logActivity(`Register error: ${err.message}`, 'error');
  }
});

document.getElementById('confirmForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('confirmUsername').value;
  const code = document.getElementById('confirmCode').value;
  logActivity(`Verifying email code for '${username}'...`, 'info');
  try {
    const res = await fetch('/api/auth/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, code })
    });
    const data = await res.json();
    if (data.success) {
      logActivity(`✅ Email verified! You can now log in.`, 'success');
      switchAuthTab('login');
      document.getElementById('loginUsername').value = username;
      alert(`Email verified successfully! Please enter your password to sign in.`);
      updateXRayInspector(data.traceId, 0, 18, 'Cognito-ConfirmSignUp-Subsegment');
    } else {
      logActivity(`Verification failed: ${data.error}`, 'error');
      alert(`Verification failed: ${data.error}`);
    }
  } catch (err) {
    logActivity(`Verification error: ${err.message}`, 'error');
  }
});

/* ─────────────────────────────────────────────
   DIAGNOSTICS
───────────────────────────────────────────── */
async function fetchHealth() {
  const start = performance.now();
  const res = await fetch('/api/health');
  const data = await res.json();
  logActivity(`Health check: ${data.status} (${Math.round(performance.now()-start)}ms)`, 'success');
}

async function triggerSimulatedError() {
  logActivity('Triggering 500 error for X-Ray Fault test...', 'error');
  try {
    const res = await fetch('/api/simulate-error');
    const data = await res.json();
    updateXRayInspector(data.traceId, 0, 0, 'AWS-XRay-Fault-Segment');
  } catch (err) {
    logActivity(`Error captured by X-Ray: ${err.message}`, 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]
  ));
}
