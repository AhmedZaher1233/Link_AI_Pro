# playwright-cli — how every browser action is issued (steps 3, 6, 8)

`playwright-cli` (npm `@playwright/cli`, Microsoft) drives a real browser from the command line:
one Bash call per action, a named session that keeps cookies and pages between calls, page
snapshots written to `.playwright-cli/*.yml`, targeted reads (`find`, element `snapshot`, `eval`).
There is no tool schema to load and no page tree forced into the context — the same mechanics as
skill 3c. Everything below is about issuing commands; what to execute, how to judge it and what
each outcome is called is `execution-rules.md`. Every command is pre-approved only as
`playwright-cli …` or `npx --no-install playwright-cli …` (SKILL.md front-matter); `--help
[command]` is the reference when a flag below does not exist in the installed version — never
guess a flag, read the help.

## 1. Availability probe — before any application ask

1. `playwright-cli --version` → global install (what `/sync-skills --tools` provides). Not found →
   `npx --no-install playwright-cli --version` → a project-local copy. Record the working prefix
   as `{pw}` for the whole run and print the version in the structured return.
2. Neither works → **BLOCKED** immediately: "playwright-cli is not installed — run
   `/sync-skills --tools` (installs playwright-cli and its browser) or
   `/link-qc-1-generate-update-testing-structure repair`, then re-run this skill". No application ask, no
   credentials question, no `npm` command from you, no fallback to the Playwright MCP server.
