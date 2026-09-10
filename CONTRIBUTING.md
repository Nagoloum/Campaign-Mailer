# Contributing

Campaign Mailer is proprietary software owned by Daniel Nagoloum Talla. Read [LICENSE](LICENSE) before you start.

Contributions are accepted only from people the Owner has authorized. By submitting a contribution you accept clause 4 of the license: the contribution is assigned to the Owner, and you confirm you hold the rights to it.

---

## Plan of record

[ROADMAP.md](ROADMAP.md) drives the work. Ten phases, and within each phase one bullet is one ticket, one branch and one commit.

Do not start a Phase 9 item before Phase 8 is signed off. Scope drift toward post-MVP features is the project's most likely cause of delay.

---

## Branches

`main` is protected. Never commit to it directly.

One branch per ticket, named by type:

| Prefix      | Use                                    |
| ----------- | -------------------------------------- |
| `feat/`     | New behaviour                          |
| `fix/`      | Bug fix                                |
| `refactor/` | Restructuring with no behaviour change |
| `test/`     | Tests only                             |
| `docs/`     | Documentation only                     |
| `chore/`    | Tooling, dependencies, configuration   |

Example: `feat/campaign-state-machine`.

---

## Commits

[Conventional Commits](https://www.conventionalcommits.org/). One logical change per commit.

```text
<type>(<optional scope>): <subject in the imperative, lower case, no final period>

<body: what changed and why, wrapped at 72 columns>
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `perf`, `build`, `ci`.

The body carries the reasoning. A reader six months from now needs to know why the change was made, not only what changed. Reference the ticket when one exists.

Push after every completed task. Nothing stays uncommitted at the end of a working session.

---

## Definition of done

A ticket is done when all of the following hold. If one fails, the ticket is not done.

- The behaviour described in the roadmap item works, verified by hand in the running application.
- Tests cover the new behaviour, including the failure paths.
- `npm run verify` passes locally, and so does `npm test`.
- The diff has been reviewed, and the review comments are resolved.
- Documentation touched by the change is updated in the same pull request.
- No secret, token, credential or real contact email appears anywhere in the diff.

---

## Pull requests

Open a pull request into `main`. The description states what changed, why, how it was verified, and which roadmap item it closes.

CI must be green before review. Review is required before merge, including for the Owner's own branches on anything under `backend/src/services/`, which holds the send engine.

Squash merge, so `main` keeps one commit per ticket.

---

## Code conventions

TypeScript everywhere, strict mode. No `any` without a comment explaining why it cannot be avoided.

Keep the layers separate on the backend. Routes validate and delegate. Controllers orchestrate. Services hold the business rules and are the only layer that talks to the database or to external APIs. A route that queries the database directly will be sent back.

On the frontend, prefer composition over boolean props. A component that takes four booleans to change its appearance should be several components, or should accept children.

Validate every request payload at the boundary with a schema. Never trust a value that came from a CSV file or from a form.

Escape every value interpolated into an email template. A contact name is attacker-controlled input.

---

## Areas that need extra care

**The send engine** (`backend/src/services/`, `backend/src/jobs/`). A defect here sends a duplicate email to a real recipient, which cannot be undone, or gets a user's Google account suspended. Every change needs a test that covers worker restart mid-campaign, quota exhaustion, and token expiry.

**Token handling.** Google access and refresh tokens are encrypted at rest and never leave the backend. They must not appear in a log line, an error message, or an API response.

**Migrations.** Every migration ships with a working rollback, and is tested against a copy of the data before it runs in production.

---

## Security

Report a suspected vulnerability privately to `landhack049@gmail.com`. Do not open a public issue for it.

Never commit a `.env` file, a service account key, an OAuth client secret, or a real contact list. If a secret reaches a commit, treat it as compromised: rotate it first, then clean the history.

---

## Questions

Open a discussion with the Owner before starting anything that changes the data model, the send engine's behaviour, or the OAuth scopes requested from users. Those three decisions ripple through the whole application.
