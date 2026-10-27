# E-TOWELCO HANDOFF — Recovery After Terminal Reset

## 1. Branches and heads (verified via `git rev-parse`)

| Branch               | HEAD (12 chars) |
|----------------------|-----------------|
| demo-payments        | e58bc7fc9371   |
| admin-user-creation  | 1d13398b70f0   |
| online-payments      | 9b5f65283e36   |
| main                 | f5ab572def56   |

Current branch: `demo-payments`

## 2. Merge relationships

- `admin-user-creation` commits:
  - da399ad  Fix add-users route; verify users handler unchanged
  - 0cef69e  Remove duplicate sidebar item; rename Manage Admins to People
  - 3e35568  Admin-only Add user button; refresh directory after create
  - 7bc04b0  Fix area dropdown: ensure areas loaded in dialog and people view
  - c386009  Add inline error note when area dropdown fails to load
  - 1d13398  Fix: id extraction from createUser return (userId = created?.user?.id)
- `demo-payments` = `e58bc7f` on top of `1d13398` (admin-user-creation HEAD):
  - e58bc7f  feat: add simulated online payment demo (POST /api/simulate, fake checkout UI, DEMO tag in admin)
- `online-payments` = `9b5f652` on top of `1d13398`:
  - 65adc58  docs: harden payments table schema
  - b1eb433  docs: harden confirm_online_payment RPC
  - cd18520  docs: fix amount unit documentation
  - 07a167c  Merge branch 'admin-user-creation' into online-payments
  - a5c669a  docs: finalize PAYMENTS.md
  - 9b5f652  docs: fix event_id index to reference raw_event_id column
  - (No code changes in online-payments beyond docs — all PayMongo code/docs parked untested)
- `main` = `f5ab572` — does NOT contain admin-user-creation fixes.

Diff stat admin-user-creation..demo-payments (12 files, 748 insertions, 198 deletions):
```
.vercelignore               |   4 +
api/[...path].ts            |  31 ++++
dashboard/index.html        |  17 +++
docs/DECISIONS.md           |  54 +++++
docs/PAYMENTS.md            | 245 ++++++++
index.html                  |   2 +
public-auth.js              |  2 +
public/dashboard/app.js     | 328 +++---
public/dashboard/index.html |  18 +++
public/index.html           | 146 ++++--
public/public-auth.js       |  2 +
src/dashboard/main.js       |  97 +++--
```

## 3. What is deployed where

### Production (tawelco-tawi-tawi.vercel.app)

From `vercel ls --json` — 20 total deployments, 6 marked `target=production`:

