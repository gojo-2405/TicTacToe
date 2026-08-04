# ❌⭕ Tic-Tac-Toe: AWS X-Ray, Lambda & RDS Practical Testbed

This repository contains the complete standalone **Tic-Tac-Toe Game with JWT User Authentication and AWS Lambda AI Integration**, traced with **AWS X-Ray** across **AWS ECS**, **AWS Lambda**, and **AWS RDS PostgreSQL**.

---

## 🌟 Architecture & X-Ray Tracing Breakdown

- **Express.js API Server**: Traced using `AWSXRay.express.openSegment` & `closeSegment`.
- **JWT User Auth**: Bcrypt password hashing subsegments and RDS `users` database table tracing.
- **AWS Lambda AI Engine**: Tic-Tac-Toe Minimax AI move invocation traced via `@aws-sdk/client-lambda` (`AWSXRay.captureAWSv3Client`).
- **AWS RDS PostgreSQL**: Match results and player wins/losses statistics recorded and traced with `aws-xray-sdk.capturePostgres`.

---

## 📁 Repository Structure

```
aws-xray-tictactoe-game/
├── package.json               # Dependencies (@aws-sdk/client-lambda, bcryptjs, jwt, pg, aws-xray-sdk)
├── server.js                  # Express API with Auth, Lambda AI invocation & X-Ray tracing
├── db.js                      # AWS X-Ray wrapped PostgreSQL client
├── schema.sql                 # Users & Matches tables and seed records
├── lambda/
│   └── ai_move.js             # AWS Lambda Tic-Tac-Toe Minimax AI handler
├── public/
│   ├── index.html             # Tic-Tac-Toe Arena UI, Login Modal & X-Ray Telemetry Inspector
│   ├── style.css              # Cyberpunk dark mode styling with neon cell highlights
│   └── game.js                # Game engine & live X-Ray trace inspector status
├── Dockerfile                 # Multi-stage Docker container build
├── docker-compose.yml         # Local stack (App + X-Ray Daemon + Postgres)
├── ecs-task-definition.json   # AWS ECS EC2 Task Definition with X-Ray Daemon Sidecar
├── .github/workflows/
│   └── deploy.yml             # GitHub Actions OIDC deployment workflow
└── README.md                  # Setup & Deployment guide
```

---

## 🚀 Quick Local Testing

```bash
docker-compose up --build
```
Open **`http://localhost:3000`** in your browser.

---

## ☁️ Deployment Instructions

1. **GitHub Repository**: Create a new GitHub repository for `aws-xray-tictactoe-game` and push the code:
   ```bash
   cd C:\Users\karth\.gemini\antigravity\scratch\aws-xray-tictactoe-game
   git init
   git add .
   git commit -m "Initial commit of Tic-Tac-Toe AWS X-Ray app"
   git branch -M main
   git remote add origin git@github.com:YOUR_USERNAME/aws-xray-tictactoe-game.git
   git push -u origin main
   ```
2. **AWS Lambda AI**: Create a Lambda function named `TicTacToe-AI-Engine` using `lambda/ai_move.js` and enable Active Tracing in AWS X-Ray.
3. **GitHub Actions OIDC**: Set secret `AWS_ROLE_ARN` in GitHub repository settings.