3. Browser check happens with the first `open` (§2): an error naming a missing browser
   executable → the same BLOCKED with the same hint (`install-browser` is sync's job, not yours).
4. `.gitignore` without a `.playwright-cli/` line → one warning in the final message ("snapshot
   files under `.playwright-cli/` are not git-ignored — `/sync-skills --tools` adds the line");
   the run continues and §8 deletes the run's files anyway.
5. `--audit` stops after the plan line (`run-plan.md` §2); the probe is the only command it runs.

## 2. Sessions — one per account, opened once, always closed

- Name: `qa5b-{storyId}-{accountId}` (e.g. `qa5b-1234-A1` for the account the TCs reference as
  `[A1]`); multi-story runs reuse the account's session across stories. Open:
  `{pw} -s=qa5b-{storyId}-{accountId} open {baseUrl}` — `{baseUrl}` is the `Value` of the
  `TEST-DATA` §0 row the TC references (`[E1]` for the portal; another `[E{n}]` opens that
  service) — add `--headed` when the account logs in attended (§3 A) or when the user asked to
  watch. Every later command for that account carries the same `-s=…`.
- Never `--persistent`, never `--profile`, never `state-save` / `state-load`, never `attach` to a
  user's own browser: the session's cookies live in memory for this run only.
- The session persists across TCs; the **page state does not** — between two TCs navigate to the
  landing screen (or log out and in again when the next TC needs another account or a fresh
  login) so that no TC starts from a previous TC's screen (`execution-rules.md` §2).
- A headless session shuts down after an hour idle; a command that fails with "no session"
  **inside a TC** makes that TC `INCOMPLETE — interrupted: session lost at step {n}` (§9); then
  `open` again with the same name, log in again per the chosen method, continue with the NEXT TC.
- **Close every session you opened** — `{pw} -s=… close` for each — at the end of the run **and**
  before any BLOCKED return; then `{pw} list` and mention "sessions closed" in the final message.
  Never `close-all` / `kill-all`: other work on the machine may own sessions.
- **Machine capacity — one hold per session, BEFORE its `open`.** A playwright-cli browser counts against the same
  machine worker ceiling as skill 5's Playwright runs and skill 9's browsers. Skill 5's script, called by path (never
  copied): `node .claude/skills/link-qc-5-test-run-automation/scripts/capacity.mjs hold acquire --run-id {runId}
  --session {session} --label "playwright-cli {session}" --wait 600000 --strict` — `{runId}` =
  `skill5b-{storyId}-{yyyymmddThhmmZ}` (UTC), one per invocation; `{session}` = the `-s=` name above.
  - Exit 0 → keep the payload's `token`, `open`, then once `capacity.mjs hold track --token {token}` (records the
    session's daemon and browser). Acquiring the same session again — a re-`open` after "no session" — reuses its hold;
    a browser is never counted twice.
  - Exit 1 after the wait (the machine is at its ceiling — a skill 5 run or other browsers use it) → never open the
    browser anyway: every not-yet-executed TC of that account is `NOT_RUN — not started: admission timeout (machine at its worker ceiling)`, reported, never PASS. Exit 2 → **BLOCKED** with the payload's `error`.
  - Skill 5 not installed (no `capacity.mjs` at that path) → **BLOCKED**: "machine coordination unavailable — install
    link-qc-5-test-run-automation with /sync-skills". Never a browser outside the ceiling.
  - After each `close`: `capacity.mjs hold release --token {token} --wait 30000 --strict` — exit 0 = confirmed closed;
    exit 1 = the session still runs: `close` it again and release again; still 1 → name it in the final message (the
    hold stays until a process table shows the session gone). Never `--force`, `sweep` or `reclaim`, never edit the
    ledger, never set `QA_LEDGER` / `QA_MAX_WORKERS` to get a browser. With `QA_LEDGER=off` a hold is exclusive:
    nothing else starts while it is held — release it as soon as the session closes.
  - The final message carries one line: `Machine capacity: {n} session hold(s) — released` (or what is still held).

## 3. Login — attended, or by secret name; never a password from you

The combined ask (`intake.md` §3) chose a method **per account** the TCs reference (`[A{n}]` —
role and username from `TEST-DATA` §1; the role alone never identifies an account):

**A. Attended login.** `open {loginUrl} --headed` for that account's session, then ONE
`AskUserQuestion`: "A browser window is open for {role} [A{n}]. Log in there yourself, then
answer *done*." (One question per account; with two accounts, two windows, two answers — one at
a time.) On *done*: `find` a post-login marker the TC document or the learning file names (user
menu, the landing screen's heading); not found → report exactly what the page shows, ask once
more, then the failure rule (`execution-rules.md` §6). Works with SSO / MFA; the model never sees
a credential.

**B. Secrets file.** The user ran skill 1's `set-playwright-secrets.ps1` / `.sh` once (the script
is skill 1's and is never edited here); it stores `{NAME}_USER` / `{NAME}_PASSWORD` entries in a
dotenv file outside the repository and points the user-level variable
`PLAYWRIGHT_MCP_SECRETS_FILE` at it (the CLI shares that setting with the Playwright MCP backend,
which substitutes a secret NAME typed into a field with its value and masks the value in every
output). **Secret names follow the account ID** the TC references: `A1_USER` / `A1_PASSWORD` for
`[A1]`, `A2_USER` / `A2_PASSWORD` for `[A2]` — the user chose those names when running the
script, and the combined ask confirms them per account. You type only the names:
`{pw} -s=… fill <username-ref> A{n}_USER` then `{pw} -s=… fill <password-ref> A{n}_PASSWORD
--submit`. Then verify the login marker as in A. A name the file does not hold is a login
failure (report it, never guess another name).
**Probe on the first login:** login failed → `{pw} -s=… eval "el => el.value === 'A{n}_PASSWORD'"
<password-ref>` (compares the field to the literal key name; it never reads the value out). `true`
→ substitution is not supported by the installed version: stop using B for the run, say so, offer
A for that account (ONE question), and note the finding under the phase's `### Deviations`.
`false` → the credentials themselves were rejected: report, re-ask once (`execution-rules.md`
§6). Never retry a secret name blindly, never ask for the password in chat, never write a value
anywhere.

Whatever the method: the learning file records "login method used on {env}: attended | secrets
file" — a name, never a value — under `### Manual Run Model (skill 5b)` (`learning-file.md`).

## 4. Manual step → command map

| The TC step says | Command (always with `-s=…`) |
|---|---|
| open / navigate to a screen or URL | `goto <url>`; a menu path → `click` per hop (each hop a navigation → §6) |
| click / press / open / choose a menu item / select a row | `click <ref \| locator>` |
| enter / type a value | `fill <ref> "<value>"` (`--submit` when the step says "and press Enter"); `type` only when the step means keystrokes into the focused control |
| choose an option in a dropdown | `select <ref> "<option label>"` (native select); a custom dropdown → `click` the control, `find` the option, `click` it |
| tick / untick | `check <ref>` / `uncheck <ref>` |
| press a key | `press Enter` / `press Escape` / `press ArrowDown` |
| hover to reveal | `hover <ref>` |
| upload a file | `upload <path>` after clicking the control (a test-data file the `TEST-DATA` file names; never a file you create) |
| wait until … appears / loads | `run-code "async page => { await page.getByText('<text>').waitFor(); return 'ok' }"` (or `getByRole(...)`); default action timeout 5 s, raise only inside that call when the app is known slow — a ceiling that elapses is `timeout_failure`, never raised to make it pass |
| verify text / banner / row is shown | `find "<verbatim text>"` (`--regex` for numbers, dates, counts) — the match is the observation |
| verify a control is disabled / hidden / emptied / removed | `eval "el => ({disabled: el.disabled, hidden: el.hidden, value: el.value})" <ref>`; removed = `find` returns nothing **and** the element snapshot of its container lacks it |
| verify a value / count / total | `eval` on the element (`el => el.textContent.trim()`), or `find --regex` on the rendered number |
| verify the URL / title after navigation | `{pw} -s=… --json goto` result or a `run-code "async page => page.url()"` |
| switch the UI language | the app's own control (`click`), then a fresh snapshot (§6) — never a URL trick unless the TC says so |
| dialogs (confirm / alert) | `dialog-accept` / `dialog-dismiss` exactly as the step says |
| **type the prompt into the assistant** (AI TC) | `fill <composer-ref> "<prompt verbatim from the TC>" --submit`, or `fill` then `click` the send control when Enter does not submit; the prompt text is the TC's, never paraphrased |
| **wait for the reply** (AI TC) | `run-code` polling the last assistant message: read its text, wait ≥ 2 s, read again; done when two consecutive reads ≥ 2 s apart are identical (streaming has ended) — ceiling from the TC (`AI Oracle` / a wait step) or 60 s; the ceiling elapsing is `timeout_failure` |
| **read the reply** (AI TC) | `eval "el => el.innerText"` on the last assistant message — **the TEXT is what gets judged** (`execution-rules.md` §3, `ai-response-rules.md`), never a screenshot of it; the text goes into `reply.md` (§7) |
| **assertion-point screenshot** (every executed TC) | `screenshot --filename={screenshots_root}/phase-{N}/{TC-ID}/manual-cli--none--r{k}/attempt-{a}.png` taken at the moment the Expected Result is checked, **BEFORE any cleanup step** of a data-changing TC; on failure additionally `…/attempt-{a}-failed.png` of the contradicting state (§7) |

Values come from the TC step and the `TEST-DATA` file, never invented: a typed input is in the
step; a `[E{n}]` / `[A{n}]` / `[D{n}]` token is resolved through **its own** `TEST-DATA` row
(`execution-rules.md` §2) and the resolved value goes into the command, never into a report line.
A step starting with `[HUMAN]` maps to no command — the TC stops there (`execution-rules.md`
§3). A line starting with `[API]` / `[DB]` maps to no command either and is never improvised
(no `run-code` request, no shell query): it is skipped and the TC ends `PARTIAL — api/db step
pending` (`execution-rules.md` §3). A step you cannot map to one of these is not improvised: the TC fails `assertion_failure`
with the step named, and a `Q-{n}` (`open-questions.md`) asks what the step means.

## 5. Reading the page — small, targeted, never the whole tree

- **First visit of a screen**: `{pw} -s=… snapshot --depth=3` (a file under `.playwright-cli/`);
  read only the part you need — `Grep` for the labels the TCs mention, never `Read` the whole
  file. Element refs (`e12`) come from that snapshot.
- **After that**: `find "<label>"` (returns the matching nodes with their refs and a little
  context), `snapshot <ref>` for one region, `eval` for one value. No second full snapshot of a
  screen already understood, unless its state materially changed.
- **Prefer a locator over a ref** for an element whose verbatim label is already known:
  `click "getByRole('button', { name: 'Save' })"`, `fill "getByLabel('Email')" …`,
  `click "getByText('Products')"`. Locators survive re-renders, work in both locales with the
  captured label, and cost no snapshot. They are still code: they never enter the run report, the
  bug report, `reply.md` or the learning file's deliverable sections (describe the element in
  words there).