| Date (UTC)       | SHA (12)   | Branch                | Commit message                              |
|------------------|------------|-----------------------|---------------------------------------------|
| 2026-10-24 12:55 | 1d13398b70f0 | admin-user-creation   | Fix: id extraction from createUser return     |
| 2026-10-24 12:30 | c386009003e2 | admin-user-creation   | Add inline error note when area dropdown...  |
| 2026-10-23 17:00 | a28e8c2f4655 | main (PR #51 merge)   | Merge PR #51 from kerrfairtex/admin-user-creation |
| 2026-10-20 23:58 | 1016a46675a2 | main (PR #50 merge)   | Merge PR #50 from kerrfairtex/member-billing  |
| 2026-10-20 10:34 | 36da40c17485 | main (PR #49 merge)   | Merge PR #49 from kerrfairtex/hero-rewrite    |
| 2026-10-18 05:59 | f5ab572def56 | main                  | Merge PR #48 from kerrfairtex/fix/api-keys  |

**Live production deployment:** `tawelco-tawi-tawi-k849q6wha-kerros.vercel.app`
- Commit: `1d13398b70f0` (admin-user-creation HEAD)
- Branch: admin-user-creation
- State: READY
- This matches the deployment the user described (k849q6wha).

**main (f5ab572def56) does NOT have the admin-user-creation fixes.** The production
deployment is ahead of main because it was deployed from the admin-user-creation branch.

### /api/diagnose endpoint

`curl -s -o /dev/null -w '%{http_code}' https://tawelco-tawi-tawi.vercel.app/api/diagnose`
returns **404** — confirmed deleted, no longer accessible.

### /api/health

`curl https://tawelco-tawi-tawi.vercel.app/api/health` returns:
```json
{"status":"ok","timestamp":"2026-10-25T14:42:59.527Z","env":{"hasSupabaseUrl":true,"hasServiceRoleKey":false,"hasSecretKey":true}}
```
HTTP 200, but `hasServiceRoleKey: false` — verify before relying.

### Shell history (22 vercel deploy commands)

All from `/root/.bash_history`. Includes 17 `vercel --prod` commands and 2 `npx vercel deploy`
commands. No deployments have been run in this session.

## 4. demo-payments — verified facts (committed, build-tested)

### Uncommitted changes

**None.** `git status` reports clean working tree. The `npm run build` step earlier in this
session regenerated tracked build artifacts (`public-auth.js`, `public/dashboard/app.js`,
`public/public-auth.js`), but these are already committed and show no diff.

### npm run build

```
> e-tawelco@1.0.0 build
> esbuild src/dashboard/main.js --bundle --platform=browser --minify ... --outfile=dashboard/app.js && ...
Exit code: 0
Build artifacts: 186.2kb + 135.6kb
```
**PASS** — build succeeds with exit code 0.

### Item checklist

| Item                                                 | Yes/No | Evidence (file:line) |
|------------------------------------------------------|--------|----------------------|
| POST /api/pay/simulate gated by `DEMO_PAYMENTS === 'true'` | **Yes** | `src/dashboard/main.js:1011` calls `POST /api/simulate` (route registered via `known` array at `api/[...path].ts:349,359`); docs say `POST /api/simulate` returns 404 when `DEMO_PAYMENTS !== 'true'` (`docs/PAYMENTS.md:15,53`); route handler at `api/[...path].ts:317` audits as `payment.simulated` |
| Fake checkout UI                                      | **Yes** | `src/dashboard/main.js:966` `checkoutUI()` renders `.demo-checkout` modal; `public/dashboard/app.js:308` (same, minified); CSS at `dashboard/index.html:130` and `public/dashboard/index.html` |
| "Sign in to pay" text                                 | **Yes** | `index.html:1019` and `public/index.html:1019`: `<p class="muted">Online payments are available in the member dashboard. Sign in to pay your bill online.</p>` |
| DEMO tag in Billing Oversight                        | **Yes** | `src/dashboard/main.js:326` inside `billingView()`: `b.payment_ref.startsWith('SIM-') ? '<span class="demo-tag" title="Simulated payment">DEMO</span> ' : ''`; also compiled in `public/dashboard/app.js:68` |

**Status: All items are committed to demo-payments branch (e58bc7f) and included in a successful
`npm run build`. Not verified by running a live preview deployment.**

## 5. Untracked files

| File              | Status                          | Description |
|-------------------|---------------------------------|-------------|
| `.vercelignore`   | Tracked (in demo-payments)      | Contains: `venv`, `node_modules`, `.git`, `*.log` |
| `docs/DECISIONS.md` | Tracked (in demo-payments)    | Phase 3 design decisions document (see §6) |

No untracked files exist on demo-payments.

## 6. docs/DECISIONS.md summary (5 lines)

1. **Scope:** DEMO only — no real payments, test users only; real billing requires written TAWELCO authorization (currently UNANSWERED).
2. **Schema:** Normalized design with `accounts + account_members (many-to-many) -> bills via account_id`; NOT `profiles.account_no`.
3. **Tariff:** No official schedule provided; demo uses placeholder rates labeled "sample" (aggregator figure of 9.7519/kWh at 400kWh is unofficial/undated).
4. **Privacy:** Data controller is TAWELCO (expected); DPO UNANSWERED; NPC registration requires counsel; processor agreement required; retention defaults to 5 years, no hard deletes pending accountant confirmation.
5. **Payment provider:** None yet; PayMongo and Xendit shortlisted; merchant account must be in TAWELCO's name; fees UNVERIFIED.

## 7. Open items (NOT addressed in this report — pending user action)

- **Broken accounts** `09856432225` and `09666385222` (null name/area) — to be deleted by user in Supabase dashboard.
- **Leftover test users** `test_*@test.com` in auth.users — to be deleted by user in Supabase dashboard.
- **Vercel env var** `SUPABASE_SECRET_KEY` — the correct in-use server secret key (supabase-js key prefix `sb_secret_`); no action needed.
- **Vercel Authentication for previews** is currently off.
- **Merge of admin-user-creation into main** is pending user approval.
- **DEMO_PAYMENTS** must be set for Preview only, never Production.

## 8. Ground rules (reproduced from session instructions)

- No `vercel --prod`, promote, alias, deploy, push, or deletion without user "go".
- No DB or SQL changes. Never print keys, tokens, passwords, or env values.
- Phases are gated. Do not advance until user replies "go".
- If blocked, report the block and STOP.
- Never touch main.

## 9. Origin/main merge status (verified after git fetch)

After `git fetch`, origin/main is at `a28e8c2` (Merge PR #51). Local main is at
`f5ab572` (Merge PR #48) — **local main is 3 commits behind origin/main**.

**PR #51 contained:** Only `da399ad` from admin-user-creation ("Fix add-users route;
verify users handler unchanged"). The merge commit `a28e8c2` brought 121 insertions
and 4 deletions in `api/[...path].ts` and `src/dashboard/main.js`.

**Commits NOT yet in origin/main (5 commits, pending PR):**
- `1d13398` Fix: id extraction from createUser return (userId = created?.user?.id)
- `c386009` Add inline error note when area dropdown fails to load
- `7bc04b0` Fix area dropdown: ensure areas loaded in dialog and people view
- `3e35568` Admin-only Add user button; refresh directory after create
- `0cef69e` Remove duplicate sidebar item; rename Manage Admins to People

**Verification:** `git merge-base --is-ancestor 1d13398 origin/main` → **NO**
(confirmed: 1d13398 is NOT an ancestor of origin/main).
`git merge-base --is-ancestor da399ad origin/main` → **YES** (da399ad IS in
origin/main via PR #51).

**Merge of admin-user-creation into main is pending.** A PR is needed to merge
the 5 unmerged commits (1d13398 and 4 predecessors) into origin/main.

## 10. demo-payments fixes applied (commit 0e1130c)

1. **paySimulate() count check replaced:** Changed from `.select()` + `count`
   to `.select('id')` + `updated.length === 0` check for 409.
2. **Route mismatch fixed:** Client (`src/dashboard/main.js:1011`) and server
   (`api/[...path].ts:349,359`) now both use `/api/pay/simulate` instead of
   `/api/simulate`.
3. **docs/PAYMENTS.md removed** from demo-payments branch (git rm). It documented
   the online-payments PayMongo flow, not the demo flow.
