-- Database schema for Tic-Tac-Toe AWS X-Ray Demonstration Game
-- Compatible with AWS RDS PostgreSQL

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  wins INT DEFAULT 0,
  losses INT DEFAULT 0,
  draws INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS matches (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  opponent_name VARCHAR(100) DEFAULT 'AWS Lambda AI',
  winner VARCHAR(50) NOT NULL,
  moves_count INT DEFAULT 0,
  board_history TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Seed initial test user (Password: "password123")
INSERT INTO users (username, email, password_hash, wins, losses, draws) VALUES
  ('Commander_Alex', 'alex@galactic.io', '$2a$10$wN9aL4j/5zKx1wGz5hOZeO1tN0l1JgLzJgLzJgLzJgLzJgLzJgLzJ', 14, 3, 2),
  ('Cyber_Nova', 'nova@galactic.io', '$2a$10$wN9aL4j/5zKx1wGz5hOZeO1tN0l1JgLzJgLzJgLzJgLzJgLzJgLzJ', 9, 7, 4)
ON CONFLICT (username) DO NOTHING;
