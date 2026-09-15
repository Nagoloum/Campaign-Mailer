# Contributing

Campaign Mailer is proprietary software owned by Daniel Nagoloum Talla. Read [LICENSE](LICENSE) before you start.

Contributions are accepted only from people the Owner has authorized. By submitting a contribution you accept clause 4 of the license: the contribution is assigned to the Owner, and you confirm you hold the rights to it.

This file describes how work is actually done in this repository today, not an aspiration. Where the practice is expected to change, it says when.

---

## Plan of record

[ROADMAP.md](ROADMAP.md) drives the work: ten phases, and within each phase one bullet is one ticket.

- **A phase is the review unit.** Every ticket of the phase is done, then the Owner reviews the phase as a whole before the next one starts.
- **A ticket is the commit unit.** One ticket, one commit, pushed as soon as it is done. The history keeps naming what each change was for, and a regression stays bisectable.
- Do not start a Phase 9 item before Phase 8 is signed off. Scope drift toward post-MVP features is the project's most likely cause of delay.

---

## Branches

Work is committed directly on `main`, one commit per ticket.

The roadmap planned a branch and a squash-merged pull request per ticket. With a single developer and GitHub Actions disabled on the account, a pull request would add a step without adding a check, so the phase review took its place. Branches and pull requests come back when a second contributor joins or CI runs again; the conventions then are `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/`, squash merge.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org/). One ticket per commit.

```text
<type>(<optional scope>): <subject in the imperative, lower case, no final period>

<body: what changed and why>

Roadmap #<ticket>.
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`. Scope is `frontend` or `backend` when the change stays in one workspace.

The body carries the reasoning and how the change was verified. A reader six months from now needs to know why, not only what.

- **Stage explicit paths** (`git add path/one path/two`), never `git add .` or `-A`. Files dropped into the working tree have reached a commit that way before.
- **On Windows PowerShell, pass the message with `-m` or `-F <file>`.** Piping a here-string into `git commit` prepends a byte-order mark to the subject.
- Update the progress in `README.md` in the commit that advances it.
- Push after every commit. Nothing stays uncommitted at the end of a working session.

---

## Before a commit

CI is written (`.github/workflows/ci.yml`) but does not run: Actions is disabled on the account. Until that is fixed, the local checks are the only gate.

1. `npm run verify`: format check, lint, typecheck, build.
2. `npm run test:coverage` when backend code changed. It runs the whole suite, integration tests included, on a throwaway database schema, and fails under 70 % of lines overall or 90 % in `backend/src/services/`.
3. `npm run test:e2e` when a user-facing flow changed.
4. For the send engine, the real thing: a campaign to controlled test addresses, with the worker running.

The pre-commit hook formats and lints the staged files; the pre-push hook typechecks.

---

## Definition of done

A ticket is done when all of the following hold. If one fails, the ticket is not done.

- The behaviour described in the roadmap item works, checked in the running application, not only in tests.
- Tests cover the new behaviour, including the failure paths.
- The checks above pass.
- Documentation touched by the change is updated in the same commit.
- No secret, token, credential or real contact email appears anywhere in the diff.

---

## Code conventions

TypeScript everywhere, strict mode with `exactOptionalPropertyTypes`. No `any` without a comment explaining why it cannot be avoided.

Keep the layers separate on the backend. Routes validate with a schema and delegate. Services hold the business rules and are the only layer that talks to the database or to an external API. Jobs run in the worker process. A route that queries the database directly will be sent back.

Comments say why, not what. Match the density and tone of the file you are in.

On the frontend, prefer composition over boolean props. A component that takes four booleans to change its appearance should be several components, or should accept children.

Validate every request payload at the boundary. Never trust a value that came from a CSV file or from a form, and escape every value interpolated into an email template.

Tests live beside the code: `name.test.ts`, and `name.integration.test.ts` for those that need PostgreSQL. An integration test creates its own rows under a unique id and deletes exactly those rows, never by a shared prefix: the files run in parallel.

---

## Areas that need extra care

**The send engine** (`backend/src/services/`, `backend/src/jobs/`). A defect here sends a duplicate email to a real recipient, which cannot be undone, or gets a user's Google account suspended. Read [docs/send-engine.md](docs/send-engine.md) first. Every change needs tests that cover a worker restart mid-campaign, the daily ceiling and an expired token.

**Token handling.** Google access and refresh tokens are encrypted at rest and never leave the backend. They must not appear in a log line, an error message, a Sentry event or an API response.

**Migrations.** Every migration ships with a working rollback, checked by applying it, rolling it back and applying it again. The throwaway test schema also proves the whole chain still applies from nothing.

---

## Security

Report a suspected vulnerability privately to `landhack049@gmail.com`. Do not open a public issue for it.

Never commit a `.env` file, a service account key, an OAuth client secret, or a real contact list. If a secret reaches a commit, treat it as compromised: rotate it first, then clean the history.

---

## Questions

Talk to the Owner before starting anything that changes the data model, the send engine's behaviour, or the OAuth scopes requested from users. Those three decisions ripple through the whole application.
