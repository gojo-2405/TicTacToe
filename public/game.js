// Tic-Tac-Toe Client & AWS X-Ray Telemetry Engine

let gameState = {
  board: Array(9).fill(''),
  currentPlayer: 'X',
  isGameOver: false,
  movesCount: 0,
  token: localStorage.getItem('tictactoe_jwt') || null,
  user: null
};

const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

document.addEventListener('DOMContentLoaded', () => {
  logActivity('🚀 Tic-Tac-Toe AWS X-Ray App initialized.', 'system');
  initBoardUI();
  checkAuthStatus();
  loadLeaderboard();
});

// Helper to log telemetry stream events
function logActivity(text, type = 'info') {
  const logContainer = document.getElementById('activityLog');
  if (!logContainer) return;
  const item = document.createElement('div');
  item.className = `log-item ${type}`;
  const timestamp = new Date().toLocaleTimeString();
  item.innerHTML = `<span style="opacity: 0.6;">[${timestamp}]</span> ${text}`;
  logContainer.appendChild(item);
  logContainer.scrollTop = logContainer.scrollHeight;
}

// Update X-Ray Inspector Box
function updateXRayInspector(traceId, lambdaMs = 0, dbMs = 0, subsegmentName = 'Default') {
  document.getElementById('traceIdDisplay').textContent = traceId || 'Trace-Disabled';
  document.getElementById('lambdaLatency').textContent = `${lambdaMs} ms`;
  document.getElementById('dbLatency').textContent = `${dbMs} ms`;
  document.getElementById('subsegmentDisplay').textContent = subsegmentName;
}

