# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

Campaign Mailer sends personalized email campaigns from each user's own Gmail account. A user connects Google, imports a CSV of contacts, writes one template with merge variables, attaches a file such as a CV, and the backend sends the campaign over days at a controlled pace that stays under Gmail's daily quota.

The application is proprietary. Copyright holder: Daniel Nagoloum Talla. See `LICENSE`.

## State of the repository

**Pre-code.** As of 10 September 2026 the repository holds the plan, the license, the root workspace configuration and the conventions. Neither the `frontend/` nor the `backend/` workspace is scaffolded; both hold a `.gitkeep` placeholder.

`ROADMAP.md` is the plan of record: ten phases, and within a phase one bullet is one ticket, one branch, one commit. Read it before starting work. It carries the definition of done for each phase and annotates every work item with the skills to load before implementing it.

`CONTRIBUTING.md` carries the branch and commit conventions, plus the three areas that need extra care.

## Working agreement with the repository owner

- **One task at a time.** Finish one roadmap bullet, commit it, `git push` to `origin main`, then report and stop. Do not chain into the next bullet without being asked.
- Commit messages follow Conventional Commits, and the body explains why, not only what.
- Update the progress checklist in `README.md` in the same commit that advances it.
- Never start a Phase 9 item before Phase 8 is signed off. Scope drift toward post-MVP features is the project's most likely cause of delay.

## Commands

Run from the repository root. Each script delegates to every workspace that defines it, via `--if-present`, so they exit cleanly while the workspaces are still empty and become useful as the workspaces appear.

```bash
npm install              # install all workspaces
npm run dev              # frontend and backend in watch mode
npm run build            # production builds
npm run lint             # ESLint
npm run typecheck        # tsc --noEmit
npm test                 # test suites
npm run migrate:latest   # apply pending migrations (backend workspace)
npm run migrate:down     # roll back the last migration
```

Target a single workspace with `npm run <script> --workspace backend`.

Backend tests use Node's built-in runner through tsx: `tsx --test "src/**/*.test.ts"`. Run one file with `npx tsx --test src/services/encryption.test.ts` from `backend/`, and `npm run test:watch` while working on one.

Choosing the runner was a Phase 7 item, pulled forward in Phase 1 because test-driven work needs it from the first service. `node:test` adds no dependency and needs no configuration, which is why it won over vitest for a project this size. The frontend has no runner yet.

Test files live beside the code they cover, as `*.test.ts`. `tsconfig.json` keeps them in the program so `typecheck` covers them; `tsconfig.build.json` excludes them so they never reach `dist/`.

## Stack, and the three deliberate departures from the specification

The French specification (`Cahier des Charges v1.0`) left several alternatives open. They were closed on 10 September 2026: PostgreSQL, BullMQ on Redis, Express, React 19 + Vite + Tailwind, Passport.js with the Google OAuth 2.0 strategy, Vercel for the frontend, Railway for the backend.

Three choices contradict the written specification on purpose. Do not "correct" them back:

- **TypeScript, not JavaScript.** The data model carries four state enums. A typo on a status string would corrupt the campaign state machine silently.
- **Gmail API REST (`users.messages.send`), not Nodemailer SMTP.** PaaS hosts block or throttle outbound SMTP, and the REST call reuses the OAuth token already obtained at login. Nodemailer may still be used to build the MIME payload.
- **S3-compatible object storage (Cloudflare R2), not Google Drive.** Drive would add a second sensitive OAuth scope alongside `gmail.send`, which makes Google's verification heavier, and the attachment is re-read on every send.

Postgres, Redis and the attachment bucket are **hosted from the start** — Neon, Upstash and Cloudflare R2 — not run locally in Docker. Docker is not installed on the owner's machine, and using the same services in development and production removes a class of environment drift. This means real connection strings live in `backend/.env` from Phase 0 onward; `.gitignore` already blocks `.env`.

Neon rather than Supabase for one reason worth remembering before suggesting a switch back: Supabase caps its free tier at two active projects per owner, and the owner's quota is already full. Neon's free plan scales the compute to zero after five minutes idle, which makes development effectively free but would not carry a 24/7 production API within the monthly compute allowance. The production database is a Phase 8 decision, deliberately left open.

Neon needs **two** connection strings. The pooled host carries `-pooler` and serves the API and the worker; the direct host has no `-pooler` and is used only by migrations, because the pooler does not support the session-level statements a migration runs.

