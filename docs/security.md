# Security

How Campaign Mailer protects its users' accounts and data, what was checked, and what to do when something goes wrong.

---

## Review of 14 September 2026 (roadmap #78)

A full review of the codebase, not a diff, against access control, SQL injection, XSS in templates and CSV values, and IDOR on campaign and contact identifiers. **No high or medium vulnerability was found.** What was checked, and why it holds:

- **Every route requires a session**, except `/health`, the OAuth flow, `/auth/logout` and `/auth/me` (which answers 401 without one).
- **No IDOR.** Every campaign route loads the campaign with a query filtered on both its id and the signed-in user's id. Nested routes (contacts, attachment, stats, log export) resolve the campaign that way before anything else, and contacts are further filtered by campaign. Another user's campaign or contact answers 404, never 403.
- **No SQL injection.** Every query is parameterised. The column names of a campaign update come from a fixed allowlist; the only interpolated values are constants from the code.
- **No XSS through a contact.** Every CSV value merged into HTML is escaped, and after the merge an `href` or `src` starting with `javascript:`, `vbscript:` or `data:` is neutralised. The preview renders in an iframe with an empty `sandbox`. The frontend uses no `dangerouslySetInnerHTML`.
- **No header injection.** Recipient and sender addresses containing a line break or `< > , ; : "` are refused before a message is built; attachment names lose line breaks and quotes.
- **No formula injection** in CSV exports: a cell starting with `= + - @`, a tab or a carriage return is prefixed with an apostrophe, and every cell is quoted.
- **Tokens never leave.** Google tokens are encrypted at rest, never selected for an API response, never logged, and left out of the data export.

Three low findings were fixed at the time: a CSV value used as a link, a quote in an attachment's name, and a malformed `%` in an upload's filename header.

---

## Encryption keys (roadmap #79)

Google access and refresh tokens are stored encrypted with AES-256-GCM under `ENCRYPTION_KEY` (32 bytes, hex). The cipher encrypts with that key and decrypts with it or with any key listed in `ENCRYPTION_KEY_PREVIOUS`. That is what makes a rotation possible without signing anyone out.

### Routine rotation

Once a year, or whenever someone who had access to the key leaves.

1. Generate a new key:
   `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. In the secret manager of every environment that runs the API or the worker, move the current value of `ENCRYPTION_KEY` into `ENCRYPTION_KEY_PREVIOUS`, and set `ENCRYPTION_KEY` to the new key.
3. Redeploy the API and the worker. From now on new tokens are written under the new key; existing ones are still read through the previous key.
4. Re-encrypt what is stored:
   `npm run rotate:encryption-key --workspace backend`
   It prints counts only. It leaves untouched any token no configured key can read, and exits with code 2 if there were any.
5. Run it a second time: `reencrypted` must be 0.
6. Remove `ENCRYPTION_KEY_PREVIOUS` everywhere and redeploy. Destroy every copy of the old key.

Losing `ENCRYPTION_KEY` without a copy makes every stored token unreadable. Nothing is lost but the connection: each user reconnects Google and a new token replaces the old one.

### If the key is compromised

The key alone is not enough to use a token; the encrypted tokens are needed too, which means database access. Treat both as exposed.

1. **Rotate at once**, steps 1 to 6 above, without waiting.
2. **Assume the database was read** if there is any doubt. Then the tokens themselves are compromised, and re-encrypting them protects nothing. Revoke them: every user must reconnect. The quickest way is to clear the stored tokens (`UPDATE users SET google_access_token = NULL, google_refresh_token = NULL`); campaigns pause themselves at their next send with "reconnectez votre compte", and the users are told by email. Clearing the rows stops this application from using the tokens; a copy taken by an attacker stays valid at Google until it is revoked, so also ask each user to remove Campaign Mailer from their Google account's permissions page (<https://myaccount.google.com/permissions>), and reconnect.
3. **Rotate `SESSION_SECRET`** as well if the same secret store was reached. Everyone is signed out.
4. **Look at the audit log** (`audit_events`) for campaigns started or accounts exported in the period, and at Gmail's own activity for the accounts concerned.
5. **Notify.** A personal data breach is reported to the CNIL within 72 hours of becoming aware of it, and to the users concerned when it puts them at high risk (GDPR articles 33 and 34).

---

## Response headers (roadmap #85)

**The API** (`backend/src/config/security.ts`) serves JSON, the OAuth redirects and file downloads, never a page. Its Content-Security-Policy therefore allows nothing: `default-src 'none'`, `frame-ancestors 'none'`, `base-uri 'none'`, `form-action 'none'`. It sends `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy: same-origin`, no `X-Powered-By`, and HSTS for a year, subdomains included, in production only: sent from localhost it would stop a developer's browser reaching that host over plain HTTP.

**The web application** (`frontend/vercel.json`) needs a policy that allows its own scripts and styles:

| Directive         | Value                    | Why                                                                                   |
| ----------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `script-src`      | `'self'`                 | Only the bundle. No inline script, no CDN.                                            |
| `style-src`       | `'self' 'unsafe-inline'` | React style attributes, the rich-text editor and the toast library set inline styles. |
| `img-src`         | `'self' data: https:`    | The preview shows the images a user's email links to.                                 |
| `connect-src`     | `'self'`                 | The API sits behind the same domain.                                                  |
| `frame-ancestors` | `'none'`                 | The application cannot be framed by another site.                                     |
| `object-src`      | `'none'`                 | No plugins.                                                                           |

The preview's sandboxed iframe inherits this policy, so an email body can load images but never a script.

**The session cookie** (`backend/src/config/session.ts`, tested in `session.test.ts`) is `httpOnly`, `secure` in production, `sameSite: lax`, named `cm.sid`, and lives fourteen days. `lax` rather than `strict` because Google's redirect back to the callback is a cross-site navigation. It also withholds the cookie from a cross-site POST, which is what protects the state-changing routes from forged requests.

The headers of a real deployment are checked once it exists (Phase 8): `curl -sI https://<domain>/` and `curl -sI https://<domain>/api/health`.
