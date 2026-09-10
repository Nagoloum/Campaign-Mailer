# Campaign Mailer

Web application to create, personalize and send email campaigns at scale, from the user's own Gmail account.

Each user connects their Google account, imports a contact list, writes one template with merge variables, attaches a file such as a CV, then lets the application send the campaign at a controlled pace that respects Gmail's daily quota.

Intended users: students sending applications, recruiters, and small B2B prospecting campaigns.

---

## Status

**Phase 0 — foundations.** The repository holds the plan, the license and the project conventions. No application code is scaffolded yet, so the commands in this file will do nothing useful until the frontend and backend workspaces exist.

The plan of record is [ROADMAP.md](ROADMAP.md): ten phases, from an empty repository to public launch, each with work items, a definition of done and its own risks.

Current progress against the roadmap:

- [x] Git identity and repository conventions
- [x] Monorepo root: license, ignore rules, line-ending policy, editor config, workspaces
- [x] Project `CLAUDE.md`
- [ ] Frontend workspace (React 19 + Vite + TypeScript + Tailwind)
- [ ] Backend workspace (Express + TypeScript)
- [ ] Quality tooling (ESLint, Prettier, husky)
- [ ] Hosted Postgres and Redis wired up (Supabase, Upstash)
- [ ] Initial migration
- [ ] CI pipeline
- [ ] Google Cloud project and OAuth credentials

---

## Stack

Decided on 10 September 2026. The reasoning, including three deliberate departures from the specification, is in the decision table of [ROADMAP.md](ROADMAP.md#phase-0--fondations-et-décisions-gelées).

| Layer | Choice |
|---|---|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, React Router |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL |
| Queue | BullMQ on Redis |
| Email | Gmail API (`users.messages.send`) over OAuth 2.0 |
| Auth | Passport.js, Google OAuth 2.0 strategy |
| Attachments | S3-compatible object storage |
| Hosting | Vercel (frontend), Railway (backend, Postgres), Upstash (Redis) |

---

## Repository layout

```text
campaign-mailer/
├── frontend/           React + Vite single-page application
├── backend/            Express API, workers and migrations
├── ROADMAP.md          Plan of record, phase by phase
├── CONTRIBUTING.md     Conventions and review process
├── CLAUDE.md           Repository guide for Claude Code
├── LICENSE             Proprietary. All rights reserved.
└── package.json        npm workspaces root
```

---

## Requirements

- Node.js 22 or later, npm 10 or later
- A PostgreSQL database and a Redis instance. The project uses hosted services in development as well as in production: Supabase for Postgres, Upstash for Redis. No local database installation is needed.
- A Google Cloud project with the Gmail API enabled and OAuth 2.0 web credentials

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

Copy the environment templates and fill them in. Both files are created in a later Phase 0 task.

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Run the database migrations, then start both workspaces.

```bash
npm run migrate:latest
npm run dev
```

---

## Commands

Run from the repository root. Each one delegates to every workspace that defines the script.

| Command | Purpose |
|---|---|
| `npm run dev` | Start frontend and backend in watch mode |
| `npm run build` | Produce production builds |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
| `npm run typecheck` | Run `tsc --noEmit` |
| `npm test` | Run the test suites |
| `npm run migrate:latest` | Apply pending database migrations |
| `npm run migrate:down` | Roll back the last migration |

---

## Sending limits and responsible use

Gmail enforces a daily sending cap: roughly 150 messages a day for a personal account and 1500 for a Google Workspace account. The application enforces its own cap below that limit and pauses a campaign as it approaches it.

Exceeding the cap, or sending an identical message to a large list, can get a Google account suspended and can damage sender reputation. Anyone operating this application is responsible for the messages they send, for complying with data protection law and with law governing unsolicited commercial email, and for honouring unsubscribe requests.

---

## License

Proprietary. Copyright (c) 2026 Daniel Nagoloum Talla. All rights reserved.

No right to use, copy, modify or distribute this software is granted. See [LICENSE](LICENSE) for the full terms, and [CONTRIBUTING.md](CONTRIBUTING.md) before submitting any contribution.
