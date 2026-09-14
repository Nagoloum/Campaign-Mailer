# Campaign Mailer

[![CI](https://github.com/Nagoloum/Campaign-Mailer/actions/workflows/ci.yml/badge.svg)](https://github.com/Nagoloum/Campaign-Mailer/actions/workflows/ci.yml)

Web application to create, personalize and send email campaigns at scale, from the user's own Gmail account.

Each user connects their Google account, imports a contact list, writes one template with merge variables, attaches a file such as a CV, then lets the application send the campaign at a controlled pace that respects Gmail's daily quota.

Intended users: students sending applications, recruiters, and small B2B prospecting campaigns.

---

## Status

**Phase 4 — the send engine, awaiting review.** A user signs in with Google, writes a campaign, imports contacts, attaches a CV, sets the pace, and launches it. A separate worker process plans each campaign in its own time zone and sends one message at a time from the user's Gmail account, under a daily ceiling, without ever sending a contact the same email twice. The real five-email test (#67) is still to run.

The plan of record is [ROADMAP.md](ROADMAP.md): ten phases, from an empty repository to public launch, each with work items, a definition of done and its own risks.

Current progress against the roadmap:

- [x] Git identity and repository conventions
- [x] Monorepo root: license, ignore rules, line-ending policy, editor config, workspaces
- [x] Project `CLAUDE.md`
- [x] Frontend workspace (React 19 + Vite + TypeScript + Tailwind + React Router)
- [x] Backend workspace (Express + TypeScript)
- [x] Quality tooling (oxlint, ESLint, Prettier, husky, lint-staged)
- [x] Environment templates for both workspaces
- [x] Hosted services wired up (Neon, Upstash, Cloudflare R2 — the R2 token is scoped to the one bucket)
- [x] Initial migration (users, campaigns, contacts, logs)
- [x] CI pipeline (GitHub Actions) — written, but not running: Actions is disabled on the account
- [x] Tracker populated from the roadmap (128 issues, 10 milestones)
- [x] Google Cloud project and OAuth credentials (a real account has signed in and holds a refresh token)
- [ ] Google verification request filed — until it is, the consent screen is capped at the test users, and refresh tokens expire after seven days

---

## Stack

Decided on 10 September 2026. The reasoning, including three deliberate departures from the specification, is in the decision table of [ROADMAP.md](ROADMAP.md#phase-0--fondations-et-décisions-gelées).

| Layer       | Choice                                                        |
| ----------- | ------------------------------------------------------------- |
| Frontend    | React 19, Vite, TypeScript, Tailwind CSS, React Router        |
| Backend     | Node.js, Express, TypeScript                                  |
| Database    | PostgreSQL on Neon                                            |
| Queue       | BullMQ on Redis (Upstash)                                     |
| Email       | Gmail API (`users.messages.send`) over OAuth 2.0              |
| Auth        | Passport.js, Google OAuth 2.0 strategy                        |
| Attachments | Cloudflare R2, S3-compatible                                  |
| Hosting     | Vercel (frontend), Railway (backend); production database TBD |

---

## Repository layout

```text
campaign-mailer/
├── frontend/           React + Vite single-page application
├── backend/            Express API, workers and migrations
├── ROADMAP.md          Plan of record, phase by phase
├── CONTRIBUTING.md     Conventions and review process
├── CLAUDE.md           Repository guide for Claude Code
├── docs/               Setup procedures and, from Phase 7, the runbook
├── LICENSE             Proprietary. All rights reserved.
└── package.json        npm workspaces root
```

---

## Requirements

- Node.js 22 or later, npm 10 or later
- Accounts on Neon (PostgreSQL), Upstash (Redis) and Cloudflare R2 (attachment storage). All three are used in development as well as in production, so nothing has to be installed locally and no Docker is needed. All three have a free tier that covers development.
- A Google Cloud project with the Gmail API enabled and OAuth 2.0 web credentials. Step by step in [docs/google-oauth-setup.md](docs/google-oauth-setup.md).

On Windows, set the PowerShell execution policy before installing the git hooks, or they will not run:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

---

## Local setup

```bash
git clone https://github.com/Nagoloum/Campaign-Mailer.git
cd Campaign-Mailer
npm install
```

Copy the environment templates and fill them in. Each variable in them says which roadmap phase first reads it, so only the Phase 0 block has to be filled to boot.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

`SESSION_SECRET` and `ENCRYPTION_KEY` are generated, not chosen:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`ENCRYPTION_KEY` protects the stored Google tokens. Losing it makes every stored token undecryptable and forces every user to reconnect their account, so keep it in a secret manager as well as in the file.

Run the database migrations, then start both workspaces.

```bash
npm run migrate:latest
npm run dev
```

---

## Commands

Run from the repository root. Each one delegates to every workspace that defines the script.

| Command                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `npm run dev`            | Start the API and the web app in watch mode       |
| `npm run dev:backend`    | Start the API alone on port 3000                  |
| `npm run dev:worker`     | Start the send worker (only while testing sends)  |
| `npm run dev:frontend`   | Start the web app alone on port 5173              |
| `npm run build`          | Produce production builds                         |
| `npm run lint`           | oxlint on the frontend, ESLint on the backend     |
| `npm run lint:fix`       | Same, applying the fixes it can make              |
| `npm run format`         | Rewrite the repository with Prettier              |
| `npm run format:check`   | Fail if anything is unformatted                   |
| `npm run typecheck`      | Run `tsc --noEmit` in both workspaces             |
| `npm test`               | Run the test suites (Node's runner, via tsx)      |
| `npm run verify`         | Format check, lint, typecheck and build, in order |
| `npm run migrate:latest` | Apply pending database migrations                 |
| `npm run migrate:down`   | Roll back the last migration                      |

Create a migration with `npm run migrate:create --workspace backend -- <name>`. Migrations run against `DATABASE_DIRECT_URL`, never the pooled connection; the wrapper refuses to start if that variable points at a `-pooler` host.

---

## Quality tooling

Two linters, each where it is the better tool.

The frontend runs **oxlint**, which ships with the Vite template and is fast enough to stay out of the way. The backend runs **ESLint** with `typescript-eslint` type-aware rules and `eslint-plugin-security`, because that workspace handles OAuth tokens, attacker-controlled CSV values and a send engine whose defects reach real recipients. `no-floating-promises` alone justifies it: an unawaited promise in the send engine is a send whose failure nobody sees.

**Prettier** formats everything from a single config at the root, so neither workspace has a style opinion of its own.

**husky** runs `lint-staged` before a commit and `npm run typecheck` before a push. Hooks install themselves on `npm install`.

---

## Sending limits and responsible use

Gmail blocks a personal account that sends more than 500 messages over a rolling 24 hours ([Google's limits](https://support.google.com/mail/answer/22839)). The application stops each account at 450, across all its campaigns, and refuses a daily pace above that. When the ceiling is reached a running campaign stays running, sends nothing, tells the user why, and resumes by itself once the window frees. Two sends are at least 10 seconds apart, 30 by default, plus a random jitter.

Exceeding the cap, or sending an identical message to a large list, can get a Google account suspended and can damage sender reputation. Anyone operating this application is responsible for the messages they send, for complying with data protection law and with law governing unsolicited commercial email, and for honouring unsubscribe requests.

---

## License

Proprietary. Copyright (c) 2026 Daniel Nagoloum Talla. All rights reserved.

No right to use, copy, modify or distribute this software is granted. See [LICENSE](LICENSE) for the full terms, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting any contribution.
