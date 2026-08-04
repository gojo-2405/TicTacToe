/**
 * AWS Lambda Function: Tic-Tac-Toe AI Move Calculator
 * Traced with AWS X-Ray Core SDK
 */
const AWSXRay = require('aws-xray-sdk-core');

const WINNING_COMBOS = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

exports.handler = async (event) => {
  const startTime = Date.now();
  const board = event.board || Array(9).fill('');
  const aiSymbol = event.aiSymbol || 'O';
  const playerSymbol = event.playerSymbol || 'X';
  const difficulty = event.difficulty || 'hard';

  console.log(`[AWS Lambda Tic-Tac-Toe AI] Invoked. Board:`, board, `Difficulty: ${difficulty}`);

  let moveIndex = -1;

  if (difficulty === 'easy') {
    moveIndex = getRandomMove(board);
  } else {
    moveIndex = findWinningMove(board, aiSymbol);
    if (moveIndex === -1) {
      moveIndex = findWinningMove(board, playerSymbol);
    }
    if (moveIndex === -1) {
      moveIndex = getMinimaxMove(board, aiSymbol, playerSymbol);
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    statusCode: 200,
    body: {
      success: true,
      bestMove: moveIndex,
      executionTimeMs: durationMs,
      lambdaName: 'TicTacToe-AI-Engine',
      aiSymbol: aiSymbol,
      difficulty: difficulty,
      message: `AI calculated move at index ${moveIndex} via AWS Lambda`
    }
  };
};

function getRandomMove(board) {
  const emptyIndices = board.map((val, idx) => (val === '' ? idx : null)).filter(val => val !== null);
  if (emptyIndices.length === 0) return -1;
  return emptyIndices[Math.floor(Math.random() * emptyIndices.length)];
}

function findWinningMove(board, symbol) {
  for (let combo of WINNING_COMBOS) {
    const [a, b, c] = combo;
    const values = [board[a], board[b], board[c]];
    if (values.filter(v => v === symbol).length === 2 && values.includes('')) {
      return combo[values.indexOf('')];
    }
  }
  return -1;
}

function getMinimaxMove(board, aiSymbol, playerSymbol) {
  if (board[4] === '') return 4;
  const corners = [0, 2, 6, 8].filter(i => board[i] === '');
  if (corners.length > 0) {
    return corners[Math.floor(Math.random() * corners.length)];
  }
  return getRandomMove(board);
}
