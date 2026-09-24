---
name: git-push-existing-github-repo
description: >
  Push a local folder into an EXISTING GitHub repo (one that already has commits) safely —
  inspect the remote before touching it, preserve remote-only files such as CNAME and
  .github/workflows, and avoid force-push even when the local history is unrelated.
  Trigger on "push this to my GitHub repo", "帮我自动推送到 GitHub", "把本地文件夹推到已有仓库",
  "set up git and push for me", or any request to sync a local project to a repo you did not create.
agent_created: true
---

# Pushing a local folder into an existing GitHub repo

The repo you are pushing into is **not** a blank slate. It may be a live site.
Inspect first, decide second, write last.

## 0. Never trust "the repo is empty"

```bash
git ls-remote <url> main          # does main already exist?
```

```js
// with a PAT in process.env.TOKEN
GET /repos/<owner>/<repo>                              // private?, size, default_branch, permissions.push
GET /repos/<owner>/<repo>/commits?per_page=5           // history
GET /repos/<owner>/<repo>/git/trees/main?recursive=1   // every path + blob sha + size
GET /repos/<owner>/<repo>/pages                        // is this a GitHub Pages site?
GET /repos/<owner>/<repo>/actions/runs?per_page=25     // which workflows pass, which fail every time
```

Red flags this actually surfaces:

| Found | Why it matters |
|---|---|
| `CNAME` | custom domain. A blind overwrite **deletes the domain binding** — a live-site outage. |
| `.github/workflows/*.yml` + `build_type: workflow` | Pages is deployed **by Actions**. Delete the workflow and the site stops updating. |
| a workflow with 0 successes / N failures | GitHub adds one starter workflow per Pages setup attempt. Junk workflows fire on every push. |
| a remote file whose blob sha matches a local file that "vanished" | that local file was a deploy artifact, not an accidental deletion |

**Report all of this to the user before pushing.** Deleting a `CNAME` is not fixed by re-adding the file.

## 1. Fresh `git init` + remote history ⇒ do NOT `--force`

`git push` gets rejected (unrelated histories). `--force` works but discards remote history.
Instead, **graft the new tree onto the remote tip**:

```bash
git remote add origin <url>
git fetch origin main                    # writes FETCH_HEAD
git reset --soft FETCH_HEAD              # HEAD -> remote tip; index & worktree untouched
# the index still holds YOUR files, and HEAD is now the remote tip
git commit -m '...'                      # parent == remote tip  =>  fast-forward push
git push origin main
```

⚠ **`refs/remotes/origin/main` may never materialise** even though fetch prints
`* [new branch] main -> origin/main`, and `git update-ref` can return 0 without writing the file
(`for-each-ref` then shows nothing). `git reset --soft FETCH_HEAD` writes `refs/heads/main` fine.
**Anchor on `FETCH_HEAD`, never on `origin/main`.**

## 2. Preserve remote-only files explicitly

After `reset --soft`, the index is your folder — anything living only on the remote is about to be
**deleted**. Pull it back into both index and worktree:

```bash
git restore --source=HEAD --staged --worktree -- CNAME .github/workflows/ <more paths>
git add -A
```

Prove the diff is what you intend, with a set difference — **the "deleted" count is the thing to read**:

```bash
comm -23 <(git ls-tree -r --name-only HEAD | sort) <(git ls-files | sort)   # remote-only => will be DELETED
comm -13 <(git ls-tree -r --name-only HEAD | sort) <(git ls-files | sort)   # local-only  => will be ADDED
```

Then confirm the parent, i.e. that no force is needed:

```bash
[ "$(git rev-parse HEAD^)" = "$(git rev-parse FETCH_HEAD)" ] && echo 'fast-forward ✓'
```

## 3. Auth: `http.extraheader: Bearer` does NOT work for git-over-HTTPS

It works for the REST API and fails for `git fetch` / `git push` with
`could not read Username for 'https://github.com': terminal prompts disabled`.

Use a credential store file kept **outside the tracked tree**:

```bash
mkdir -p .git-secret                      # must be gitignored
printf 'https://x-access-token:%s@github.com\n' "$TOKEN" > .git-secret/credentials
git config --local credential.helper ""   # reset the inherited list first
git config --local --add credential.helper "store --file=$PWD/.git-secret/credentials"
```

⚠ Reset the list first. Git **accumulates** `credential.helper` across config files, so a global
`helper-selector` (Git Credential Manager) would otherwise still fire and can block on a GUI prompt.

Identity without asking the user for an email:

