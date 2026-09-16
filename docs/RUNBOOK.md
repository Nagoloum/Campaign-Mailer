# Runbook

What to do when something goes wrong, without reading the code first. Each procedure starts from what you can see, says how to confirm the cause, and what to do.

Two rules hold throughout:

- **A duplicate email cannot be unsent.** When in doubt between sending twice and not sending, do not send. Every procedure here that re-queues a message starts by checking it did not already leave.
- **Read before you write.** Every SQL statement that changes data below is preceded by the query that proves it is needed. Run changes on the direct connection (`DATABASE_DIRECT_URL`), inside a transaction, and check the row count before `COMMIT`.

How the pieces fit: [ARCHITECTURE.md](ARCHITECTURE.md). Why the send engine behaves as it does: [send-engine.md](send-engine.md).

---

## Where to look first

| Question                               | Where                                                                                                                                                                                 |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Is the API up?                         | `GET /api/health` answers `{"status":"ok"}`.                                                                                                                                          |
| Can it serve, and is the worker alive? | `GET /api/ready`: `checks` (database, sessionStore, queue), `queue` (waiting, delayed, active, failed), `worker.alive` and `worker.lastSeenSecondsAgo`. A 503 names the failed check. |
| What happened to one request?          | The user can quote the `x-request-id` response header. Search the API logs for that `req.id`.                                                                                         |
| What happened to one send?             | Search the worker logs for the `contactId` or `jobId` (`send-<contactId>`). Every attempt is a line.                                                                                  |
| What broke recently?                   | Sentry, filtered by the `service` tag (`api` or `worker`).                                                                                                                            |
| Which alerts are firing?               | Sentry issues tagged `alert`, or log lines with an `alert` field at level `error`.                                                                                                    |

Logs are JSON, one object per line. The fields that matter: `level` (`info`, `warn`, `error`), `service`, `msg`, `req.id`, `jobId`, `campaignId`, `contactId`, `outcome`, `alert`. Tokens, cookies and query strings are never in them; recipient addresses are not either.

---

## Alerts

