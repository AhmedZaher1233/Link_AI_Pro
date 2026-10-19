# playwright-cli — how every browser action is issued (steps 3, 8, 11)

`playwright-cli` (npm `@playwright/cli`, Microsoft) drives a real browser from the command line:
one Bash call per action, a named session that keeps cookies and pages between calls, page
snapshots written to `.playwright-cli/*.yml`, targeted reads (`find`, element `snapshot`, `eval`).
There is no tool schema to load and no page tree forced into the context — that is why this skill
exists. Everything below is about issuing commands; what to validate and how to judge it is
`walk-rules.md`. Every command is pre-approved only as `playwright-cli …` or
`npx --no-install playwright-cli …` (SKILL.md front-matter); `--help [command]` is the reference
when a flag below does not exist in the installed version — never guess a flag, read the help.

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
5. `--audit` stops after step 7 of the workflow; the probe is the only command it runs.

## 2. Sessions — one per role, opened once, always closed

- Name: `qa3c-{storyId}-{accountId}` (e.g. `qa3c-1234-A1` for the account the TCs reference as
  `[A1]`); multi-story runs reuse the account's session across stories. Open:
  `{pw} -s=qa3c-{storyId}-{accountId} open {baseUrl}` — `{baseUrl}` is the `Value` of the
  `TEST-DATA` §0 row the TC references (`[E1]` for the portal; another `[E{n}]` opens that
  service) — add `--headed` when the account logs in attended (§3 A) or when the user asked to
  watch. Every later command for that account carries the same `-s=…`.
- Never `--persistent`, never `--profile`, never `state-save` / `state-load`, never `attach` to a
  user's own browser: the session's cookies live in memory for this run only.
- A headless session shuts down after an hour idle; if a command fails with "no session" after
  a long gap → `open` again with the same name, log in again per the chosen method, continue.
  Freshness is unaffected (same environment, same build).
- **Close every session you opened** — `{pw} -s=… close` for each — at the end of the run **and**
  before any BLOCKED return; then `{pw} list` and mention "sessions closed" in the final message.
  Never `close-all` / `kill-all`: other work on the machine may own sessions.

## 3. Login — attended, or by secret name; never a password from you

The combined ask (`intake.md` §3) chose a method **per account** the TCs reference (`[A{n}]` —
role and username from `TEST-DATA` §1; the role alone never identifies an account):

**A. Attended login.** `open {loginUrl} --headed` for that account's session, then ONE
`AskUserQuestion`: "A browser window is open for {role} [A{n}]. Log in there yourself, then
answer *done*." (One question per account; with two accounts, two windows, two answers — one at
a time.) On
*done*: `find` a post-login marker the TC document or the learning file names (user menu, the
landing screen's heading); not found → report exactly what the page shows, ask once more, then the
failure rule (`walk-rules.md` §7). Works with SSO / MFA; the model never sees a credential.

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
A for that account (ONE question), and note the finding under Environment blockers so the comparison
report can record it. `false` → the credentials themselves were rejected: report, re-ask once
(`walk-rules.md` §7). Never retry a secret name blindly, never ask for the password in chat, never
write a value anywhere.

Whatever the method: the learning file may record "login method used on {env}: attended |
secrets file" — a name, never a value — under `### CLI Validation Model (skill 3c)`.

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
| wait until … appears / loads (P2) | `run-code "async page => { await page.getByText('<text>').waitFor(); return 'ok' }"` (or `getByRole(...)`); default action timeout 5 s, raise only inside that call when the app is known slow |
| verify text / banner / row is shown | `find "<verbatim text>"` (`--regex` for numbers, dates, counts) — the match is the evidence |
| verify a control is disabled / hidden / emptied / removed | `eval "el => ({disabled: el.disabled, hidden: el.hidden, value: el.value})" <ref>`; removed = `find` returns nothing **and** the element snapshot of its container lacks it |
| verify a value / count / total | `eval` on the element (`el => el.textContent.trim()`), or `find --regex` on the rendered number |
| verify the URL / title after navigation | `{pw} -s=… --json goto` result or a `run-code "async page => page.url()"` |
| switch the UI language | the app's own control (`click`), then a fresh snapshot (§6) — never a URL trick unless the TC says so |
| dialogs (confirm / alert) | `dialog-accept` / `dialog-dismiss` exactly as the step says |
| screenshot (only for a potential bug) | `screenshot --filename={tc_output_folder}/evidence/PB-{n}-{date}.png` (§7) |

Values come from the TC step and the `TEST-DATA` file, never invented: a typed input is in the
step; a `[E{n}]` / `[A{n}]` / `[D{n}]` token is resolved through **its own** `TEST-DATA` row
(`walk-rules.md` §3) and the resolved value goes into the command, never back into the TC. A step
starting with `[HUMAN]` maps to no command — the walk stops there (`walk-rules.md` §6a). A step
you cannot map to one of these is either a missing step to insert (`walk-rules.md` §5.2) or an
open question — never an improvised sequence.

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
  captured label, and cost no snapshot. They are still code: they never enter the TC document, the
  page or the learning file's deliverable sections (SKILL.md invariant 10 — describe the element
  in words there).