- `--raw` on actions whose page result you will not read (most `click` / `fill` calls) keeps the
  output short; `--json` when you need the page URL / title.

## 6. Stale refs — a ref is valid for one snapshot, on one page state

A ref belongs to the snapshot it came from and stops being valid when the page navigates or
re-renders. After `goto`, a `click` that navigates, `reload`, a tab switch, a locale switch, a
dialog, or any error whose text contains *not found*, *detached*, *stale*, *timeout* or *no
element*: take **one** targeted re-snapshot (`find` the element again, or `snapshot <container>
--depth=2`), retry the action **once** with the new ref. A second failure is an observation about
the application, judged by `execution-rules.md` §3: the element the step names is really absent →
`FAIL · app_bug` (implemented functionality) with the failure image; the page itself could not be
reached or driven for an environmental reason → one second attempt (`execution-rules.md` §3),
then `FAIL · environment_failure`. You do not loop.

## 7. Evidence — what you record for each executed TC

- **One assertion-point image per executed TC and attempt**:
  `{screenshots_root}/phase-{N}/{TC-ID}/manual-cli--none--r{k}/attempt-{a}.png` (`k` = the AI
  repeat index, `0` for a TC without repeats — `run-plan.md` §5; `a` = the attempt number, `1`
  unless an environment failure earned a second attempt). Taken when the Expected Result is
  checked, while the screen still shows the verified state — before a cleanup step, before
  leaving the page. Create the folders on first use.
