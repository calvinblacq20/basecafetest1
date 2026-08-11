# Contributing to Base Cafe POS

Welcome! We appreciate your contributions to **Base Cafe POS**. This document provides guidelines, architectural context, and instructions for setting up your local environment and submitting changes.

---

## 1. Project Architecture

The repository is structured as a TypeScript monorepo containing 4 applications and 6 shared domain packages:

```
POS-main/
├── apps/
│   ├── api/            # NestJS REST API Server (Port 3100)
│   ├── pos-web/        # Cashier Point-of-Sale Web UI (Port 3000)
│   ├── admin-web/      # Administration & Analytics Web UI (Port 3001)
│   └── kds-web/        # Kitchen Display System Web UI (Port 3002)
├── packages/
│   ├── contracts/      # Shared Zod schemas, DTO types, and API contracts
│   ├── database/       # Prisma ORM schema, migrations, and seeders
│   ├── domain/         # Pure business logic, money calculations, and tax math
│   ├── integrations/   # Fiscal, printer, and payment terminal adapters
│   ├── ui/             # Reusable UI components & CSS design tokens
│   └── web-client/     # API client wrappers
└── tools/              # Acceptance test suites & utility scripts
```

---

## 2. Local Environment Setup

### Prerequisites
- **Node.js**: `v20+` or `v22+`
- **npm** / **pnpm**: Monorepo package manager
- **PostgreSQL**: Local or cloud PostgreSQL instance

### Quick Start

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/calvinblacq20/basecafetest1.git
   cd basecafetest1
   ```

2. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and set your PostgreSQL connection string:
   ```bash
   cp .env.example .env
   ```
   Set `DATABASE_URL`:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/base_cafe?schema=public"
   PORT=3100
   BOOTSTRAP_ADMIN_EMAIL="admin@basecafe.demo"
   BOOTSTRAP_ADMIN_PASSWORD="AdminPassword123!"
   ALLOW_STAGE1_ACCEPTANCE_FIXTURE="true"
   ```

3. **Database Migration & Seeding**:
   ```bash
   # Push Prisma database schema
   npx prisma@6.0.0 db push --schema packages/database/prisma/schema.prisma

   # Seed standard Organization, Branch, Device, and Admin credentials
   npx tsx packages/database/prisma/seed.ts

   # Seed Stage 1 acceptance testing catalog & fixtures
   npx tsx packages/database/prisma/stage1-acceptance-seed.ts
   ```

4. **Compile Shared Workspace Packages**:
   ```bash
   npx tsc -p packages/contracts/tsconfig.build.json
   npx tsc -p packages/database/tsconfig.build.json
   ```

---

## 3. Running Services Locally

### Backend API Server
```bash
npx tsx --tsconfig apps/api/tsconfig.json apps/api/src/main.ts
```
- **API Base URL**: `http://localhost:3100/api/v1`
- **Swagger Documentation**: `http://localhost:3100/docs`

### Front-End Web Applications

| App | Mode | Command | URL |
| :--- | :--- | :--- | :--- |
| **POS Web** | Production / Start | `npx next start -p 3000` (in `apps/pos-web`) | `http://localhost:3000` |
| **Admin Web** | Production / Start | `npx next start -p 3001` (in `apps/admin-web`) | `http://localhost:3001` |
| **KDS Web** | Production / Start | `npx next start -p 3002` (in `apps/kds-web`) | `http://localhost:3002` |

> *For active UI development with hot-reloading, run `npx next dev` inside the respective app directory.*

---

## 4. Testing & Verification

Before submitting pull requests, run the automated Stage 1 acceptance test suite:

```bash
$env:STAGE1_ACCEPTANCE_EMAIL="admin@basecafe.demo"
$env:STAGE1_ACCEPTANCE_PASSWORD="AdminPassword123!"
node tools/stage1-acceptance.mjs
```

This suite validates:
- JWT Authentication & RBAC permissions
- Shift open/close with drawer float tracking
- Order creation, modification, holding, and resuming
- Kitchen Display System (KDS) ticket queue progression
- Cash tendering, change calculation, and commercial receipt rendering
- Tamper-evident audit logging for all operations

---

## 5. Development Guidelines & Pull Request Workflow

1. **Branch Naming**:
   - `feature/description` for new features
   - `fix/issue-description` for bug fixes
   - `refactor/scope` for refactoring

2. **Commit Messages**:
   Keep commit messages clear, descriptive, and focused:
   ```
   feat(contracts): add shift reconciliation schema and types
   fix(pos-web): resolve order draft line calculation bug
   ```

3. **Submitting Pull Requests**:
   - Push your branch to GitHub.
   - Ensure all automated tests pass.
   - Open a Pull Request detailing the changes, context, and verification steps.