Both carry `sslmode=verify-full`, not the `sslmode=require` Neon's console hands out. node-postgres warns that `require` will adopt libpq semantics in pg 9, where it encrypts without verifying the server certificate. Naming `verify-full` pins certificate verification rather than inheriting whatever the default becomes.

The provisioned services all sit in **us-east-1**: Neon project `campaign-mailer` (PostgreSQL 18.6), Upstash Redis `campaign-mailer`, and the Cloudflare R2 bucket `campaign-attachments` in the ENAM location. They are deliberately co-located, so the Railway backend belongs in a US East region too. Deploying the API to a European region would put a transatlantic round trip on every query and every queue operation.

## Architecture, and where the risk sits

Four layers, and the boundaries matter:

- **Routes** validate the payload with a schema and delegate. A route that queries the database directly will be sent back in review.
- **Controllers** orchestrate.
- **Services** (`backend/src/services/`) hold the business rules and are the only layer that talks to the database or to an external API.
- **Jobs** (`backend/src/jobs/`) are BullMQ workers. They run in a process separate from the API.

The send engine, spread across `services/` and `jobs/`, is the part of this codebase where a defect is not recoverable. A duplicate send reaches a real recipient and cannot be undone, and an over-aggressive send can get a user's Google account suspended. Three properties are non-negotiable there:

- **Idempotency.** A contact must never receive the same campaign email twice, including after a worker is killed mid-campaign and restarted. Enforced by a lock on the contact plus a uniqueness constraint keyed on `(campaign_id, contact_id)`.
- **A campaign state machine.** `draft → scheduled → running → paused → running → completed`. Any transition outside that graph is rejected with a 409, not silently applied.
- **A hard daily cap** below Gmail's own limit (roughly 150 messages a day for a personal account, 1500 for Workspace), with the campaign pausing itself as it approaches the cap.

Two other sensitive areas: Google access and refresh tokens are encrypted at rest with AES-256-GCM and must never appear in a log line, an error message or an API response; and every value interpolated into an email template is attacker-controlled input from a CSV file, so it is escaped without exception.

Sessions live in Redis and the cookie carries nothing but a session id; the session itself holds only the user id, so a Redis dump exposes no email and no token. The cookie is `sameSite: 'lax'`, not `'strict'` — Google redirects the browser back to the callback, and a strict cookie is withheld on that navigation, which breaks the OAuth state check and reads as a broken login. `createApp` takes the session store as an argument so a test can build the application without a Redis connection.

The database schema is defined in section 5 of the specification: `users`, `campaigns`, `contacts`, `logs`. Every migration ships with a working rollback.

## Environment notes

The owner develops on Windows 11 with PowerShell 5.1 and Node 24.

- `.gitattributes` normalizes the repository to LF. Do not add files that fight it.
- PowerShell's execution policy is `Restricted` on this machine, which prevents `.ps1` scripts from running. This will break husky hooks and any npm binary shipped as `.ps1`. Fix without admin rights: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.
- **GitHub Actions does not run.** As of 11 September 2026 the API answers `422: Actions has been disabled for this user` on a dispatch, while the repository's own setting reports `enabled: true` and the workflow reports `state: active`. The restriction sits on the account, not the repository, so no change to `ci.yml` or to repository settings will lift it. The owner has to resolve it at github.com (billing, email verification, or support). Until then the pipeline is untested and `npm run verify` locally is the only gate.
- A broken npm was diagnosed and fixed on 10 September 2026: a stale `minipass` 3.3.6 nested under npm's own `minizlib` shadowed `minipass` 7.1.2, and since minizlib v3 reads the named `Minipass` export that 3.x does not provide, every npm command on the machine failed with `Class extends value undefined is not a constructor or null`. If that error reappears after a Node upgrade, look for a nested `minipass` under `node_modules/npm/node_modules/minizlib/` and remove it.

## Google OAuth verification

`gmail.send` is a sensitive scope. In Testing mode the OAuth consent screen works immediately but is capped at 100 users. Verification for production can take weeks, which is why the roadmap files the request in Phase 0 rather than before launch. Adding a second sensitive scope would make that review heavier, so treat any new scope as an architectural decision.

Two scopes are worse than sensitive: `gmail.readonly` and `gmail.modify` are **restricted**, and requesting either pulls the project into an annual third-party security assessment. The Phase 9 reply-detection feature is the only planned work that would need read access, so it is a decision to take deliberately rather than a scope to add in passing.

While the app stays in Testing, refresh tokens expire after seven days. An `invalid_grant` in development usually means that, not a bug in the token service.

The full console procedure, and what each OAuth error actually means, is in `docs/google-oauth-setup.md`.