- **Failure image** `attempt-{a}-failed.png` for every FAIL (and for an INCOMPLETE when a page is
  still open): the contradicting state as seen. A PARTIAL TC gets the image of its last executed
  step as its `attempt-{a}.png`.
- **`reply.md` for an AI TC**, beside the image in the same variant folder, one per repeat: the
  prompt sent (verbatim), the reply text (verbatim, from `eval`, never retyped), the wait time
  until streaming ended, each hard check with its result, the rubric score against the threshold
  and the verdict — scanned for secret echo before it is written (`self-review.md` 8). It is a
  transcript, never a judgment made from a screenshot.
- **Nothing under `screenshots/` is ever overwritten or deleted** — not an earlier attempt, not
  an earlier phase, not another TC's folder. An image the command failed to write is taken
  again under the same name while the verified state is still on screen; an image that exists
  but shows the wrong screen stays as it is and the TC is `INCOMPLETE · evidence_failure`
  (`execution-rules.md` §3) — never a second file for the same attempt.
- **Build / version**: `find` on the footer / about / health screen the environment note or the
  learning file points to; visible → the phase's `- **Build:**` bullet and every bug entry; not
  visible → `unknown`, never a guess.
- **Console / network** (`console`, `requests`) are read only when a screen misbehaves and only to
  describe the failure in words in a bug's `Evidence` line — never pasted into a report as a log.
- Evidence cells in the `### Results` table link the images by RELATIVE path from `{results_root}`
  (`[attempt-1.png](../../screenshots/…/attempt-1.png) · [failed](…/attempt-1-failed.png)`),
  never absolute, never `data:`.

## 8. Hygiene — leave nothing behind

- Snapshots the CLI writes land under `.playwright-cli/` in the project root (§1.4 for the
  gitignore warning). At the end of the run (and before a BLOCKED return) delete the
  `.playwright-cli/page-*.yml` and other files this run created — one command, under the normal
  permission flow, listed in the final message as "snapshot files removed". Images and `reply.md`
  under `{screenshots_root}` are deliverables and stay.
- `run-code` is used only for waits and reads on the current page (§4): never to write a file,
  read the environment, open another URL or touch storage.
- No `state-save`, no `cookie-*` / `localstorage-*` writes, no `route` mocks, no `tracing` /
  `video`: this skill observes the application as the user would.
- Sessions: §2 — closed, listed as closed.

## 9. Mid-run CLI failure

A command that fails for a tool reason (daemon gone, browser crashed, "no session") ends the TC
in flight as `INCOMPLETE — interrupted: session lost at step {n}` (its images so far stay; it is
not re-run this phase — the next phase runs it again). Then: report what failed, re-open the
session once, re-ask once if an attended login is needed again, and continue with the next TC.
A second tool failure in the same run → write back the honest partial result (every executed TC
keeps its status, every TC not reached is `NOT_RUN · not started: run blocked`), append the short
`### Run` section with `**Outcome:** BLOCKED — {reason}` and a `—` run-history row
(`execution-rules.md` §6), close the sessions and return BLOCKED with the unexecuted TC-IDs.

## 10. The Playwright MCP server

Never used by this skill — not as a fallback, not mid-run, not for one step; a run is
playwright-cli from start to end.