// Check JWT Authentication Status
async function checkAuthStatus() {
  if (!gameState.token) {
    renderUserStatus(null);
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${gameState.token}` }
    });
    const data = await res.json();
    if (data.success) {
      gameState.user = data.user;
      renderUserStatus(data.user);
      logActivity(`Logged in as: ${data.user.username} (Wins: ${data.user.wins}, Losses: ${data.user.losses})`, 'success');
    } else {
      logout();
    }
  } catch (err) {
    console.warn('[Auth Check Error]', err.message);
  }
}

function renderUserStatus(user) {
  const area = document.getElementById('userStatusArea');
  if (!area) return;

  if (user) {
    area.innerHTML = `
      <div class="user-badge">
        <span class="user-name">👤 ${escapeHtml(user.username)}</span>
        <span class="user-stats">W: ${user.wins || 0} | L: ${user.losses || 0} | D: ${user.draws || 0}</span>
        <button class="btn btn-small" onclick="logout()">Logout</button>
      </div>
    `;
  } else {
    area.innerHTML = `
      <button class="btn btn-primary" onclick="openAuthModal('login')">🔑 Login / Register</button>
    `;
  }
}

function logout() {
  localStorage.removeItem('tictactoe_jwt');
  gameState.token = null;
  gameState.user = null;
  renderUserStatus(null);
  logActivity('Logged out.', 'system');
}

// Initialize Board UI Event Listeners
function initBoardUI() {
  const cells = document.querySelectorAll('.cell');
  cells.forEach(cell => {
    cell.addEventListener('click', () => handleCellClick(parseInt(cell.dataset.index, 10)));
  });
}

// Handle User Click on Board Cell
async function handleCellClick(index) {
  if (gameState.board[index] !== '' || gameState.isGameOver) return;

  // Make Move for Player (X)
  makeMove(index, 'X');

  if (checkWinner('X')) {
    endGame('PLAYER', 'Player X Wins!');
    return;
  }

  if (isBoardFull()) {
    endGame('DRAW', "It's a Draw!");
    return;
  }

  const mode = document.getElementById('gameModeSelect').value;

  if (mode === 'AI') {
    gameState.currentPlayer = 'O';
    document.getElementById('gameStatusText').textContent = "AWS Lambda AI is calculating move...";
    disableBoard(true);

    const difficulty = document.getElementById('difficultySelect').value;
    const lambdaStart = performance.now();

    logActivity(`Invoking AWS Lambda AI (Difficulty: ${difficulty})...`, 'info');

    try {
      const res = await fetch('/api/game/ai-move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: gameState.board,
          difficulty: difficulty,
          aiSymbol: 'O',
          playerSymbol: 'X'
        })
      });

      const lambdaDuration = Math.round(performance.now() - lambdaStart);
      const data = await res.json();

      if (data.success && data.bestMove !== -1) {
        logActivity(`AWS Lambda AI moved to cell index ${data.bestMove} (${data.durationMs}ms)`, 'success');
        updateXRayInspector(data.traceId, lambdaDuration, 0, 'AWS-Lambda-TicTacToe-AI-Node');

        makeMove(data.bestMove, 'O');

        if (checkWinner('O')) {
          endGame('AI', 'AWS Lambda AI Wins!');
          return;
        }

        if (isBoardFull()) {
          endGame('DRAW', "It's a Draw!");
          return;
        }

        gameState.currentPlayer = 'X';
        document.getElementById('gameStatusText').textContent = "Player 'X' Turn. Click a cell to move.";
      }
    } catch (err) {
      logActivity(`AI Move Exception: ${err.message}`, 'error');
    } finally {
      disableBoard(false);
    }
  } else {
    // PVP Local Mode
    gameState.currentPlayer = gameState.currentPlayer === 'X' ? 'O' : 'X';
    document.getElementById('gameStatusText').textContent = `Player '${gameState.currentPlayer}' Turn.`;
  }
}

function makeMove(index, symbol) {
  gameState.board[index] = symbol;
  gameState.movesCount++;

  const cell = document.querySelector(`.cell[data-index="${index}"]`);
  if (cell) {
    cell.textContent = symbol;
    cell.classList.add(symbol.toLowerCase());
    cell.disabled = true;
  }
}

function checkWinner(symbol) {
  for (let combo of WINNING_COMBOS) {
    const [a, b, c] = combo;
    if (gameState.board[a] === symbol && gameState.board[b] === symbol && gameState.board[c] === symbol) {
      // Highlight winning cells
      [a, b, c].forEach(idx => {
        document.querySelector(`.cell[data-index="${idx}"]`)?.classList.add('winning');
      });
      return true;
    }
  }
  return false;
}

function isBoardFull() {
  return gameState.board.every(cell => cell !== '');
}

function disableBoard(disabled) {
  document.querySelectorAll('.cell').forEach(cell => {
    if (gameState.board[parseInt(cell.dataset.index, 10)] === '') {
      cell.disabled = disabled;
    }
  });
}

// End Game & Save Result in AWS RDS
async function endGame(winner, message) {
  gameState.isGameOver = true;
  disableBoard(true);
  document.getElementById('gameStatusText').textContent = message;

  logActivity(`Match finished: ${message}`, winner === 'PLAYER' ? 'success' : 'error');

  if (gameState.token) {
    logActivity('Saving match result to AWS RDS PostgreSQL...', 'info');
    const dbStart = performance.now();

    try {
      const res = await fetch('/api/game/save-match', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${gameState.token}`
        },
        body: JSON.stringify({
          winner: winner,
          movesCount: gameState.movesCount,
          boardHistory: gameState.board,
          opponent: document.getElementById('gameModeSelect').value === 'AI' ? 'AWS Lambda AI' : 'Player 2'
        })
      });

      const dbDuration = Math.round(performance.now() - dbStart);
      const data = await res.json();

      if (data.success) {
        logActivity('Match result saved in RDS PostgreSQL! (Traced via X-Ray)', 'success');
        updateXRayInspector(data.traceId, 0, dbDuration, 'Postgres-INSERT-Match-Record');
        renderUserStatus(data.user);
        loadLeaderboard();
      }
    } catch (err) {
      logActivity(`Match save error: ${err.message}`, 'error');
    }
  } else {
    logActivity('💡 Tip: Login to automatically record your matches & wins in AWS RDS PostgreSQL!', 'trace');
  }
}

