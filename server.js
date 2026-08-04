require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// AWS X-Ray SDK Setup
const AWSXRay = require('aws-xray-sdk');
AWSXRay.config([AWSXRay.plugins.EC2Plugin, AWSXRay.plugins.ECSPlugin]);

if (process.env.AWS_XRAY_DAEMON_ADDRESS) {
  console.log(`[X-Ray Config] Setting X-Ray Daemon Address to: ${process.env.AWS_XRAY_DAEMON_ADDRESS}`);
  AWSXRay.setDaemonAddress(process.env.AWS_XRAY_DAEMON_ADDRESS);
}

AWSXRay.captureHTTPsGlobal(require('http'));
AWSXRay.captureHTTPsGlobal(require('https'));

// AWS Lambda Client (Wrapped with AWS X-Ray)
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const rawLambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const lambdaClient = AWSXRay.captureAWSv3Client(rawLambdaClient);

// Local Lambda AI fallback handler
const localAiLambda = require('./lambda/ai_move');

// RDS Database (Wrapped with AWSXRay.capturePostgres)
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'xray_tictactoe_super_secret_key_2026';

// AWS X-Ray Express Open Segment Middleware (MUST BE FIRST)
app.use(AWSXRay.express.openSegment('TicTacToe-XRay-App'));

app.use(cors());
app.use(express.json());

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(__dirname));
// Explicit Root Route with multi-path resolution
app.get('/', (req, res) => {
  const p1 = path.join(__dirname, 'public', 'index.html');
  const p2 = path.join(__dirname, 'index.html');
  if (fs.existsSync(p1)) return res.sendFile(p1);
  if (fs.existsSync(p2)) return res.sendFile(p2);
  res.status(404).send('<h1>Tic-Tac-Toe App Server Active!</h1><p>index.html not found in public/ or root directory.</p>');
});

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    req.user = user;
    const currentSegment = AWSXRay.getSegment();
    if (currentSegment) {
      currentSegment.addAnnotation('UserId', user.id);
      currentSegment.addAnnotation('Username', user.username);
    }
    next();
  });
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    service: 'Tic-Tac-Toe AWS X-Ray App',
    xrayDaemon: process.env.AWS_XRAY_DAEMON_ADDRESS || '127.0.0.1:2000',
    timestamp: new Date().toISOString()
  });
});

// Database Initialization Endpoint
app.get('/api/init-db', async (req, res) => {
  try {
    await db.initDb();
    res.json({
      success: true,
      message: 'Database tables (users & matches) initialized and seeded successfully on AWS RDS!'
    });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to initialize database tables: ' + err.message });
  }
});

// User Registration
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;
  const currentSegment = AWSXRay.getSegment();

  if (currentSegment) {
    currentSegment.addAnnotation('UserAction', 'UserRegister');
    currentSegment.addAnnotation('Username', username || 'Anonymous');
  }

  if (!username || !email || !password) {
    return res.status(400).json({ success: false, error: 'Username, email, and password required' });
  }

  const subsegment = currentSegment ? currentSegment.addNewSubsegment('BcryptPasswordHash') : null;

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    if (subsegment) subsegment.close();

    const result = await db.query(
      'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email, wins, losses, draws',
      [username, email, passwordHash]
    );

    const user = result.rows[0];
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      user,
      token,
      traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled',
      message: 'User registered successfully!'
    });
  } catch (error) {
    if (subsegment) {
      subsegment.addError(error);
      subsegment.close();
    }
    res.status(400).json({
      success: false,
      error: error.message.includes('unique constraint') ? 'Username or email already exists' : error.message,
      traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
    });
  }
});