```js
GET /user     // -> { login, id, email: null when the user keeps it private }
```
```bash
git config --global user.name  "<login>"
git config --global user.email "<id>+<login>@users.noreply.github.com"
```

## 4. Line endings will bite you — prove it, don't assume it

`core.autocrlf=true` is common on Windows (often system-level, e.g. PortableGit's `etc/gitconfig`).
If the project mixes CRLF and LF files, normalisation silently rewrites one group on checkout and
**breaks byte-exact comparisons far from the scene of the crime**.

Two gates, both required:

```
# .gitattributes
* -text
```
```bash
git config --local core.autocrlf false
```

Evidence, not assertion:

```bash
git ls-files --eol saki.html markdown/README.md
# i/crlf w/crlf attr/-text    <- good
# i/lf   w/lf   attr/-text    <- good
```

## 5. `.gitignore` the regenerated artifacts

Suites that write screenshots / coverage / logs on every run make every diff noisy.
Ignore the **output directory only** — never the suite itself:

```
_verify/shots/
```

⚠ Adding a pattern does **not** unstage files already in the index:

```bash
git rm -r --cached _verify/shots
git add -A
```

## 6. Verify from the remote side

Local success messages are not evidence. Ask the server:

```bash
git ls-remote origin main                 # must equal local HEAD
```
```js
GET /repos/<o>/<r>/git/trees/main?recursive=1   // blob sha + size per path
```

Then assert **the thing the user actually asked for**. Example — "saki.html must become index.html":

```js
blobs.find(b => b.path === 'index.html').sha === blobs.find(b => b.path === 'saki.html').sha
```

⚠ The `/repos/...` `size` field is updated **asynchronously**; right after a large push it can still
show the old value. Trust the tree, not `size`.

### The push itself: what counts as success

The authoritative evidence is this line on stdout:

```
   d74aadf..61d09f5  main -> main
```

⚠ **Do not judge by exit code when you piped the command.** `git push | tail -4` reports *tail's*
status — a failed push looks like a success, and a successful one can look like a failure.
Same trap in `if git push ... | tail ...; then ...; fi`: the branch taken has nothing to do with
git. Run the push on its own, or read `${PIPESTATUS[0]}`.

⚠ **`git ls-remote` failing does NOT mean the push failed.** Flaky proxies give
`Empty reply from server` / `CONNECT tunnel failed, response 502`. Retry; a push that already
printed `old..new  main -> main` succeeded server-side.

⚠⚠ **Don't put backticks in a double-quoted `git commit -m "..."`.** The shell performs command
substitution *before* git ever sees the string, so `` `1.` `` becomes "run the command `1.`" —
which fails with `command not found` and **silently leaves an empty gap in the message**. Observed:

```
git commit -m "补 D：注入 `1.` `3.` `5.`（跳号）⇒ …"
  → bash.exe: line 1: 1.: command not found
  → the stored message reads:  补 D：注入   （跳号）⇒ …
```

The push still succeeds, so nothing tells you the message was mangled. Either use **single quotes**
for `-m`, or (better, for anything multi-line or containing code) write the message to a file and
use `git commit -F <file>`. Same trap applies to `$`, `!`, and `\` in double quotes.

### When the git transport is blocked, verify over the REST API

`api.github.com` often works when git-over-HTTPS does not, and it needs **no token for a public
repo**. Compare remote blob shas against `git hash-object` on the local files:

```js
const remote = await (await fetch(
  "https://api.github.com/repos/<o>/<r>/git/trees/<sha>?recursive=1",
  { headers: { "User-Agent": "verify", Accept: "application/vnd.github+json" } }
)).json();

for (const [remotePath, localPath] of pairs) {
  const e = remote.tree.find(x => x.path === remotePath);
  const local = execSync(`git hash-object "${localPath}"`).toString().trim();
  assert(e.sha === local, remotePath);   // byte-for-byte, not "looks right"
}
```

`GET /repos/<o>/<r>/commits/main` confirms the remote HEAD equals local `git rev-parse HEAD`.
Bonus: the tree entry's `mode` proves the exec bit survived (`100755` for a `chmod +x` script) —
worth asserting, since Windows checkouts and `core.filemode` drop it silently.

### When the git transport is blocked, *push* over the REST API — and make the shas match

Reading over the API is easy. **Writing** over it is possible too, and the trick that makes it safe
is: **replicate the commit metadata exactly, so the remote computes the *same* sha as your local
commit** ⇒ zero divergence, no rebase, `git status` stays clean.

Measured 2026-09-23: the local proxy answered `CONNECT tunnel failed, response 502` for `github.com`
**11 times over 4 minutes**, while `api.github.com` over a direct connection answered in 778 ms.
Check that split before doing anything clever:

```bash
env -u https_proxy -u HTTPS_PROXY -u http_proxy -u HTTP_PROXY git push origin main
#   "Could not connect to github.com:443"  ⇒ the proxy is REQUIRED; you can't just bypass it
#   success                                ⇒ just do that and stop reading this section
```

Then, per commit, in order:

```js
// 1. blob   — content must be the RAW bytes (base64); compare the returned sha to
//             `git rev-parse <sha>:<path>`
POST /repos/<o>/<r>/git/blobs    { content: <base64>, encoding: "base64" }

// 2. tree   — base_tree = the previous tree; entries from `git diff-tree`
POST /repos/<o>/<r>/git/trees    { base_tree, tree: [{ path, mode, type: "blob", sha }] }
//             ⚠ deletions: pass `sha: null` to drop the path from base_tree
//             compare the returned sha to `git rev-parse <sha>^{tree}`

// 3. commit — metadata copied verbatim from `git cat-file commit <sha>`
POST /repos/<o>/<r>/git/commits  { message, tree, parents, author, committer }
//             compare the returned sha to the local sha

// 4. ref    — ONLY after every sha above matched
PATCH /repos/<o>/<r>/git/refs/heads/<branch>  { sha, force: false }
```

⚠ **Gate every step on the local sha and bail out on the first mismatch.** Nothing before step 4
moves a ref, so an abort leaves the remote untouched (just a few dangling objects) — that is what
makes this safe to attempt. `force: false` then lets GitHub itself reject a non-fast-forward.

⚠ **The message must be byte-exact, including its trailing newline.** Don't retype it — read the raw
commit object and split on the *first* blank line:

```js
const raw = execFileSync("git", ["cat-file", "commit", sha]).toString();  // NOT `-p` + trim
const msg = raw.slice(raw.indexOf("\n\n") + 2);                           // keeps the final \n
```

⚠ **Dates.** Git stores `author <name> <email> <epoch> <+HHMM>`; the API wants ISO 8601. Build the
ISO **from the epoch plus the stored offset**, or the offset won't round-trip and the sha won't match:

```js
const off = (tz[0] === "-" ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
const iso = new Date((epoch + off * 60) * 1000)
  .toISOString().replace(/\.\d{3}Z$/, tz.slice(0, 3) + ":" + tz.slice(3));
```

⚠ Get the changed paths with `git diff-tree -r --no-renames --name-status -z <parent> <sha>` —
`--no-renames` turns `R100 old new` into `A`/`D` pairs, which keeps the parser trivial.

⚠ **Make it default to dry-run.** A script that writes to a remote should not write by default
(same principle as a cleanup script defaulting to "count only").

⚠⚠ **`execFileSync` defaults to a 1 MB `maxBuffer` — and you are about to read multi-megabyte blobs.**
This bit the implementation on a later real use: `git cat-file blob <sha>:index.html` for a **1.5 MB**
file blew up with `spawnSync git ENOBUFS` + `SIGTERM`, which reads like "git crashed" but is really
Node cutting the pipe. The stack pointed at the *helper*, not at the API call, so a quick skim of the
log is misleading. Give the buffer helper an explicit ceiling:

```js
const gitBuf = (...a) =>
  execFileSync("git", a, { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 });
```

⚠ It only bites **the first time a large file actually changes** — if that blob is already on the
remote, nothing reads it and the script looks perfectly healthy. **"It worked last time" is not
evidence**; check the ceiling while you are writing the script, not while you are debugging it.

A working implementation lives at `_verify/api-push.js` in the `G:\saki` project — it handles a
whole chain of pending commits, gates on every sha, and refuses to move the ref unless the final
commit sha equals the local one. Verified end-to-end: blob, tree and commit shas all matched,
the ref moved, and the push still triggered the Pages deploy normally.

⚠⚠ **That implementation was dead for a day and nobody noticed — because it used `execFileSync`.**
Re-measured 2026-09-24: `spawnSync` / `execFileSync` / `execSync` all return **`EBUSY`** in this
environment, so the script died on its very first `git rev-parse HEAD`:

```
Error: spawnSync git EBUSY   at git (api-push.js:36)   at api-push.js:105
```

It defaulted to dry-run, and **dry-run crashed too** — so there was no "I'll just try it and see"
path that would have surfaced the problem. A tool that a skill points at as *working* is worse than
no tool: it makes you stop looking. **Convert every git helper to async `spawn`** (collect
`stdout`/`stderr` chunks, resolve on `close` with code 0). Two side effects, both good: the 1 MB
`execFileSync` pipe ceiling (`ENOBUFS`) disappears entirely, and `await` forces the call sites to
be ordered explicitly.

⚠ **Before writing a new helper for this, search for the existing one.** This exact procedure was
already implemented and documented — and a later session re-derived it from scratch and wrote a
second, parallel script before noticing. `grep -rn "<keyword>" _verify/` and a look at the relevant
skill costs a minute; a duplicated 200-line tool costs the rest of the session and leaves two
copies to keep in sync.

⚠ **Map which hosts the proxy actually allows before concluding "the network is down".** Measured
through the same proxy in one sweep: `api.github.com` **200**, `codeload.github.com` **301**, while
`github.com`, `www.github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com` and
`gist.github.com` all fail (`CONNECT` never completes). Only `git push` / `git fetch` need the
blocked host; everything in this section runs on the allowed one.

## 7. Secret hygiene before pushing

```bash
git grep -l 'github_pat_\|ghp_\|sk-\|AIza\|Bearer ' HEAD
git ls-files | grep -c credentials        # must be 0
```

**A PAT pasted into the conversation must never reach a committed file.** Recommend revoking it once
the session is over.

## 8. Private repos lose GitHub Pages — and it does NOT come back by itself

On a free plan, Pages requires a **public** repo. Flipping a working Pages repo to private:

- `GET /pages` starts returning **404** — GitHub **deletes** the Pages site config, it does not just pause it
- the deploy workflow starts **failing** on every push
- the custom domain stops resolving

Say this out loud **before** flipping the switch.

### Restoring it (verified end-to-end)

`PATCH {"private": false}` is **not enough** — `/pages` stays 404. Re-create the site:

```js
// 1. re-enable Pages, matching the previous build type
POST /repos/<o>/<r>/pages  { "build_type": "workflow" }        // -> 201
//    (branch-based Pages instead: { "source": { "branch": "main", "path": "/" } })

// 2. the custom domain does NOT come back with it — set it explicitly
PUT  /repos/<o>/<r>/pages  { "cname": "example.com" }          // -> 204

// 3. nothing has deployed yet and the old runs failed. Trigger one:
POST /repos/<o>/<r>/actions/workflows/static.yml/dispatches  { "ref": "main" }   // -> 204
```

Then verify **from the outside**, comparing bytes rather than status codes:

```bash
curl -sI https://example.com/          # 200
# fetched length === local file length  &&  sha1 matches
```

⚠ `GET /pages` `cname` can read `null` right after re-enabling even though the repo has a `CNAME`
file at its root — the file alone does not populate the API view. Set it explicitly.
⚠ Re-check `https_enforced` too; re-enabling can leave it different from what it was.
⚠ HEAD responses are **compressed** — `content-length` on a HEAD will not equal the file size.
Use GET when you need to compare bytes.

## 9. The push was green but the site never changed — check for workflows fighting over one `concurrency` group

The nastiest deploy failure is the one that looks like success everywhere you'd normally look:
`git push` exits 0, a run *appears* in Actions, and the live site is still the old bytes.

Observed (2026-09-23, `MuyueJusan/YanSaki`): two consecutive pushes produced

```
static.yml  completed/cancelled   sha=68e9d84  created=07:57:58Z  updated=07:57:59Z
static.yml  completed/cancelled   sha=4002051  created=08:20:54Z  updated=08:20:55Z
```

### The tell: a cancelled run with **zero jobs**

```js
GET /repos/<o>/<r>/actions/runs/<id>/jobs     // -> { total_count: 0, jobs: [] }
```

An empty job list means the job was **never scheduled** — the run was cancelled while still
*pending*, not killed mid-flight. Combined with `updated_at - created_at ≈ 1s`, that rules out
"the build failed" and points straight at **concurrency**.

Also check `GET /repos/<o>/<r>/deployments` — it is the ground truth for "did a deployment actually
happen". A run cancelled while pending **never creates a deployment at all**, so the newest
deployment entry will still be an older, successful sha.

### The cause: N workflows, one `pages` group

```js
GET /repos/<o>/<r>/actions/workflows            // list every workflow + state
GET /repos/<o>/<r>/contents/<path>?ref=main     // read each one's `on:` / `concurrency:`
```

If several workflows all trigger on the same event (e.g. every one has
`on: push: branches: ["main"]`) **and** all declare `concurrency: { group: "pages" }`, they queue
into a single group. With `cancel-in-progress: false` a newly queued run **cancels any run already
pending** in that group — so a burst of simultaneous triggers makes them cancel *each other*, and
whichever one is pending at the wrong moment dies. GitHub's auto-added starter workflows are the
usual culprits:

```
active  Deploy Hugo site to Pages                                  .github/workflows/hugo.yml
active  Deploy Jekyll with GitHub Pages dependencies preinstalled  .github/workflows/jekyll-gh-pages.yml
active  Deploy static content to Pages                             .github/workflows/static.yml   <- the one you want
```

The Hugo / Jekyll ones are irrelevant for a plain static site and their `build` jobs **fail on every
push** — visible as extra `build : completed/failure` check-runs on the same commit, which is a good
secondary tell:

```js
GET /repos/<o>/<r>/commits/<sha>/check-runs
```

### Fix

**Unblock immediately, non-destructively** — dispatch only the correct workflow. `workflow_dispatch`
does not fire the push-triggered siblings, so it gets the group to itself:

```js
POST /repos/<o>/<r>/actions/workflows/static.yml/dispatches  { "ref": "main" }   // -> 204
```

Then poll the run to `completed/success` and compare the live bytes (see §6).

**Real fix** — delete the workflows you don't use, after asking the user. Leaving them in place
means any future push can be silently swallowed, and they keep painting failed check-runs onto
every commit.

### Two traps on the way there

⚠ **`GET /pages` returns 404 without a token even when Pages is perfectly healthy.** On a public
repo the unauthenticated view is just absent, so a 404 there is **not** evidence of "Pages is
broken" — it means "you didn't authenticate". With a token the same repo read
`status=null, build_type=workflow, cname=yansaki.top, html_url=https://yansaki.top/,
source={"branch":"main","path":"/"}, https_enforced=true`. Don't chase a 404 you caused yourself.

⚠ **Do not extract the token with `sed` into a shell variable.** Two independent footguns hit in
one sitting: a delimiter that also appears in the pattern (`s@…\([^@]*\)@…@` — `@` is both), and
passing the variable in the wrong position (`node -e '…' TOK="$TOK"` makes `TOK` a *script
argument*, not an environment variable ⇒ the script sees `undefined` and the API returns 401).
Read the credential file **inside Node** and call the API from Node — no shell quoting, no
`sed` dialect surprises, and no chance of echoing the secret:

```js
const line = fs.readFileSync(credPath, 'utf8').split(/\r?\n/).find(l => l.trim());
const TOKEN = line.match(/^https:\/\/[^:]+:([^@]+)@/)[1];   // never log TOKEN
```

## 10. Windows: "the file vanished" — check the Recycle Bin

Deletions in some sandboxed / agent environments are redirected to the Recycle Bin instead of being
unlinked. `G:\$RECYCLE.BIN\<SID>\` holds two files per deleted item:

| File | Meaning |
|---|---|
| `$I<id><ext>` | metadata: offset 8 = size (u64 LE), 16 = FILETIME (u64 LE), 24 = name length (u32), 28+ = original path (UTF-16LE) |
| `$R<id><ext>` | the actual deleted content |

Decoding the `$I` files yields **original paths + deletion timestamps** — enough to tell
"the user deleted it" from "something ate it", and to recover a file that disappeared mid-session.
If the Recycle Bin holds only your own scratch files (`*.bak`, screenshots, `index.lock`),
nothing external is deleting things — the deletions are yours.

## Checklist

- [ ] Inspected the remote (tree, Pages, Actions) **before** writing anything
- [ ] Told the user what would be deleted; got explicit confirmation for anything live
- [ ] `reset --soft FETCH_HEAD` — **no `--force`**
- [ ] Remote-only files restored; `comm` shows 0 unintended deletions
- [ ] Commit parent == remote tip ⇒ fast-forward
- [ ] `git ls-files --eol` shows the expected line endings
- [ ] Regenerated artifacts gitignored **and** un-staged
- [ ] Remote verified via `ls-remote` + tree blob shas
- [ ] No secrets in `git grep`; credential file untracked
- [ ] **Deploy actually landed** — the site's live bytes/sha1 match the local file, not just "the push succeeded"
- [ ] Only **one** workflow deploys to the `pages` environment (no Hugo/Jekyll starter workflows fighting it for the concurrency group)