| `alert`           | Raised by | Condition                                                           | Procedure                                             |
| ----------------- | --------- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| `worker_stopped`  | API       | No worker heartbeat for 15 minutes                                  | [Worker stopped](#worker-stopped)                     |
| `queue_stuck`     | API       | A job has been due for more than 15 minutes                         | [Queue stuck or saturated](#queue-stuck-or-saturated) |
| `send_error_rate` | Worker    | More than 5 % of sends refused over the last hour, from 10 attempts | [Sends failing](#sends-failing)                       |

An alert is notified when it starts, again every six hours while it lasts, and an `Alert resolved` line is logged when it ends. Worker and queue alerts run only where `WORKER_MONITOR` is on (production by default), on one API instance.

---

## Worker stopped

**Seen as**: `worker_stopped` alert; `/api/ready` shows `worker.alive: false`; campaigns stay `scheduled` or stop progressing.

1. Check the worker process on the host. If it is not running, read its last log lines before restarting: an exception at startup (missing variable, unreachable Redis) repeats on restart.
2. Restart it (`npm run worker` in production, `npm run dev:worker` locally).
3. Within a minute, `Worker started` then a heartbeat: `/api/ready` shows `worker.alive: true`.

Nothing is lost while it is down. Delayed jobs stay in Redis, the fifteen-minute plan re-queues what is pending, and a job the dead worker was holding is recovered within five minutes (its contact's claim expires after ten). A send that was cut between Gmail's answer and its record is marked failed with an unknown outcome: see [Replaying a send](#replaying-a-send).

In development the worker is usually not running, which is why the alert is off there.

---

## Queue stuck or saturated

**Seen as**: `queue_stuck` alert; `/api/ready` shows jobs `waiting` or long overdue `delayed`, or a growing `failed` count.

1. **Is the worker alive?** If `worker.alive` is false, this is [Worker stopped](#worker-stopped).
2. **Is Redis refusing commands?** Search the worker logs for `Worker error`, or the Upstash console for the daily and monthly command counts. Past the free allowance, Upstash answers `ERR max requests limit exceeded` and nothing moves. Raise the plan, or wait for the reset; the queue resumes by itself.
3. **Is it failing jobs?** `queue.failed` growing with `Job failed` lines at level `warn` or `error` means the sends themselves fail: see [Sends failing](#sends-failing).
4. **Worker alive, Redis fine, jobs overdue**: restart the worker. A worker that stays paused after a failed idle check is resumed by the next check two minutes later; a restart forces it.

**Do not flush Redis.** Sessions share it: `FLUSHALL` signs every user out. Deleting the queue's keys is not needed either, since the plan re-queues every pending contact within fifteen minutes and a job id per contact prevents doubles.

---

## A campaign does not send

**Seen as**: a user reports a campaign stuck at `scheduled`, or `running` with the counters not moving.

Check, in this order:

1. **The start hour.** The plan does nothing before `start_hour` in the campaign's time zone, not the server's. A campaign set to 09:00 `America/New_York` does not start at 09:00 in Paris.
2. **The account ceiling.** The campaign page shows "Plafond atteint" with the number sent over 24 hours. This is expected: see [Daily ceiling reached](#daily-ceiling-reached).
3. **The worker.** `/api/ready` → `worker.alive`. A sleeping worker starts a due job within about two and a half minutes; that is normal latency.
4. **The status.** A `paused` campaign whose last log row says "Accès Google expiré ou révoqué" is [A revoked Google token](#a-revoked-google-token).
5. **The contacts.** A campaign with nothing left pending does nothing more, and moves to `completed` at the next plan.

```sql
-- One campaign: status, counters, and what is left to send.
SELECT c.status, c.start_hour, c.timezone, c.mails_per_day, c.pause_ms,
       c.total_contacts, c.sent_count, c.error_count,
       count(*) FILTER (WHERE k.status = 'pending')                        AS pending,
       count(*) FILTER (WHERE k.status = 'pending' AND k.claimed_at IS NOT NULL) AS pending_claimed
  FROM campaigns c
  LEFT JOIN contacts k ON k.campaign_id = c.id
 WHERE c.id = '<campaign id>'
 GROUP BY c.id;

-- Its last events.
SELECT created_at, event_type, contact_id, message
  FROM logs WHERE campaign_id = '<campaign id>'
 ORDER BY created_at DESC LIMIT 20;
```

A contact `pending` with a `claimed_at` older than ten minutes is taken again by the next plan. Do not clear the claim by hand.

---

## A revoked Google token

**Seen as**: the campaign is `paused`, its last log row reads "Accès Google expiré ou révoqué. Reconnectez votre compte, puis reprenez la campagne."; worker logs show `outcome: paused` for a send.

**Causes**: the user removed the application's access in their Google account, changed their password, or the OAuth app is still in Testing, where refresh tokens expire after seven days. In development, the last is by far the most likely.

1. The user signs out and signs in again with Google. The new tokens replace the stored ones.
2. The user opens the campaign and clicks **Reprendre**. Pending contacts are untouched and go out at the campaign's pace.
3. If the campaign pauses again at the next send, Google did not issue a new refresh token on that sign-in. Have the user remove Campaign Mailer at <https://myaccount.google.com/permissions>, then sign in again: a fresh consent issues a new one.

Nothing was failed while the token was invalid: the campaign pauses on the first refusal, and the jobs behind it find it paused and do nothing.

---

## Sends failing

**Seen as**: `send_error_rate` alert; Sentry issues "Gmail refused the message" (warning) or errors from exhausted jobs; the campaign's error count rising.

1. **Read the reason.** In the application, the contact table filtered on "En erreur" shows each reason. In SQL:

   ```sql
   SELECT error_message, count(*)
     FROM contacts
    WHERE campaign_id = '<campaign id>' AND status = 'failed'
    GROUP BY error_message ORDER BY count(*) DESC;
   ```

2. **Refusals about addresses** (invalid recipient, rejected address): a data problem in the imported list, not an incident. Nothing to do on the platform; the user can correct the list.
3. **"Échec après plusieurs tentatives"**: three transient failures in a row (429, 5xx, a rate-limited 403). If many accounts show it at once, Gmail is degraded: check the [Google Workspace status page](https://www.google.com/appsstatus). If one account shows it, that account is being rate-limited by Google: pause its campaigns for 24 hours and lower `mails_per_day` before resuming.
4. **"Envoi déjà tenté, issue inconnue"**: a worker stopped between the call and the record. See [Replaying a send](#replaying-a-send).
5. **Every send failing for every account right after a deploy**: suspect configuration (`ENCRYPTION_KEY` changed, so stored tokens cannot be decrypted; or the Google client secret). Roll back the configuration; do not ask users to reconnect until the cause is known.

---

## Daily ceiling reached

**Seen as**: the campaign page shows "Plafond atteint : N e-mails envoyés par ce compte sur les dernières 24 heures"; the campaign is `running` and sends nothing.

This is the application protecting the account. Google blocks a personal Gmail account past 500 messages over a rolling 24 hours; the application stops at `GMAIL_DAILY_LIMIT` (450) across all the account's campaigns.

- **Nothing to do.** Sending resumes by itself as soon as the oldest send of the window is more than 24 hours old. Pending contacts stay pending; none is failed.
- **Do not raise `GMAIL_DAILY_LIMIT` to unblock a user.** The process refuses a value above 500, and between 450 and 500 there is no room left for the mail the user sends by hand from the same mailbox.
- If Google blocked the account anyway (sends failing with a daily quota message), the user sent from the same mailbox by other means. Pause the account's campaigns for 24 hours.

```sql
-- What an account sent over the last 24 hours, across its campaigns.
SELECT count(*)
  FROM logs l JOIN campaigns c ON c.id = l.campaign_id
 WHERE c.user_id = '<user id>' AND l.event_type = 'sent'
   AND l.created_at >= now() - interval '24 hours';
```

---

## Replaying a send

**When**: a contact is `failed` and the user wants it sent. The interface only offers "ignorer" and "remettre en attente" for pending and ignored contacts, deliberately: a failed contact is re-queued by hand, after the checks below.

1. **Make sure it did not leave.** For "Envoi déjà tenté, issue inconnue", ask the user to search their Gmail **Sent** folder for a message to that address around the time in the log. If it is there, stop: mark nothing, the recipient has it.

   ```sql
   SELECT k.email, k.status, k.attempts, k.error_message, k.claimed_at,
          (SELECT count(*) FROM logs WHERE contact_id = k.id AND event_type = 'sent') AS sent_rows
     FROM contacts k WHERE k.id = '<contact id>';
   ```

   `sent_rows` must be 0. If it is 1, the message was recorded as sent and the contact's status is what is wrong: do not replay.

2. **Put the contact back in the queue.** `attempts` is reset too: left above zero, the engine would take the contact for another unknown outcome and fail it again without sending.

   ```sql
   BEGIN;

   UPDATE contacts
      SET status = 'pending', attempts = 0, claimed_at = NULL, error_message = NULL
    WHERE id = '<contact id>' AND status = 'failed'
      AND NOT EXISTS (SELECT 1 FROM logs WHERE contact_id = contacts.id AND event_type = 'sent');
   -- Expect: UPDATE 1

   -- Counters from the rows, rather than adjusted by hand.
   UPDATE campaigns c
      SET sent_count  = (SELECT count(*) FROM contacts WHERE campaign_id = c.id AND status = 'sent'),
          error_count = (SELECT count(*) FROM contacts WHERE campaign_id = c.id AND status = 'failed')
    WHERE c.id = '<campaign id>';

   COMMIT;
   ```

3. **Make the campaign send again.**
   - `running` or `scheduled`: nothing more; the next plan, within fifteen minutes, queues the contact.
   - `paused`: the user clicks **Reprendre**.
   - `completed`: the state machine has no way out of `completed`, by design. Reopening it is a manual override, to be recorded in the incident notes:

     ```sql
     UPDATE campaigns SET status = 'running', completed_at = NULL
      WHERE id = '<campaign id>' AND status = 'completed';
     ```

Even if every check above were wrong, the unique index on `sent` log rows refuses to record a second send for the contact. It cannot stop the email itself, which is why step 1 comes first.

---

## Setting up Sentry

Error reporting is off until a DSN is set.

1. Create a Sentry organization and two projects: **Node.js** (API and worker share it) and **React**.
2. Set `SENTRY_DSN` on the API and the worker, `VITE_SENTRY_DSN` on the frontend build, and redeploy. The API and worker log `errorReporting: true` at startup.
3. Create an alert rule on the Node project: _when a new issue is created or an issue regresses, where tag `alert` is set, send an email_. The three operational alerts each open one issue per kind.
4. Optionally a second rule on `level: error` for the `worker` service, which covers exhausted sends and ambiguous outcomes.
5. Check it end to end: in a staging environment, launch a campaign to an invalid address. A "Gmail refused the message" warning appears with the job id, attempt, campaign and contact ids, and no address.

---

## Deploying, and going back

Every push to `main` deploys: Railway rebuilds the API and the worker, Vercel
rebuilds the web app. The API applies the pending migrations before it starts,
so a deploy that fails to migrate never serves.

**Going back is a deploy of the previous version, not a repair of the running
one.**

1. **Which layer is broken?** The web app answers from Vercel; everything under
   `/api` is relayed to Railway. `GET /api/health` tells them apart: a working
   page with a failing `/api/health` is the API, not the front.

2. **The API or the worker** (Railway):

   ```bash
   railway status                      # which deployment is live
   railway logs --service <name>       # why it broke
   ```

   In the Railway dashboard, open the service, then **Deployments**, and pick
   the last one that worked: **Redeploy**. It reuses that build, so the code and
   the variables of the moment come back together.

   A variable alone can be put back without a rollback:
   `railway variable set NAME=value --service <name>`, which redeploys.

3. **The web app** (Vercel): in the dashboard, **Deployments**, the last good
   one, then **Promote to Production**. Or `vercel rollback <url>` from the
   repository.

4. **A migration is the exception.** Rolling the code back does not roll the
   schema back, and a migration that ran stays. If the schema is the problem:

   ```bash
   npm run migrate:down --workspace backend   # one migration, on DATABASE_DIRECT_URL
   ```

   Only when that migration's rollback is safe for the data already written.
   When in doubt, restore the database instead (below): losing a few hours of
   data is recoverable, a half-migrated schema is not.

5. **Then say so in the commit history**: the fix goes through `main` like
   everything else, so the next deploy does not bring the fault back.

---

## Restoring the database

The worker writes a copy of the data to the bucket every day, under `backups/`,
as gzipped JSON lines, and keeps the last 30. The schema is not in the copy: it
comes from the migrations, which run before the API starts.

The restore is not a procedure written on paper and never run: it is the
function `restoreBackup`, exercised end to end on every test run
(`backup.integration.test.ts` writes rows, empties every table, restores, and
compares).

**Restoring replaces all the data.** Do it only after a loss, never to fix one
row.

1. **Pick the copy.** The keys are dated: `backups/2026-09-16T02-00-00-000Z.jsonl.gz`.

   ```bash
   npm run backup:list --workspace backend
   ```

2. **Check what is in it before touching anything**: the command prints the row
   counts per table without writing.

   ```bash
   npm run backup:inspect --workspace backend -- backups/<key>
   ```

3. **Restore**, on the environment whose `DATABASE_URL` is set in the shell. It
   empties the five tables and inserts the copy in one transaction: either the
   whole copy lands, or nothing changes.

   ```bash
   npm run backup:restore --workspace backend -- backups/<key> --yes
   ```

   Without `--yes` it refuses and changes nothing.

4. **Check the application**, not just the row counts: sign in, open a campaign,
   and confirm the contact statuses match what the logs say.

What the copy does not hold: the attachments (they are in the same bucket, under
`campaigns/`, and are not deleted by a database loss), the sessions (everyone
signs in again), and the queue (the plan re-queues every pending contact within
fifteen minutes).

---

## Other procedures

- **Rotating the encryption key**: [security.md](security.md#routine-rotation) (and, if the key leaked, the section after it).
- **A user asks for their data or for deletion**: both are self-service on the account page (`/account`). A deletion also revokes Google access and purges the attachments; if Google could not be told, the user is shown how to remove access themselves.
- **Google OAuth errors at sign-in** (`redirect_uri_mismatch`, `access_denied`, `invalid_grant`): [google-oauth-setup.md](google-oauth-setup.md).