// User Login
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const currentSegment = AWSXRay.getSegment();

  if (currentSegment) {
    currentSegment.addAnnotation('UserAction', 'UserLogin');
    currentSegment.addAnnotation('AttemptedUsername', username || 'Unknown');
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);

    if (result.rows.length === 0) {
      if (currentSegment) currentSegment.addAnnotation('AuthStatus', 'UserNotFound');
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const subsegment = currentSegment ? currentSegment.addNewSubsegment('BcryptPasswordVerify') : null;
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (subsegment) subsegment.close();

    if (!isMatch) {
      if (currentSegment) currentSegment.addAnnotation('AuthStatus', 'InvalidPassword');
      return res.status(401).json({ success: false, error: 'Invalid username or password' });
    }

    if (currentSegment) currentSegment.addAnnotation('AuthStatus', 'Success');

    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });

    res.json({
      success: true,
      token,
      user: { id: user.id, username: user.username, email: user.email, wins: user.wins, losses: user.losses, draws: user.draws },
      traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get Current Profile
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const result = await db.query('SELECT id, username, email, wins, losses, draws FROM users WHERE id = $1', [req.user.id]);
    res.json({ success: true, user: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// AWS Lambda AI Move Calculator
app.post('/api/game/ai-move', async (req, res) => {
  const { board, difficulty = 'hard', aiSymbol = 'O', playerSymbol = 'X' } = req.body;
  const currentSegment = AWSXRay.getSegment();

  if (currentSegment) {
    currentSegment.addAnnotation('UserAction', 'CalculateAiMove');
    currentSegment.addAnnotation('Difficulty', difficulty);
  }

  const subsegment = currentSegment ? currentSegment.addNewSubsegment('AWS-Lambda-TicTacToe-AI-Node') : null;
  const startTime = Date.now();

  try {
    let aiResponse;

    if (process.env.LAMBDA_FUNCTION_NAME) {
      // Invoke real AWS Lambda function
      const command = new InvokeCommand({
        FunctionName: process.env.LAMBDA_FUNCTION_NAME,
        InvocationType: 'RequestResponse',
        Payload: JSON.stringify({ board, difficulty, aiSymbol, playerSymbol })
      });
      const lambdaRes = await lambdaClient.send(command);

      // Check for Lambda function error
      if (lambdaRes.FunctionError) {
        throw new Error(`Lambda function error: ${lambdaRes.FunctionError} - ${Buffer.from(lambdaRes.Payload).toString('utf-8')}`);
      }

      const payloadString = Buffer.from(lambdaRes.Payload).toString('utf-8');
      const payloadJson = JSON.parse(payloadString);

      // Lambda returns { statusCode, body } where body may be object or JSON string
      if (payloadJson.body !== undefined) {
        aiResponse = typeof payloadJson.body === 'string' ? JSON.parse(payloadJson.body) : payloadJson.body;
      } else {
        // Lambda returned the data directly without statusCode wrapper
        aiResponse = payloadJson;
      }
    } else {
      // Local fallback - call the handler directly
      const localResult = await localAiLambda.handler({ board, difficulty, aiSymbol, playerSymbol });
      aiResponse = typeof localResult.body === 'string' ? JSON.parse(localResult.body) : localResult.body;
    }

    const duration = Date.now() - startTime;

    if (subsegment) {
      subsegment.addAnnotation('BestMoveIndex', String(aiResponse.bestMove));
      subsegment.addMetadata('LambdaPayload', aiResponse);
      subsegment.close();
    }

    res.json({
      success: true,
      bestMove: aiResponse.bestMove,
      durationMs: duration,
      lambdaSource: process.env.LAMBDA_FUNCTION_NAME ? 'AWS Cloud Lambda' : 'Local Fallback AI',
      traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
    });
  } catch (error) {
    console.error('[AI Move Error]', error.message);
    if (subsegment) {
      subsegment.addError(error);
      subsegment.close();
    }
    // Fallback to local AI if Lambda fails
    try {
      const fallback = await localAiLambda.handler({ board, difficulty, aiSymbol, playerSymbol });
      const fb = typeof fallback.body === 'string' ? JSON.parse(fallback.body) : fallback.body;
      console.log('[AI Move] Using local fallback AI. Move:', fb.bestMove);
      return res.json({
        success: true,
        bestMove: fb.bestMove,
        durationMs: Date.now() - startTime,
        lambdaSource: 'Local Fallback AI (Lambda failed)',
        traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
      });
    } catch (fallbackErr) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
});

// Save Match Results
app.post('/api/game/save-match', authenticateToken, async (req, res) => {
  const { winner, movesCount, boardHistory, opponent = 'AWS Lambda AI' } = req.body;
  const currentSegment = AWSXRay.getSegment();

  if (currentSegment) {
    currentSegment.addAnnotation('UserAction', 'SaveMatch');
    currentSegment.addAnnotation('MatchWinner', winner);
  }

  try {
    const matchInsert = await db.query(
      'INSERT INTO matches (user_id, opponent_name, winner, moves_count, board_history) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [req.user.id, opponent, winner, movesCount || 0, JSON.stringify(boardHistory || [])]
    );

    if (winner === 'PLAYER') {
      await db.query('UPDATE users SET wins = wins + 1 WHERE id = $1', [req.user.id]);
    } else if (winner === 'AI') {
      await db.query('UPDATE users SET losses = losses + 1 WHERE id = $1', [req.user.id]);
    } else {
      await db.query('UPDATE users SET draws = draws + 1 WHERE id = $1', [req.user.id]);
    }

    const updatedUser = await db.query('SELECT id, username, wins, losses, draws FROM users WHERE id = $1', [req.user.id]);

    res.json({
      success: true,
      match: matchInsert.rows[0],
      user: updatedUser.rows[0],
      traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Leaderboard
app.get('/api/game/leaderboard', async (req, res) => {
  const currentSegment = AWSXRay.getSegment();
  if (currentSegment) {
    currentSegment.addAnnotation('UserAction', 'ViewLeaderboard');
  }

  try {
    const result = await db.query(
      'SELECT id, username, wins, losses, draws, created_at FROM users ORDER BY wins DESC, draws DESC LIMIT 10'
    );
    res.json({ success: true, leaderboard: result.rows, traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled' });
  } catch (error) {
    res.json({
      success: false,
      leaderboard: [
        { username: 'Commander_Alex', wins: 14, losses: 3, draws: 2 },
        { username: 'Cyber_Nova', wins: 9, losses: 7, draws: 4 }
      ],
      traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
    });
  }
});

// Simulated Fault Endpoint
app.get('/api/simulate-error', (req, res, next) => {
  const currentSegment = AWSXRay.getSegment();
  if (currentSegment) currentSegment.addAnnotation('UserAction', 'SimulateError');
  const error = new Error('Simulated AWS X-Ray Fault (Tic-Tac-Toe Exception Demo)');
  error.statusCode = 500;
  next(error);
});

// AWS X-Ray Express Close Segment Middleware
app.use(AWSXRay.express.closeSegment());

app.use((err, req, res, next) => {
  console.error('[Server Error Handler]', err.message);
  const currentSegment = AWSXRay.getSegment();
  res.status(err.statusCode || 500).json({
    success: false,
    error: err.message,
    traceId: currentSegment ? currentSegment.trace_id : 'X-Ray-Disabled'
  });
});

app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Tic-Tac-Toe AWS X-Ray App running on port ${PORT}`);
  console.log(`📡 AWS X-Ray Daemon Target: ${process.env.AWS_XRAY_DAEMON_ADDRESS || '127.0.0.1:2000'}`);
  console.log(`=======================================================`);
  await db.initDb();
});