- `--raw` on actions whose page result you will not read (most `click` / `fill` calls) keeps the
  output short; `--json` when you need the page URL / title.

## 6. Stale refs — a ref is valid for one snapshot, on one page state

A ref belongs to the snapshot it came from and stops being valid when the page navigates or
re-renders. After `goto`, a `click` that navigates, `reload`, a tab switch, a locale switch, a
dialog, or any error whose text contains *not found*, *detached*, *stale*, *timeout* or *no
element*: take **one** targeted re-snapshot (`find` the element again, or `snapshot <container>
--depth=2`), retry the action **once** with the new ref. A second failure is that TC's
failure-rule outcome — `draft — not app-validated (screen could not be driven — {what failed})`,
listed under Environment blockers — and you continue with the next TC; you do not loop.

## 7. Evidence — what you record for each observed TC

- The stamp (`patch-rules.md` §2, `tc-format-contract.md`): `tool: cli` and one `outcome-check`
  line — what you looked at and what it showed (`walk-rules.md` §6a). No screenshot for a TC that
  matched.
- **Discrepancy** → exactly one screenshot of the contradicting state:
  `{pw} -s=… screenshot --filename={tc_output_folder}/evidence/PB-{n}-{date}.png` (create the
  `evidence/` folder on first use); its path goes into the PB's `pb-meta` `screenshot:` key —
  metadata, never a visible line of the five-line PB entry. A PB re-observed this run gets a fresh
  screenshot under a new date; older files stay (history).
- **Build / version**: `find` on the footer / about / health screen the environment note or the
  learning file points to; visible → into every stamp and the header stamp; not visible →
  `unknown`, never a guess.
- **Console / network** (`console`, `requests`) are read only when a screen misbehaves and only to
  describe the failure in words (an error banner, a request that failed) — never pasted into a
  deliverable.

## 8. Hygiene — leave nothing behind

- Snapshots and screenshots the CLI writes land under `.playwright-cli/` in the project root
  (§1.4 for the gitignore warning). At the end of the run (and before a BLOCKED return) delete
  the `.playwright-cli/page-*.yml` and other files this run created — one command, under the
  normal permission flow, listed in the final message as "snapshot files removed". PB
  screenshots under `evidence/` are deliverables and stay.
- `run-code` is used only for waits and reads on the current page (§4): never to write a file,
  read the environment, open another URL or touch storage.
- No `state-save`, no `cookie-*` / `localstorage-*` writes, no `route` mocks, no `tracing` /
  `video`: this skill observes the application as the user would.
- Sessions: §2 — closed, listed as closed.

## 9. Mid-run CLI failure

A command that fails for a tool reason (daemon gone, browser crashed, "no session") is handled
exactly like an unreachable app (`walk-rules.md` §7): report what failed, re-open the session
once, re-ask once if login is needed again, and on a second failure write back the honest partial
result, close the sessions and return BLOCKED with the unwalked TC-IDs. You never switch to the
Playwright MCP server mid-run or at all — a run is one tool from start to end, so its results can
be compared with 3b's.

## 10. When the MCP server would still be needed

Empty at delivery. A concrete capability the CLI could not provide during the comparison
(`cli-vs-mcp-comparison.md`) is recorded here — what was needed, which TC, what the CLI did
instead — so the decision about the default validator rests on evidence. A gap is never closed by
weakening a check (an unobservable expected result stays `draft`, never `validated`).