function resetGame() {
  gameState.board = Array(9).fill('');
  gameState.currentPlayer = 'X';
  gameState.isGameOver = false;
  gameState.movesCount = 0;

  const cells = document.querySelectorAll('.cell');
  cells.forEach(cell => {
    cell.textContent = '';
    cell.className = 'cell';
    cell.disabled = false;
  });

  document.getElementById('gameStatusText').textContent = "Player 'X' Turn. Click a cell to move.";
  logActivity('Game board reset for new match.', 'system');
}

// Load Leaderboard from RDS Postgres
async function loadLeaderboard() {
  const tbody = document.getElementById('leaderboardBody');
  if (!tbody) return;

  const startTime = performance.now();
  try {
    const res = await fetch('/api/game/leaderboard');
    const duration = Math.round(performance.now() - startTime);
    const data = await res.json();

    tbody.innerHTML = '';
    if (data.leaderboard && data.leaderboard.length > 0) {
      data.leaderboard.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>#${index + 1}</td>
          <td><strong>${escapeHtml(row.username)}</strong></td>
          <td style="color: var(--neon-green); font-weight: 700;">${row.wins || 0}</td>
          <td style="color: var(--danger-red);">${row.losses || 0}</td>
          <td>${row.draws || 0}</td>
        `;
        tbody.appendChild(tr);
      });
      updateXRayInspector(data.traceId, 0, duration, 'Postgres-SELECT-Leaderboard-Subsegment');
    } else {
      tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No scores recorded yet.</td></tr>';
    }
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Error loading leaderboard.</td></tr>';
  }
}

// Authentication Modal Logic
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
  } else {
    document.getElementById('tabRegister')?.classList.add('active');
    document.getElementById('registerForm')?.classList.add('active');
  }
}

// Login Form Submit
document.getElementById('loginForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value;
  const password = document.getElementById('loginPassword').value;

  logActivity(`Authenticating user '${username}'...`, 'info');

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
      logActivity(`Login successful! Logged in as ${data.user.username}`, 'success');
      updateXRayInspector(data.traceId, 0, 15, 'Postgres-Auth-Verify-Subsegment');
    } else {
      logActivity(`Login failed: ${data.error}`, 'error');
      alert(`Login failed: ${data.error}`);
    }
  } catch (err) {
    logActivity(`Login error: ${err.message}`, 'error');
  }
});

// Register Form Submit
document.getElementById('registerForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value;
  const email = document.getElementById('regEmail').value;
  const password = document.getElementById('regPassword').value;

  logActivity(`Registering new account '${username}'...`, 'info');

  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await res.json();

    if (data.success) {
      localStorage.setItem('tictactoe_jwt', data.token);
      gameState.token = data.token;
      gameState.user = data.user;
      renderUserStatus(data.user);
      closeAuthModal();
      logActivity(`Registration successful! Welcome ${data.user.username}`, 'success');
      updateXRayInspector(data.traceId, 0, 22, 'Bcrypt-Hash-Plus-RDS-INSERT');
      loadLeaderboard();
    } else {
      logActivity(`Registration failed: ${data.error}`, 'error');
      alert(`Registration failed: ${data.error}`);
    }
  } catch (err) {
    logActivity(`Register error: ${err.message}`, 'error');
  }
});

// Diagnostics
async function fetchHealth() {
  const start = performance.now();
  const res = await fetch('/api/health');
  const duration = Math.round(performance.now() - start);
  const data = await res.json();
  logActivity(`Health check ping: ${data.status} (${duration}ms)`, 'success');
}

async function triggerSimulatedError() {
  logActivity('Triggering simulated 500 error for X-Ray Fault test...', 'error');
  try {
    const res = await fetch('/api/simulate-error');
    const data = await res.json();
    updateXRayInspector(data.traceId, 0, 0, 'AWS-XRay-Recorded-Fault', true);
  } catch (err) {
    logActivity(`Error captured: ${err.message}`, 'error');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, function(m) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
  });
}
