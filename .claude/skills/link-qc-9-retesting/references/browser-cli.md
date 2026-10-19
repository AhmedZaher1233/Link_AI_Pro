# playwright-cli route — retest a bug that has no automated TC (steps 3, 5)

Loaded by SKILL.md steps 3 and 5. Contract §7. `playwright-cli` (npm `@playwright/cli`) drives a
real browser from the command line: one Bash call per action, a named session that keeps cookies
between calls, snapshots written to `.playwright-cli/*.yml`, targeted reads (`find`, element
`snapshot`, `eval`). Commands are pre-approved only as `playwright-cli …` or `npx --no-install
playwright-cli …`; `--help [command]` is the reference when a flag below does not exist in the
installed version — never guess a flag. These are the same mechanics as skills 3c and 5b
(`link-qc-5b-test-run-manual-cli/references/browser-cli.md` is the fuller text).

## 1. What is executed

| Bug | Executed | Can change the TC row |
|---|---|---|
| automation bug whose TC has a row in the latest phase and whose approved TC document is readable | **the full TC**: every step from `TEST-CASES-{feature}.md` as written, `[A{n}]` / `[E{n}]` / `[D{n}]` tokens resolved through their OWN `TEST-DATA` rows, typed inputs inline; the bug's own Expected is checked on its step | yes (report-update.md §1) |
| automation bug otherwise (no row, document unreadable) | the bug's own `Steps to reproduce`, then its `Expected` | no — bug Status only |
| UI bug (skill 6 report) | the bug's own reproduction steps and Expected | no — ledger only |

