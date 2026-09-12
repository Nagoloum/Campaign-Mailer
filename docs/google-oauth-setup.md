# Google Cloud and OAuth setup

What Campaign Mailer needs from Google, and in what order. Everything here happens in the Google Cloud console; none of it can be done from the codebase.

Do this early. The verification request in step 6 can take weeks, and it is the one Phase 0 item that can hold up the public launch.

---

## 1. Create the project

[console.cloud.google.com](https://console.cloud.google.com) → project picker → **New project**.

Name it `campaign-mailer`. No organization is needed for a personal account.

---

## 2. Enable the Gmail API

**APIs & Services** → **Library** → search `Gmail API` → **Enable**.

Enable nothing else. Every additional API is a question to answer during verification.

---

## 3. Configure the OAuth consent screen

**APIs & Services** → **OAuth consent screen**.

| Field                 | Value                                         |
| --------------------- | --------------------------------------------- |
| User type             | **External**                                  |
| App name              | Campaign Mailer                               |
| User support email    | `landhack049@gmail.com`                       |
| Developer contact     | `landhack049@gmail.com`                       |
| Application home page | The production URL, once it exists            |
| Privacy policy link   | Required for verification; written in Phase 6 |
| Terms of service link | Same                                          |

**Internal** is not an option here: it exists only for Google Workspace organizations, and it would restrict the app to a single domain.

Leave the app in **Testing** while developing. Testing works immediately and is capped at 100 users, which covers the alpha in Phase 8.

**Add your own address to the test users before trying to sign in.** Owning the Google Cloud project grants nothing: while the app is in Testing, only the addresses on that list get past the consent screen, the developer's included. Without it Google answers `Erreur 403 : access_denied` and says the app has not completed verification, which reads like a problem with the app rather than a missing list entry.

In the current console the list sits under **APIs & Services** → **OAuth consent screen** → **Audience** → **Test users** → **+ Add users**. Older layouts put _Test users_ directly on the consent screen page.

The change takes effect immediately. If the refusal persists, open a private window: the browser caches the denied decision.

---

## 4. Request the scopes

On the same screen, **Add or remove scopes**:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
https://www.googleapis.com/auth/gmail.send
```

`gmail.send` is a **sensitive scope** and the only one that carries weight in review. It allows sending as the user and nothing else — it cannot read the mailbox, which is exactly the argument to make during verification.

Do not add `gmail.readonly`, `gmail.modify` or any Drive scope. `gmail.modify` and `gmail.readonly` are **restricted** scopes, a heavier tier than sensitive, and they would pull the project into an annual third-party security assessment. The reply-detection feature in Phase 9 is the one thing that would need read access; treat that as an architectural decision, not a checkbox.

---

## 5. Create the client credentials

**APIs & Services** → **Credentials** → **Create credentials** → **OAuth client ID** → **Web application**.

Name: `campaign-mailer-web`.

**Authorized redirect URIs** — add both now, so production does not need a second trip:

```text
http://localhost:3000/api/auth/google/callback
https://YOUR-PRODUCTION-DOMAIN/api/auth/google/callback
```

Google matches these character for character. A trailing slash, `http` instead of `https`, or `127.0.0.1` instead of `localhost` all produce `redirect_uri_mismatch`.

Authorized JavaScript origins are not needed. The OAuth flow is server-side; the browser never holds a token.

Copy the two values into `backend/.env`:

```text
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

The client secret is a real secret. It belongs on the backend only, never in a `VITE_` variable, because Vite inlines those into the bundle.

---

## 6. File the verification request

Still on the consent screen, **Publish app** → the verification form.

Google will ask for a demo video showing the consent flow and what the app does with the scope, a privacy policy at a URL on the app's own domain, and a written justification of why `gmail.send` is necessary.

The justification writes itself: the application sends email on the user's behalf from the user's own account, which is the purpose the user signs up for, and it requests no read access to the mailbox.

Filing this before the app is finished is deliberate. Review runs on Google's schedule, development runs on yours, and only one of them is under your control.

---

## What breaks, and what it means

| Symptom                                | Cause                                                                                                                                                                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch`                | The callback URL differs from the registered one. Compare them character by character, including the scheme and any trailing slash.                                                                                        |
| `access_denied` while in Testing       | The account is not in the test-user list. Owning the project does not exempt it. See step 3.                                                                                                                               |
| No refresh token on the second sign-in | Google returns one only on first authorization. The backend requests `access_type=offline` and `prompt=consent` to force a new one, and never overwrites a stored refresh token with an empty value.                       |
| `invalid_grant` after some days        | The refresh token was revoked: the user removed access, changed their password, or the app is still in Testing, where refresh tokens expire after seven days. This last one is a reason to finish verification, not a bug. |
| Sends stop around 100 or 150 a day     | Gmail's own cap. `GMAIL_DAILY_LIMIT` stays below it on purpose.                                                                                                                                                            |

---

## Checklist

- [ ] Project created
- [ ] Gmail API enabled
- [ ] Consent screen configured, External, in Testing
- [ ] Own address added as a test user
- [ ] The four scopes requested, and no others
- [ ] Web client created, both redirect URIs registered
- [ ] `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`
- [ ] Verification request filed
