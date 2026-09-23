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

## 9. Windows: "the file vanished" — check the Recycle Bin

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