A `[HUMAN]` step maps to no command: the TC stops there and its row is `PARTIAL — human step
pending` (never PASS); a bug behind that step is unobserved. A TC with an `AI Oracle` field is
judged from the reply TEXT per `../link-qc-5b-test-run-manual-cli/references/ai-response-rules.md`
(read when present; absent → the bug's own steps only, no row change). A step that cannot be mapped
to a command below is not improvised: the TC is `FAIL · assertion_failure` with the step named, and
the bug is unobserved.

**Outcome.** PASS only after the Expected result was positively observed (`find` / `eval` matched)
and its assertion-point image was taken. FAIL `app_bug` = the application contradicts the
Expected on an implemented screen. A login that fails, a screen that cannot be reached, missing
data or a tool failure is `NOT_RUN` for the bug (environment), after one second attempt — never a
product FAIL. Languages: the bug's language first; a second configured language for a
non-language-specific bug only when `language_switch` is configured (contract §7).

## 2. Availability probe — before the combined ask, only when a bug takes this route

1. `playwright-cli --version`, else `npx --no-install playwright-cli --version`; record the
   working prefix as `{pw}`.
2. Neither works → every playwright-cli-route bug is `NOT_RUN (playwright-cli is not installed —
   run /sync-skills --tools or /link-qc-1-generate-update-testing-structure repair)`; the
   automation-route bugs still run. No `npm` command from you, no fallback to the Playwright MCP.
   A missing browser on the first `open` gets the same result.
3. `.gitignore` without a `.playwright-cli/` line → one warning in the final message.

## 3. Sessions and login — never a password from you

- One session per account: `{pw} -s=qa9-{storyId}-{accountId} open {baseUrl}` (`--headed` for an
  attended login or when the user asked to watch). Every later command carries the same `-s=…`.
  Never `--persistent`, `--profile`, `state-save` / `state-load`, `attach`.
- Between two bugs (or two TCs) return to the landing screen, or log out and in again when the next
  one needs another account — no retest starts from the previous one's screen.
- **A. Attended** — `open {loginUrl} --headed`, then ONE question per account: "A browser window is
  open for {role}. Log in there yourself, then answer *done*." On *done*, `find` the post-login
  marker the TC document or the learning file names.
- **B. Secrets file** — the user ran skill 1's `set-playwright-secrets.ps1` / `.sh` once; type only
  the secret NAMES: `fill <username-ref> {NAME}_USER`, then `fill <password-ref> {NAME}_PASSWORD
  --submit`. `{NAME}` = the TC's account id (`A1` for `[A1]`); for a bug without a TC (UI bug) the
  name confirmed in the combined ask. First login failed → `eval "el => el.value ===
  '{NAME}_PASSWORD'" <password-ref>`: `true` = substitution unsupported → offer A for that account
  (ONE question) and add a Deviation; `false` = credentials rejected → report, re-ask once. Never
  retry a name blindly, never ask for a password, never write a value anywhere.
- The learning file records "login method used on {env}: attended | secrets file" under
  `### Azure Sync Model (skills 7 to 9)` — a method, never a value.

## 4. Step → command (always with `-s=…`)

| The step says | Command |
|---|---|
| open / navigate | `goto <url>`; a menu path → `click` per hop |
| click / choose / select a row | `click <ref \| locator>` |
| enter a value | `fill <ref> "<value>"` (`--submit` for "and press Enter"); `type` only for keystrokes |
| choose from a dropdown | `select <ref> "<label>"`; custom dropdown → `click`, `find` the option, `click` |
| tick / untick · press a key · hover | `check` / `uncheck` · `press Enter` · `hover <ref>` |
| upload a file | `upload <path>` — a file `TEST-DATA` names, never one you create |
| wait until … appears | `run-code "async page => { await page.getByText('<text>').waitFor(); return 'ok' }"` — the ceiling elapsing is `timeout_failure`, never raised to make it pass |
| verify text / banner / row | `find "<verbatim text>"` (`--regex` for numbers / dates) — the match is the observation |
| verify disabled / hidden / value | `eval "el => ({disabled: el.disabled, hidden: el.hidden, value: el.value})" <ref>` |
| switch the UI language | the app's own control per `language_switch`, then a fresh snapshot (§5) |
| dialogs | `dialog-accept` / `dialog-dismiss` as the step says |
| assertion-point image | `screenshot --filename={path}` (§6) at the moment Expected is checked, BEFORE any cleanup step |

## 5. Reading the page and stale refs

- First visit of a screen: `snapshot --depth=3` (a file under `.playwright-cli/`); `Grep` it for
  the labels the step names, never `Read` it whole. Afterwards `find`, `snapshot <ref>`, `eval`.
- Prefer a locator for an element whose label is known (`click "getByRole('button', { name: 'Save'
  })"`). Locators never enter a report, a bug entry or the learning file — describe elements in
  words there.
- A ref is valid for one snapshot. After a navigation, re-render, locale switch, dialog or an error
  saying *not found / detached / stale / timeout*: ONE targeted re-snapshot, retry ONCE. A second
  failure is an observation: the element is really absent → `FAIL · app_bug`; the page could not be
  driven → `NOT_RUN` (environment). No loops.

## 6. Evidence — never overwritten

- Automation bug with a TC: `{screenshots_root}/phase-{N}/{TC-ID}/retest-cli--{lang}--r1/attempt-{a}.png`
  (`a` = the next free number in that folder) at the assertion point, plus `attempt-{a}-failed.png`
  of the contradicting state on FAIL. N = the latest phase (report-update.md).
- UI bug: `BUG-{n}-retest-{pass|fail}-{date-time}-{language}.png` in the UI report's existing
  `evidence/<page>_<lang>/` folder.
- Build / version: `find` on the footer / about screen the learning file names; not visible →
  `unknown`, never guessed. Console / network only to describe a failure in words.
- An image the command failed to write is taken again under the same name while the state is still
  on screen; an existing file is never replaced.

## 7. Hygiene and failures

- At the end (and before any BLOCKED return): delete the `.playwright-cli/page-*.yml` files this run
  created (one command, normal permission flow, named in the final message), close every session
  you opened (`{pw} -s=… close`), then `{pw} list`. Never `close-all` / `kill-all`.
- `run-code` only for waits and reads on the current page; no `state-save`, `cookie-*`,
  `localstorage-*`, `route`, `tracing` or `video`.
- A tool failure (daemon gone, browser crashed, "no session") makes the bug in flight unobserved
  (`NOT_RUN — session lost at step {n}`); re-open once and continue with the next bug; a second
  tool failure stops the playwright-cli route — every bug not reached is `NOT_RUN (run blocked)`.
- Captured output is screened before anything is written: a line that looks like a token or a
  password is withheld.
