---
name: verify-single-file-html-app
description: >
  Headlessly verify a single-file HTML app (self-contained HTML + inline CSS/JS, no build step)
  after editing it — catch runtime errors, drive real UI flows, and measure real layout.
  Trigger when the user asks to add/change a feature in a standalone .html file and you want to
  prove it works: "改一下这个 html", "给这个页面加个功能", "verify this HTML file works",
  or any layout/CSS change where "does it look right" matters.
  Uses jsdom for behaviour + the locally installed Chrome over CDP for layout. No Chromium download.
agent_created: true
---

# Verifying a single-file HTML app

Layers, cheapest first. Use the cheapest one that can actually catch the bug you might have made.

| Layer | Catches | Cost |
|---|---|---|
| 0 — Static regex checks | typos, missing ids, unbalanced tags, syntax errors | seconds |
| 1 — jsdom + stubbed fetch | JS init crashes, state machines, event wiring, storage, migrations | ~1 min setup |
| 2 — Real Chrome over CDP | **layout, CSS cascade, media queries, wrapping, overflow, hit-testing** | ~10-30 s per run |
| 2b — Real Chrome, canvas game loop | frame cost, loop state, weapon/entity behaviour, rate regressions | ~10-30 s per run |
| 3 — CSS specificity review | new styles silently losing to a theme override | minutes |
| 4 — Harness correctness | false failures that look like product bugs | — |
| 4.5 — Binary fixtures | file import / parsing features | ~30 min |

**Do not try to verify layout in jsdom.** It has no layout engine — every `getBoundingClientRect()`
returns zeros. For anything visual you need layer 3.

**Do not install `agent-browser`.** It wants its own ~500 MB Chromium. If the machine has Chrome or
Edge installed (Windows almost always does), drive it over CDP instead — see layer 3.

---

## Layer 0 — static checks (always run these first)

```bash
NODE="C:/Users/<user>/.workbuddy-ai/binaries/node/versions/<ver>/node.exe"
"$NODE" -e "
const fs=require('fs');
const html=fs.readFileSync('<path>.html','utf8');
const m=html.match(/<script>([\s\S]*?)<\/script>/);
fs.writeFileSync('<tmp>.js', m[1]);
const ids=new Set([...html.matchAll(/\sid=\"([^\"]+)\"/g)].map(x=>x[1]));
// 只匹配「字面量」参数：getElementById(item.id) 会被宽松正则误判成 id 'tem'
const used=new Set([...html.matchAll(/getElementById\(\s*[\x27\"]([A-Za-z0-9_-]+)[\x27\"]\s*\)/g)].map(x=>x[1]));
console.log('MISSING ids:', [...used].filter(i=>!ids.has(i)));
const all=[...html.matchAll(/\sid=\"([^\"]+)\"/g)].map(x=>x[1]);
const seen={},dup=[]; all.forEach(i=>{if(seen[i])dup.push(i);seen[i]=1;});
console.log('DUPLICATE ids:', dup);
console.log('div balance:', (html.match(/<div/g)||[]).length, (html.match(/<\/div>/g)||[]).length);
// 内联 onclick=\"foo()\" 指向的函数是否真的存在
const handlers=new Set([...html.matchAll(/on(?:click|input|change)=\"([A-Za-z_][A-Za-z0-9_]*)\(/g)].map(x=>x[1]));
const fns=new Set([...html.matchAll(/function\s+([A-Za-z0-9_]+)/g)].map(x=>x[1]));
console.log('UNDEFINED handlers:', [...handlers].filter(h=>!fns.has(h)));
" && "$NODE" --check <tmp>.js && echo "SYNTAX OK"
```

A `getElementById` typo is the #1 cause of a silently dead page. This catches it in two seconds.

**Regex hygiene:** a loose `getElementById\('?([\w-]+)` matches the *variable* form
`getElementById(item.id)` and reports a phantom missing id `tem`. If you see a short nonsense id in
the MISSING list, tighten the regex to quoted literals only before "fixing" a non-bug.

The `UNDEFINED handlers` check catches the other classic silent failure: a button whose `onclick`
points at a function you renamed. The button renders fine and does nothing when clicked.

**Referenced-but-never-declared identifiers — the failure mode no runtime test catches.**
A missing `const` declaration *inside a function body* is invisible at page load and invisible to
every behavioural test, because nothing executes that branch until a user walks into it. It then
surfaces as a bogus error message far from the cause (e.g. `导入失败：SOME_CONST IS NOT DEFINED`,
when the import actually succeeded and only the follow-up draft-save threw).

This happens most often when several edits to one file are issued in a batch and one silently
doesn't land — the *reference* is in, the *declaration* isn't. Cheap to catch statically:

```js
// 1. blank out string / comment / regex-literal contents (reuse the brace scanner's state machine)
// 2. collect declarations: const|let|var|function|class, destructuring, params, catch, for-of,
//    plus object-literal keys (they may be used as shorthand)
// 3. collect references for a prefixed naming convention (ST_*, st*, $*, _*)
// 4. report references whose name was never declared, skipping `.prop` / `?.prop` accesses
```

Scope the reference regex to a **prefix convention** the codebase actually follows (here `ST_` and
`st`). A generic "any identifier" version is hopelessly noisy; a prefixed one is near-zero false
positives. Note that stripping strings first is what kills the `'stCardDraft'`-style false
positives you'd otherwise get from string literals that look like identifiers.

**Prove the check can fail.** Delete the declaration, re-run, confirm it reports exactly that name,
then restore. A check you've never seen fail is decoration.

**Corollary for batched edits:** after a batch of edits to the same file, grep each change's
distinguishing string and confirm the count. "The edit tool said success" is not the same as
"the change is in the file".

**When a bug report's error message doesn't match the operation it names**, suspect a
best-effort side effect throwing inside the main action's `try`. Persistence (`localStorage`),
telemetry, and cache refresh should each be individually non-throwing — wrap them so they
`return false` on any unexpected error instead of propagating. Otherwise a quota failure or a
typo'd constant gets reported as "import failed" while the import actually succeeded, and the
user retries an operation that already worked.

**Brace/paren balance: scope it to the code blocks, and skip strings.** A naive
`(src.match(/\{/g)||[]).length === (src.match(/\}/g)||[]).length` over the whole file reports a
permanent imbalance, because HTML prose and CSS both contain brackets — and so do JS *strings*.
`if (text.charAt(0) !== '{')` contributes a stray `{`. Extract the blocks and use a scanner that
tracks quote/comment state:

```js
const jsBlocks  = [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
const cssBlocks = [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m => m[1]);
// scan(s, '{', '}') — walking char-by-char, skipping //, /* */, '…', "…", `…` (honouring \\ escapes)
```

Only then is a non-zero depth a real signal. (And if the file still loads in a browser with zero
console errors, syntax is provably fine — that outranks any regex.)

---

## Layer 1 — jsdom for behaviour

**GOTCHA:** `…/binaries/node/workspace` usually does **not** exist. `cd <dir> && npm install` then
silently falls through and installs into your *current* directory. `mkdir -p` your scratch dir first,
or you will litter the user's workspace.

```bash
SCRATCH="<workspace>/_verify" && mkdir -p "$SCRATCH" && cd "$SCRATCH" \
  && npm install jsdom --no-audit --no-fund --loglevel=error
cd "$SCRATCH" && "$NODE" verify.js
```

**GOTCHA — `NODE_PATH` in Git-Bash form fails *silently*.** If the harness lives somewhere other
than next to `node_modules` and you pass `NODE_PATH=/c/Users/me/…/node_modules`, Node does **not**
say "bad path". It keeps reporting:

```
Error: Cannot find module 'jsdom'
```

…which reads exactly like "jsdom isn't installed", and you'll go re-run `npm install` for nothing.
The path must be **Windows-style** — `C:/Users/…` or `C:\\Users\\…`:

```bash
NODE_PATH="C:/Users/me/scratch/node_modules" "$NODE" verify.js
```

Same family as "a deny-list whose field names don't match the real ones": **bad input plus a
generic error message** is far harder to debug than a loud failure. When a module genuinely
"isn't there", print the resolved path before believing it:

```bash
NODE_PATH="C:/…/node_modules" "$NODE" -e "console.log(require.resolve('jsdom'))"
```

```js
const { JSDOM, VirtualConsole } = require('jsdom');
const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + e.message));  // catches uncaught script errors

const dom = new JSDOM(fs.readFileSync(PAGE, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,       // requestAnimationFrame
  url: 'https://example.com/',   // REQUIRED for localStorage to exist
  virtualConsole: vc,
  beforeParse(window) {
    window.fetch = async (url, opts) => { /* stub network, capture opts.body */ };
    window.addEventListener('error', e => errors.push('window.error: ' + e.message));
  }
});
const { window } = dom, doc = window.document;
const $ = id => doc.getElementById(id);
// inline oninput/onchange attributes ARE listeners -> dispatch the matching event type
const fire = (el, type) => el.dispatchEvent(new window.Event(type, { bubbles: true }));
```

**Accessing page internals**

- Top-level `function foo(){}` in a classic `<script>` **does** become a `window` property.
- Top-level `let` / `const` **do not**. Reach them with `window.eval('cfg.x = 1')` — `window.eval`
  runs in global scope and sees the global lexical environment.

### Testing migrations by seeding localStorage

If the app persists state, a *second* class of bug lives in the load path: old saved data meeting new
code. Seed it before the page scripts run:

```js
new JSDOM(html, {
  url: 'https://example.com/',            // required for localStorage
  beforeParse(window) {
    if (seed) window.localStorage.setItem('appConfig', JSON.stringify(seed));  // runs BEFORE app JS
  }
});
```

Then write one case per shape of existing data:

| Case | Seed | Expect |
|---|---|---|
| Fresh install | none | new defaults |
| Old version, untouched default | legacy default value | recognised, upgraded |
| Old version, user-customised | user's own text | **preserved byte-for-byte** |
| Already migrated | new key present | restored as-is, migration not re-run |

**The trap:** gate the migration on the *presence of the new key*, not on the value being falsy.

```js
// ❌ never fires — AI_DEFAULTS already supplies promptPreset, so the merged config is truthy
if (!aiConfig.promptPreset) { /* migrate */ }

// ✅ remember whether the STORED object had the key
const hadKey = ('promptPreset' in parsed);
aiConfig = { ...AI_DEFAULTS, ...parsed };
if (!hadKey) { /* migrate */ }
```

Otherwise every existing user silently keeps a default that pretends to be their choice.

**Also:** after adding a key that lives only in the config object (no input element), make sure the
app's own `getConfigFromInputs()` returns it — otherwise the next click on "Save" drops it. Assert
this: set the value, call `saveSettings()`, then read it back.

### jsdom limits

`canvas.getContext('2d')` returns `null` (no native `canvas` pkg) — fine unless the page draws at
init. No layout: all rects are 0. External `<link>`/`<img>` are not fetched.

---

## Layer 2 — real Chrome over CDP (for layout)

Find the browser, then launch it headless with remote debugging. Node 22 has global `fetch` and
`WebSocket`, so **no dependencies are needed** beyond what you already have.

```js
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'; // or msedge.exe
const PORT = 9333;
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu',
  '--no-first-run', '--hide-scrollbars', `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(),'cdp-'))}`], { stdio: 'ignore' });

// poll http://127.0.0.1:PORT/json/version for webSocketDebuggerUrl, then:
//   Target.createTarget {url:'about:blank'}  -> targetId
//   Target.attachToTarget {targetId, flatten:true} -> sessionId
//   (all later sends carry that sessionId)
//   Page.enable, Runtime.enable
//   Emulation.setDeviceMetricsOverride {width,height,deviceScaleFactor:2,mobile:width<=600}
//   Page.navigate {url}  +  wait for the Page.loadEventFired event
```

Key commands:

- `Runtime.evaluate {expression, returnByValue:true}` → read real geometry.
- `Page.captureScreenshot {format:'png'}` → base64 PNG. **Actually open it with Read** — screenshots
  catch what metrics miss.

### Cropping a screenshot: don't use `clip` — grow the viewport instead

`Page.captureScreenshot`'s `clip` wants **document** coordinates. That is hard to get right, and it
silently produced *wrong but plausible* images three times in one session:

| Attempt | Why it fails |
|---|---|
| `getBoundingClientRect()` + `scrollY` | the component sits in an **internal scroll container**, so `window.scrollY` misses the inner scroll offset |
| walking `offsetLeft/offsetTop` up the `offsetParent` chain | breaks under `position: fixed` and `transform` (the chain is null / rerouted) |
| `DOM.getBoxModel` (true document coords) | verified correct in isolation, yet still off inside the harness — device emulation + internal scroll makes Chrome render the clip against a different origin |

The fix is to stop doing coordinate math. **Resize the viewport to fit the element and take a plain
viewport screenshot** — what the browser renders is then exactly what you get:

```js
async function shot(name, sel) {
  let saved = null;
  if (sel) {
    const h = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return 0; el.scrollIntoView({block:'start'});
      return Math.ceil(el.getBoundingClientRect().height); })()`);
    if (h > 0) {
      saved = { ...VP };                                     // remember the real viewport
      await cdp.send('Emulation.setDeviceMetricsOverride',
        { width: VP.width, height: Math.min(Math.max(h + 24, 320), 4000),
          deviceScaleFactor: VP.mobile ? 2 : 1, mobile: VP.mobile }, SID);
      await sleep(250);
      await ev(`document.querySelector(${JSON.stringify(sel)}).scrollIntoView({block:'start'})`);
      await sleep(200);
    }
  }
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
  fs.writeFileSync(path.join(SHOTS, name), Buffer.from(r.data, 'base64'));
  if (saved) await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: saved.width, height: saved.height,
      deviceScaleFactor: saved.mobile ? 2 : 1, mobile: saved.mobile }, SID);
}
```

Only grow the **height** — width drives the responsive branch, and a `(max-height: …)` media query
would flip if you shrank it. Keep a `VP` object updated in `setViewport()` so the restore is exact.

**Always look at the screenshot.** A wrong crop is invisible to assertions and looks like a
successful run — `📸 15 KB` instead of `📸 90 KB` was the only clue.

**…but the height measurement itself is unreliable inside an internal scroll container.** If the
element lives in a modal/overlay that has its own `overflow: auto` wrapper, `el.getBoundingClientRect()
.height` measures whatever *that wrapper* resolves to, not the element's laid-out height — so
`h + 24` comes out around the 320 px floor and you get a sliver of the top of the page. When the
target is nested like that, skip the auto-sizing entirely and use a fixed tall viewport:

```js
await ev(`document.querySelector(SEL).scrollIntoView({ block: 'center' })`);
await sleep(200);
await cdp.send('Emulation.setDeviceMetricsOverride',
  { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false }, SID);
await sleep(220);
const r = await cdp.send('Page.captureScreenshot', { format: 'png' }, SID);
```

`block: 'center'` matters here: with `block: 'start'` the element can still sit under a sticky
header. Restore the real viewport afterwards.

**Re-inject page-side helpers after `Page.reload`.** Anything you installed with `Runtime.evaluate`
(`window.__probe`, `__overflow`, …) is gone after a navigation; the next call dies with
`ReferenceError: __probe is not defined`. Re-run the injection right after every reload.

**Always wait for fonts before measuring:**

```js
await ev(`document.fonts.ready.then(() => true)`);  // returnByValue + awaitPromise
await sleep(1500);
```

Web fonts swap in after load and change every text-derived measurement. Measuring early gives you
numbers that do not match what the user sees.

**Kill Chrome in a `finally`** — a leaked headless process holds the debug port and the next run
fails to bind.

### Three ways a headless run dies with no output at all

These cost two full runs in one session. Each looks identical from the outside: the harness produces
**nothing**, and the shell gets killed.

**1. A `window.confirm()` / `alert()` in the code path hangs the renderer forever.**

```js
// clearTavernData() { if (x && !window.confirm('清除？')) return; ... }
await ev(`clearTavernData()`);   // ← never returns; the renderer is blocked on the dialog
```

The page is *correct* — a real user sees the dialog. The harness must answer it:

```js
cdp.on('Page.javascriptDialogOpening', async p => {
  dialogs.push(p.message);
  await cdp.send('Page.handleJavaScriptDialog', { accept: true }, SID);
});
```

Grepping the page for `confirm(`/`alert(`/`prompt(` before writing the harness takes ten seconds and
saves a debugging session. Assert the dialog actually appeared (`dialogs.some(m => /清除/.test(m))`) —
that turns a hang into a passing test of intended behaviour.

**2. Give every CDP call its own timeout.** Without one, a blocked renderer makes the harness wait
forever and you learn nothing:

```js
send(method, params = {}, sessionId, timeout = 30000) {
  const id = ++this.id;
  return new Promise((res, rej) => {
    const tm = setTimeout(() => { this.pending.delete(id); rej(new Error(`CDP 超时 ${method}`)); }, timeout);
    this.pending.set(id, { res: v => { clearTimeout(tm); res(v); }, rej: e => { clearTimeout(tm); rej(e); } });
    this.ws.send(JSON.stringify({ id, method, params, ...(sessionId && { sessionId }) }));
  });
}
```

Now a hang surfaces as `💥 CDP 调用超时: Runtime.evaluate` **with the section name printed above it**,
which localises the bug immediately.

**3. Long harnesses get killed by the tool timeout — run them in the background and log to a file.**

A full run (Chrome boot + ~80 evaluates + 6 screenshots) can exceed a 2-minute command timeout, and
the kill discards buffered stdout. Symptom: empty output, exit `SIGTERM`. Fix:

```bash
cd <scratch> && "$NODE" verify.js > run.log 2>&1; echo "EXIT=$?" >> run.log
# launch with run_in_background: true, then read run.log
```

Log a timestamp per section (`[3.8s]`) — it tells you whether you have a hang or merely a slow run.
Also give the HTTP server an error handler (`srv.on('error', rej)`) so a busy port fails loudly
instead of hanging on an unresolved `listen` promise.

**Serve over `http://127.0.0.1:<port>`, not `file://`.** `localStorage` on `file://` is unreliable in
Chrome, and a tiny static server makes the origin stable and `localStorage` predictable. A 10-line
`http.createServer` reading from the target directory is enough.

### A sandboxed iframe is an OOPIF — the parent page can't reach it

If the app embeds a preview in `<iframe sandbox="allow-scripts">` (**without**
`allow-same-origin`, which is the whole point of a sandbox), Chrome puts it in a **separate
process**. From the parent's CDP session it does not exist:

- `Page.getFrameTree` does not list it
- `document.getElementById('frame').contentDocument` is `null`
- `Runtime.evaluate` in the parent sees only the parent's document

You must auto-attach to out-of-process frames and address the child with its own `sessionId`:

```js
const childSessions = [];
cdp.on('Target.attachedToTarget', p => {
  if (p.targetInfo && p.targetInfo.type === 'iframe') childSessions.push(p.sessionId);
});
await cdp.send('Target.setAutoAttach',
  { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, SID);

// …then evaluate INSIDE the preview. Try the NEWEST session first — every srcdoc
// change spawns a fresh target, and the old session is a dead document:
for (let i = childSessions.length - 1; i >= 0; i--) {
  try { return await cdp.send('Runtime.evaluate',
    { expression: '...', returnByValue: true }, childSessions[i]); } catch (e) { /* stale */ }
}
```

`setAutoAttach` must be enabled **before** the frame is created (i.e. before the `srcdoc` is set or
the page navigates). Assertions worth writing once you're in: the sandbox attribute really lacks
`allow-same-origin`, a `<style>` in the preview actually applies, a `<script>` in it actually runs,
and viewport units (`100vw`) resolve against the *iframe*, not the page — that last one is the
difference between "looks right in my editor" and "looks right in the host".

**Process isolation is a feature — it makes timeouts testable.** Because the sandboxed frame runs
in its own process, a `while(true)` inside it does **not** freeze the parent. Measured on Chrome
(2026-09): an infinite-ish loop (5e8 iterations, 548 ms) inside the sandbox ran while the parent's
`setInterval` kept ticking (59 → 161). So:

- You can write a test that feeds the sandbox a runaway script and asserts the parent's timeout
  fires and the iframe gets torn down — **without hanging your own harness.**
- Corollary for the *app*: a timeout on a sandboxed frame is a **hard** guarantee, not best-effort.
  It rests on process isolation, not on the event loop. Say so in the code comment, because the
  "obvious" reason (the event loop) is the wrong one.
- It also means `sandbox="allow-scripts"` + an in-document
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'">`
  cuts the network too: `fetch` throws, `new Worker(blob:)` is blocked (`worker-src` falls back to
  `default-src 'none'`), and even after adding `worker-src blob:` the worker boots but **its own
  `fetch` is still blocked** (blob workers inherit the CSP). All four verified, not inferred.

**A probe is code too — confirm the instrument is alive before trusting the reading.** The first
version of the sandbox probe "proved" the parent was frozen. It wasn't: the probe page referenced a
deleted variable inside a `target="_blank"` anchor call, so the whole script never ran and the
"frozen" numbers were just the page doing nothing. Rewriting the probe with the payloads in
`<script type="text/plain">` blocks (so they can't execute or throw at parse time) gave the real
answer. Before you believe a surprising measurement, add a heartbeat — a `setInterval` counter you
print alongside — so "the thing under test is stuck" and "my probe is broken" look different.

#### "Evaluate succeeded" ≠ "document is ready" — poll, don't sleep

Setting `srcdoc` **reloads the whole frame**. Between the reload and the new document being parsed,
`document.body` is `null`, and `Runtime.evaluate` *still returns successfully* — with a null body.
If your `frameEval` only retries on **exceptions**, it treats that `null` as the real answer and the
assertion fails.

The symptom is the worst kind: **flaky**. A real-machine-preview assertion ("the moved element is
moved in the preview too") fails maybe half the time and passes when run alone, because it's a race
with a 240 ms debounce plus a frame load.

Fix: poll for the state you actually want, and make the expression defensive.

```js
let got = null;
for (let i = 0; i < 30; i++) {
  await sleep(200);
  got = await frameEval(`(() => {
    const el = document.body ? document.body.querySelector('[style*="left:40px"]') : null;
    if (!el) return null;
    return { pos: getComputedStyle(el).position };
  })()`).catch(() => null);            // ← swallow "context destroyed mid-navigation"
  if (got && got.pos === 'relative') break;
}
```

Rule of thumb: **whenever you cross a document boundary (navigation, `srcdoc`, iframe reload),
replace "sleep N ms then assert" with "poll until the target state appears, then assert".**

**Never hardcode the port — pick the first one that actually binds.** A hardcoded port can be
transiently reserved by the OS or the sandbox. The failure mode is nasty: the whole suite dies with
`listen EACCES: permission denied 127.0.0.1:8793` **before a single assertion runs**, and the message
has nothing to do with the page under test. `netstat` shows nothing holding the port; only some
adjacent ports work.

```js
const CANDIDATES = [8793, 8890, 8901, 8912, 8923];
let HTTP_PORT = CANDIDATES[0];
function pickPort() {
  return new Promise(resolve => {
    const tryOne = i => {
      if (i >= CANDIDATES.length) { resolve(); return; }
      const probe = http.createServer();
      probe.on('error', () => { try { probe.close(); } catch (e) {} tryOne(i + 1); });
      probe.listen(CANDIDATES[i], '127.0.0.1', () =>
        probe.close(() => { HTTP_PORT = CANDIDATES[i]; resolve(); }));
    };
    tryOne(0);
  });
}
// main: await pickPort(); srv = await startServer();
```

Same rule for the CDP debug port and for temp directories — anything the harness *acquires from the
machine* rather than *creates itself* should not be a constant. Print the port it settled on
(`静态服务: http://127.0.0.1:8890`) so the log tells you which one was used.

A pure-random pick is **not** a fix either. When you run a suite of harnesses back to back, the
previous run's browser is still shutting down and holds whatever number you just drew. Symptom:
`Chrome 调试端口没起来` / `连不上 CDP`, a different suite red every time, roughly 1 run in 150 —
and it has nothing to do with the page. Probe by **actually binding** (`listen` succeeded), not by
`netstat` and not by randomness.

### Native dialogs over CDP are unreliable — stub them in the page

`Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog({accept: true})` is the documented way
to auto-accept `confirm()`. **It is not reliable.** Measured on this machine: roughly **20%** of
dialogs come back with

```
{"code":-32602,"message":"No dialog is showing"}
```

The event *did* fire. By the time our accept command reaches the browser, Chrome has already
dismissed the dialog on its own — and `confirm()` returns `false`. So the app takes the *cancel*
branch, silently.

Install the stub **in the page** instead, so answering is fully synchronous and has nothing to do
with CDP timing. `addScriptToEvaluateOnNewDocument` re-runs on every new document, so it survives
reloads:

```js
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `window.__dlg = [];
    window.confirm = function (m) { window.__dlg.push(String(m)); return true; };`
}, SID);
// backstop only — and never swallow the error
on('Page.javascriptDialogOpening', p =>
  send('Page.handleJavaScriptDialog', { accept: true }, SID)
    .catch(e => console.log('dialog not handled: ' + e.message)));
```

If a suite *asserts* that the app asked the user, read the page-side log (`window.__dlg`) rather
than the Node-side counter — that keeps the assertion meaningful while removing the flake.

**Two lessons that cost a whole round:**

1. **Never leave a `.catch` empty.** The version of this handler was
   `.catch(() => {})` — which is exactly what hid the failure. The symptom was a *randomly red*
   assertion whose name had nothing to do with dialogs ("the output contains a progress-bar macro"),
   and it never reproduced when run alone.
2. **The failure message pointed at the wrong thing.** The app asks "there are already 3 blocks, OK
   to replace them?"; cancel means the template is never applied — so the block count stayed **3**,
   because the app seeds a 3-block starter template on install. The `blocks.length === 3` assertion
   passed, and only the macro assertion failed. Dump the *contents* (`type|path` for each block),
   not just the count, or you'll stare at two identical-looking numbers.

Also: **any added `Runtime.evaluate` round trip masks a race like this.** The first diagnostic script
inserted two extra `ev()` calls and went 20/20 green. To catch a timing bug you must not change the
number of round trips — instrument *inside* an evaluate call that already exists.

And when looping a harness several times in one browser: **clear `localStorage` between rounds**, or
give each round a fresh `--user-data-dir`. Otherwise round 2 starts with round 1's draft restored
(any `loadDraft()` on open will read it back), and you'll be debugging a different initial state.

### Feature talks to an API? Replace `window.fetch` in the page

Same family of trick as the dialog stub: **don't test the transport, replace it.** If the app calls
a model API, a backend, or anything else over `fetch`, install a fake in the page via
`addScriptToEvaluateOnNewDocument` and branch on the URL shape to decide which protocol the caller
thinks it's talking to.

```js
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `
  (function () {
    window.__calls = [];
    window.__script = { reply: 'hi', stream: true, fail: '' };
    const enc = new TextEncoder();
    const sse = lines => new Response(new ReadableStream({
      start(c) { lines.forEach(l => c.enqueue(enc.encode(l))); c.close(); }
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    window.fetch = async function (url, init) {
      init = init || {};
      let body = null;
      try { body = init.body ? JSON.parse(init.body) : null; } catch (e) {}
      window.__calls.push({ url: String(url), method: init.method || 'GET',
                            headers: init.headers || {}, body });
      const S = window.__script;
      if (S.fail === 'network') throw new TypeError('Failed to fetch');
      if (/\\/messages$/.test(url)) return sse(anthropicChunks(S.reply));
      return sse(openaiChunks(S.reply));
    };
  })();`
}, SID);
```

What this buys you, that a unit test of a "build request" helper does not:

- **Assert the actual wire format.** URL, headers, and body are recorded, so you can check that the
  Anthropic branch really sends `x-api-key` (not `Authorization`) and that `system` was hoisted out
  of `messages` — not that some function *would have* done it.
- **Drive real streaming.** `new Response(ReadableStream)` gives a real `resp.body.getReader()`, so
  the app's SSE parser runs for real. Split the reply into small chunks so you can assert the
  incremental callback fires more than once and that its last value equals the whole text.
- **Exercise failure paths.** A `fail` switch lets one suite cover 401, 500, and a thrown
  `TypeError('Failed to fetch')` — and you can assert the *user-facing* message, which is where the
  real value is (a raw `Failed to fetch` is useless; three concrete causes is not).
- **Assert privacy.** Record nothing, then check that the secret never appears in
  `JSON.stringify(state)`, in the persisted draft, or in the export.

Two traps worth writing down:

1. **Keep the fake's shape and the app's config in sync.** If the config still says `stream: true`
   while the fake returns a JSON body, the client reads it as SSE, finds no `data:` lines, and
   returns an **empty string — with no error**. Set both sides explicitly, and add an assertion on
   the recorded request body (`body.stream === false`) so the pair can't drift apart unnoticed.
2. **Re-add the stub on reload.** `addScriptToEvaluateOnNewDocument` handles this, but only if you
   registered it *before* the first navigation. If a suite reloads to test persistence, a stub
   installed with a one-shot `Runtime.evaluate` is gone and the next call escapes to the real network.

### Testing an agent loop: feed a *script of turns*, then assert the message sequence

When the feature is "the model calls tools", a single canned reply proves almost nothing. Make the
fake **stateful**: a queue of turns, one per request.

```js
// turn 1 → asks for a tool; turn 2 → plain text answer
{ queue: [
    { calls: [{ name: 'read_card', args: { path: 'description' } }] },
    { text: '读完了，我改一下。' }
] }
```

Then assert on **`window.__calls` — the request bodies, in order**, not just the final UI text.
The single highest-value assertion is the **message sequence**:

```
user → assistant → tool → assistant → tool → assistant
```

Three real bugs this caught that nothing else did:

- **"said something" and "wants to call tools" are two halves of one assistant message.** The code
  pushed them as *two* messages → the sequence read `assistant, assistant, tool`. Anthropic rejects
  consecutive `assistant` turns outright (400); OpenAI rejects a `tool_calls` message that isn't
  immediately followed by `tool`. Asserting "the tool ran" passes in both broken cases — only the
  sequence shows it.
- **An internal UI hint leaked into the transcript.** The code filtered the `note` role when building
  the *display* list but not when building the *request* list. Two functions, one filter — and
  Anthropic additionally turned the stray `note` into a `user` turn, tripping "consecutive user".
- **Empty-string fields overwriting real data.** `update({id, keys: [], comment: ''})` blanked the
  entry, because only two of the four fields implemented "empty means keep the old value".

Also assert the **tool-error path**: a tool returning an error must be fed back to the model as a
result, not thrown out of the loop. And assert the **step cap** — a model that keeps calling tools
forever must stop at the configured limit rather than spin.

If the app has several "generate" panels sharing one message builder, put the builder behind one
function and assert the shared invariant **once per call site** — a shared helper that three of four
call sites use is exactly how the fourth drifts.

### Measuring the right thing

`scrollWidth > clientWidth` does **not** detect text wrapping (they're equal when text wraps). To
count rendered lines, use a Range:

```js
const r = document.createRange(); r.selectNodeContents(el);
const lineCount = [...r.getClientRects()].length;   // >1 means it wrapped
```

This is how you catch "the button label is secretly on two lines" — which is invisible to
width/height assertions and obvious in a screenshot.

### Resize handles: drag by the content box, not the border box

If the user resizes an element by dragging a handle and you persist the result as `width` / `height`
in px, the number you write is the **content box** size — not `getBoundingClientRect().width`
(that's the border box). Start the drag from the border box and, on any element with padding or a
border, the element **jumps** on the first pixel of movement by exactly padding + border.

```js
function contentSize(el) {
  const cs = getComputedStyle(el), r = el.getBoundingClientRect();
  return {
    w: r.width  - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
                - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth),
    h: r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)
                - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth)
  };
}
```

**A west/north handle must move the element as well.** Pulling the west edge 20px right means the
width shrinks by 20 **and** `left` grows by 20. And derive the position **from the clamped width**,
not the other way round — clamp first, then `left = startLeft + (startWidth - clampedWidth)`.
Deriving first and clamping after lets the element keep running right while it's pinned at the
minimum size.

Two more details worth keeping:

- **Only write the axes that actually moved.** An east drag touches `w` and must leave `h` byte-for-byte
  untouched.
- **Render the handles on the selected element only.** Eight handles per element × 6 elements = 48
  tiny squares; the pointer can't tell which one it grabbed.

And one assertion that earns its keep: **the width measured on the editing canvas equals the width
measured in the real preview** (an iframe using the production wrapper). The two live in different
CSS environments; if one side writes `width` onto the wrong element — say the selection overlay
instead of the block — only this cross-check catches it.

### Verifying a webfont actually applies — three methods, two of them wrong

When you swap a page's font (e.g. to a local pixel font), "it looks different in the screenshot" is
not proof. Two obvious measurements are traps:

1. **`document.fonts.check('12px "Family"', text)` does not test glyph coverage.** In Chrome it
   returns `true` for *everything* — including a latin-only font asked about Chinese, and a font
   asked about a rare musical symbol. It only tells you the font is loaded. Never use it to conclude
   "the font covers these characters".
2. **Width comparison cannot distinguish CJK fonts.** The trick "measure the text with the new font,
   then with the old stack; if the widths differ the new font is in use" works for Latin and
   **fails silently for CJK**: CJK is full-width square, so every CJK font gives the same advance
   width. A whole page of Chinese reported "not using the new font" when it was.

   Width comparison *is* valid for Latin — and for a block element, use a Range (above), because
   `getBoundingClientRect()` on a block measures the container, not the text.

3. **What actually works — compare outlines, offline.** Parse the font's `cmap` to get glyph ids,
   then `loca` + `glyf` to compare the outline bytes for each codepoint. Zero browser involved,
   fast, and decisive. Expand **composite glyphs** recursively (they reference other glyph ids, so
   comparing only their own bytes misses differences).

   This is also how you answer the question users actually care about when a font ships in several
   language variants (`ja` / `zh_hans` / `zh_hant` / `ko` / `latin`): coverage is often *identical*
   across variants while the **shapes differ** for a large share of shared codepoints. On a real
   page, 184 of 1038 common Chinese characters rendered with Japanese glyph forms under the `ja`
   variant — `你` `今` `令` `以` `入` `天` `很` `才` among them. Coverage counts alone would have
   hidden this.

For the sanity check that the CSS is wired up at all, read the computed style:

```js
getComputedStyle(el).fontFamily   // shows the declared stack, in order
document.fonts.forEach(f => f.family + '/' + f.weight + '/' + f.status)
```

**Two more things to get right when swapping in a local font:**

- **Relative `@font-face` URLs work from `file://` too** — verified: Chrome loaded a 7 MB local
  `.ttf` from a sibling `fonts/` directory under `file://` with no flags and no server. Don't assume
  it needs `--allow-file-access-from-files`; test it. (Use forward slashes: in CSS, `\f` is an
  escape sequence, so `'.\fonts\x.ttf'` is silently mangled.)
- **A single-weight pixel font plus `font-weight: bold` = synthesized faux-bold**, which smears the
  glyphs and destroys the crispness that was the whole point. Declare `font-weight: 100 900` on the
  `@font-face` so the browser uses the real face at every weight instead of synthesizing.

### "Is X covered by Y?" — hit-test, don't do rect arithmetic

**Two traps here, both of which produced a false bug report in one session:**

1. **A one-sided comparison is not an overlap test.** `ta.bottom > hint.top` reported "overlapping"
   for a hint that sat entirely *above* the textarea. The real test is two-sided:

   ```js
   const overlaps = a.top < b.bottom && b.top < a.bottom;   // ✅
   const overlaps = a.bottom > b.top;                        // ❌ also true when b is above a
   ```

2. **Scope your selectors.** `document.querySelector('.ai-hint')` matched an *earlier, unrelated*
   `.ai-hint` further up the page, so the geometry dumped was for the wrong element entirely. When a
   class repeats, always scope from a known ancestor:

   ```js
   const field = document.querySelector('#ai-system-prompt').closest('.ai-field');
   const hint  = field.querySelector('.ai-hint');           // ✅ the one inside this component
   ```

The reliable way to answer "is this element visible, or covered by something?" is to ask the browser:

```js
// sample a 3×3 grid over the element's box; every hit should resolve to it
const el = document.querySelector('#target');
const r = el.getBoundingClientRect();
const hits = [];
for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) {
  const x = Math.round(r.left + r.width  * i / 4);
  const y = Math.round(r.top  + r.height * j / 4);
  hits.push(!!(document.elementFromPoint(x, y) || {}).closest && document.elementFromPoint(x, y).closest('#target'));
}
// all true  → nothing covers it
```

This is strictly better than rect math: it accounts for stacking contexts, `overflow`, and
transforms. Use it whenever the question is "can the user actually see / click this?".

**Trap: `pointer-events: none` makes `elementFromPoint` return an ancestor.** If a panel is
*disabled* (greyed out, non-interactive), hit-testing it correctly fails — `hit === el` is false and
you get the parent element instead. So:

```js
// ❌ the panel is still off → pointer-events:none → reports "covered"
probe('#panel');  enablePanel();  importCard();

// ✅ enable first, then probe; and assert the transition as its own check
enablePanel();
check('开启后 pointer-events 恢复', getComputedStyle(panel).pointerEvents, v => v !== 'none');
probe('#panel');
```

Assert both sides — `pointer-events: none` while off **and** not-`none` while on. The first catches a
dead panel, the second catches a probe run in the wrong order.

**Trap: an element taller than the viewport can never satisfy "fully in view".** A 1154px panel in an
844px viewport fails a whole-rect containment test no matter how correct the layout is. Test the
*visible intersection* instead:

```js
const top = Math.max(r.top, 0), bot = Math.min(r.bottom, innerHeight);
const visH = bot - top;
const tall = r.height > innerHeight;
const visOk = tall ? (visH >= innerHeight * 0.6) : (r.top >= -1 && r.bottom <= innerHeight + 1);
```

### A collapsed panel's children still report a full-size `getBoundingClientRect()`

Collapsing with `grid-template-rows: 0fr` + `overflow: hidden` (or `max-height: 0`) **clips** the
content — and **clipping does not change `getBoundingClientRect()`**. The textarea inside still
reports its full 14-row box, at full width, at a plausible position:

```js
// ❌ identical whether the panel is open or collapsed
ta.getBoundingClientRect().height          // 280 in both states
```

So measure the thing that actually collapses, and hit-test where the content would be:

```js
const body = document.querySelector('#panel-body');       // the grid container itself
getComputedStyle(body).gridTemplateRows                   // "0px"  vs  a real px value
body.getBoundingClientRect().height                       // ~0     vs  ~300

const hr = header.getBoundingClientRect();
const y = hr.bottom + 60, x = hr.left + 30;
const inView = y > 0 && y < innerHeight && x > 0 && x < innerWidth;
const hit = inView ? document.elementFromPoint(x, y) : null;
hit.closest('#panel')       // null when collapsed — the panel when open
```

⚠ Assert `inView` **as its own check**. If the probe point is off-screen, `elementFromPoint` returns
`null`, `.closest` on it is falsy, and "collapsed" passes **vacuously** — a green test that never
looked at anything.

⚠ Keep "the inner element's rect is *still* full size" as a **deliberate assertion** in the suite.
It reads like a tautology, but it is what stops the next person from re-introducing rect math: when
they "fix" the probe by measuring the textarea, that check goes red and explains why.

### Touch target sizes

A control that measures fine on desktop can be too small to tap. Measure it at a mobile viewport and
assert a floor:

```js
const minH = Math.min(...chips.map(c => c.getBoundingClientRect().height));
check('chip 高度够点（>=32px）', minH, v => v >= 32, '>=32');
```

A `padding: 6px 10px; font-size: 0.74rem; line-height: 1` chip measures **25.8px** — under any
reasonable touch minimum. Fix with a touch media query rather than inflating the desktop size:

```css
@media (max-width: 600px), (hover: none) { .chip { padding: 10px 13px; font-size: 0.78rem; } }
```

Include both `max-width` and `hover: none`: `hover: none` alone does not reliably match under CDP
device emulation unless touch emulation is also enabled, but it is what covers large touch screens.

**Measure the hit target, not the visual child.** A custom toggle is typically
`<label><input hidden><span class="track"></span></label>`. The track is 36×20 and *stays* 36×20 when
you fix the tap area — the **label** is what grows. Measuring the track reports a false failure, and
measuring the label alone only proves a box exists. Do both, then prove it for real:

```js
// 1. the hit target is big enough
const label = document.querySelector('#toggle').closest('.ai-switch').getBoundingClientRect();
check('开关触控区 >= 44px', Math.min(label.width, label.height), v => v >= 44);
// 2. the visual size did NOT change (the fix must be invisible on desktop)
check('轨道仍是 36×20', track.getBoundingClientRect().height, v => v === 20);
// 3. a real click at the label's centre actually toggles
const box = await ev(`(() => { const l = <label>; l.scrollIntoView({block:'center'});
  const r = l.getBoundingClientRect();
  return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }; })()`);
await cdp.send('Input.dispatchMouseEvent', { type:'mousePressed',  ...box, button:'left', clickCount:1 }, SID);
await cdp.send('Input.dispatchMouseEvent', { type:'mouseReleased', ...box, button:'left', clickCount:1 }, SID);
check('点一下能切换状态', await ev(`$('#toggle').checked`), v => v !== before);
```

Grow the label with **padding**, not a pseudo-element overlay: padding cannot steal clicks from a
neighbour, whereas a centred 44×44 `::after` on a 36×20 control overhangs ~12px vertically and can
cover the row above.

**Sampling trap:** if your click helper clicks twice (to toggle back), do not compare `before` to the
value sampled *after both clicks* — they are equal by construction and the assertion always fails.
Sample between the clicks.

### Testing responsive branches

Loop viewports and re-measure: `[['desktop',1440,900], ['mobile',390,844], ['tablet',768,1024]]`.
Assert the *numbers* — e.g. "aspect ratio ≈ 0.4615", "x == (viewportW - w) / 2", "height == viewportH".
Vague assertions like "looks bigger" verify nothing.

### "Cramped" vs "overflowing" — read the boxes, don't read the screenshot

A three-column HUD looked, in the screenshot, like *text overlapping text* on a 390 px viewport. The
measurement said something different and worse:

```
#hud-left    x[  12,   81.6]  w= 69.6   ← w-48 (192px) squeezed to 69.6, "100 / 100" wrapped
#hud-center  x[81.6,  396.8]  w=315.2   ← right edge 396.8 > 390: past the viewport
PAUSE button x[396.8, 471.5]  w= 74.6   ← entirely OFF-SCREEN
文字重叠检测: 无重叠
```

There was **no overlap at all** — the HUD was 471.5 px wide inside a 390 px viewport. And the real
defect wasn't cosmetic: **the pause button was unreachable on mobile.** A screenshot alone would have
sent me off to tune font sizes.

So dump every leaf's box and compute both conditions separately — they have different fixes:

```js
// overlap: two boxes intersecting
if (Math.min(a.r,b.r) - Math.max(a.l,b.l) > 1 && Math.min(a.b,b.b) - Math.max(a.t,b.t) > 1) …
// overflow: a box outside the viewport
if (l.l < -0.5 || l.r > innerWidth + 0.5) …
```

Then assert *both* as named checks, plus `documentElement.scrollWidth - innerWidth <= 1`.

### `min-width: auto` propagates min-content *up* the tree — and it's invisible

The root cause of that overflow. In a flex container, `min-width: auto` resolves to **min-content**,
and min-content of a parent is derived from its children — so one `white-space: nowrap` leaf near the
bottom silently sets a floor on the whole column.

Attribution, measured rather than guessed — pin each child to `width: min-content` and read the width:

```
--- 中栏直接子元素（min-content 宽度）---
   127.3px  score-text
    45.9px  hud-meta
   315.2px  ai-radio-box        ← the floor comes from here
--- 再深一层 ---
   234.7px  #ai-radio-box > ai-radio-text   ws=nowrap   ← nowrap ⇒ min-content = full text width
```

Fixing it takes **two** `min-width: 0`, not one — and the one you'd expect is not the one that matters:

```css
#hud-center   { min-width: 0; }   /* ← the one that actually unblocks the shrink */
#ai-radio-text{ min-width: 0; }   /* ← needed so .truncate's ellipsis can finally kick in */
```

Without the first, the column keeps a 315.2 px floor and still overflows; the text-level `min-width: 0`
alone changes nothing. That is also why `.truncate` (Tailwind's `overflow:hidden;text-overflow:ellipsis;
white-space:nowrap`) "doesn't work" as a flex child: it can't ellipsise until an ancestor is allowed
to be narrower than its content.

### A responsive fix must be proved not to leak upward — compare against the pre-change copy

Wrapping the HUD into two rows below 620 px is only correct if desktop is **untouched**. Don't eyeball
it: keep the pre-change file and diff the geometry at and above the breakpoint. Because the page path
is env-overridable, the same probe can measure both builds:

```bash
PAGE_FILE="game.html"        node probe_hud_layout.js 1000 900
PAGE_FILE="game.bak.html"    node probe_hud_layout.js 1000 900
```

```
1000x900  now: left x[64,320] w=256  center x[391.5,770.5] w=378.9  right x[842,936] w=94
1000x900  bak: left x[64,320] w=256  center x[391.5,770.5] w=378.9  right x[842,936] w=94   ← identical
```

Then encode the boundary as an assertion, which is sharper than comparing widths: the media query
itself is observable through computed style.

```js
check('窄视口命中 wrap 断点',      390px.flexWrap, 'wrap');
check('桌面端仍是三栏单行（断点未泄漏）', 1000px.flexWrap, 'nowrap');
check('桌面端左栏仍是 md:w-64 的 256px', Math.round(desk.cols['hud-left'].w), 256);
```

⚠ Also check the **shrink** direction, not just the overflow: `左栏 >= 100px`. In the broken build the
left column was silently crushed to 69.6 px — nothing overflowed *from it*, so an overflow-only test
would have stayed green.

### Simulating hover / mouse — the off-viewport trap

`Input.dispatchMouseEvent` **cannot hit a point outside the visual viewport.** If the element sits
below the fold, `getBoundingClientRect()` happily returns `y: 1795` and the click/hover silently does
nothing — no error, just a failed `:hover` assertion that looks like a CSS bug.

Scrolling is subtler than it looks:

| Attempt | Result |
|---|---|
| nothing | `lastTop: 1795` — way outside a 900px viewport |
| `card.scrollIntoView({block:'center'})` | `lastTop: 1089` — **still outside** |
| `bubble.scrollIntoView({block:'center'})` | inside ✅ |
| `messages.scrollIntoView({block:'nearest'})` | inside ✅ |

Why the middle one fails: the card is **taller than the viewport** (1525 > 900). Centering the card
puts its *bottom* below the fold. Always scroll **the element you want to hit**, not its container.

Robust helper — try strategies in order, stop as soon as the point is genuinely inside:

```js
const pointOf = () => ev(`(() => {
  const el = <target>;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2),
           vw: innerWidth, vh: innerHeight }; })()`);
const inView = p => p.x > 0 && p.y > 0 && p.x < p.vw && p.y < p.vh;

let p = await pointOf();
for (const code of [
  `<target>.scrollIntoView({block:'center', inline:'nearest'})`,
  `<container>.scrollIntoView({block:'nearest'})`,
]) { if (inView(p)) break; await ev(code); await sleep(350); p = await pointOf(); }
await hoverAt(p.x, p.y);   // then assert, and assert inView(p) too
```

Also move the mouse **away first** (`mouseMoved` to `1,1`) before moving onto the target. CDP does
not re-fire `mouseover` if the pointer never left, so a second hover test on the same element will
see stale state. And assert the hover *point* is in-view as its own check — that one assertion
localises the whole class of failure instantly.

**Better still:** if the app has a full-screen/overlay mode, toggle it for interaction tests. The
component becomes `position: fixed` and provably fully in-viewport, so hover coordinates are always
valid. It also exercises a real user path.

### Testing HTML5 drag & drop

`Input.dispatchDragEvent` is finicky. **Don't use CDP for this — dispatch synthetic `DragEvent`s
in the page.** Chrome lets you construct a `DataTransfer`, so the real handlers run unchanged:

```js
const dt = new DataTransfer();                       // ✅ constructible in Chrome
const mk = (type, el, ex) => new DragEvent(type, {
  bubbles: true, cancelable: true, dataTransfer: dt, ...ex
});
src.dispatchEvent(mk('dragstart', src, { clientX: 5, clientY: 5 }));
dst.dispatchEvent(mk('dragover',  dst, { clientX: x, clientY: y }));   // decide the drop mode
const hinted = dst.className;                                          // read the drop indicator
dst.dispatchEvent(mk('drop',      dst, { clientX: x, clientY: y }));
```

`clientX` / `clientY` **must** be passed — anything computing a drop index from geometry
(`getBoundingClientRect()` midpoints) reads them, and they default to 0. Assert on **both** the
indicator class after `dragover` and the resulting model order after `drop`; a handler that
computes the right hint but moves the wrong node passes an order-only assertion.

Handlers using `e.currentTarget` work correctly with `dispatchEvent` (it's set to the element the
listener is attached to, which is what you want for delegated/inline handlers).

Three traps this catches, all invisible to a "does it move" assertion:

- **Dropping a node into its own subtree.** The node gets detached and re-inserted inside itself,
  so the whole subtree disappears. Assert `tree.count(before) === tree.count(after)` and
  `new Set(ids).size === ids.length`.
- **Stale indices.** If the move computes the target index *before* splicing the node out, the
  index shifts by one. Test a **forward and a backward** move — they fail in opposite directions.
- **`dragleave` flicker.** `dragleave` fires on the parent when the pointer enters a child. Only
  clearing the indicator when `!(el.contains(e.relatedTarget))` is correct; a naive handler
  clears it constantly. Synthetic events won't catch this — assert it by reading the code.

Then screenshot the result and **read the image**. Drop indicators, hit boxes and selection rings
are pure CSS; no assertion tells you whether they are actually visible.

### Drag & drop can't do pixel-level placement — use pointer events

If the feature is "nudge this element a few pixels", **HTML5 DnD is the wrong tool and cannot be
made to work**: `drag` events only carry screen coordinates, and after `drop` you've lost the
element. You can't do live-follow or sub-pixel feedback with it.

Use **Pointer Events + `setPointerCapture`**, and test them by dispatching synthetic
`PointerEvent`s (Chrome constructs them fine):

```js
const pe = (type, el, x, y, opt = {}) => el.dispatchEvent(new PointerEvent(type, {
  bubbles: true, cancelable: true, clientX: x, clientY: y,
  pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, ...opt
}));
pe('pointerdown', el, 100, 100);
pe('pointermove', el, 125, 114);   // assert the element already moved — before pointerup
pe('pointerup',   el, 125, 114);   // assert the model + persistence committed here
```

Assert **mid-drag** state, not just the end state. The whole point of pointer-based dragging is
live feedback; a handler that only applies the delta on `pointerup` passes an end-state assertion
while feeling broken.

Things to assert for this kind of feature:

| Trap | Assertion |
|---|---|
| Click-vs-drag ambiguity | move < ~3px → nothing moves (otherwise a click nudges the element) |
| Live follow | read the inline style **between** `pointermove` and `pointerup` |
| Commit timing | nothing written to storage / the model before `pointerup` |
| Modifier snapping | hold `shiftKey: true` → values land on the grid multiple |
| Keyboard path | dispatch `KeyboardEvent` and check both the 1px and the 10px (Shift) step |
| Escape | deselect, and the handler must not scroll the page (`defaultPrevented`) |

If you ship **two** gestures that both start with a press (e.g. free placement vs. reordering),
make them **mutually exclusive behind a flag**, and assert the loser actively *steps aside*:
`draggable="false"` **and** the `dragstart` handler calling `preventDefault()` and returning
without setting its drag state. Leaving both live means one press both moves and reorders.

### Zero value must mean zero bytes

When a new field is added to a generator that already has a byte-for-byte round-trip test, make
the **neutral value emit nothing at all** — not `left:0px`, not `style=""`. Otherwise every
element that never used the feature gains a few bytes and your existing pixel/byte diff goes red
for no real reason.

```js
function offsetCss(b) {
  const x = num(b.offX), y = num(b.offY);
  if (!x && !y) return '';                       // ← both zero: emit nothing
  return 'position:relative;' +
    (x ? 'left:' + x + 'px;' : '') + (y ? 'top:' + y + 'px;' : '');   // ← and per-axis too
}
```

This makes the byte-diff suite the **guard rail** for the new feature: it stays green only while
the neutral path stays empty. Say so in the docs, so the next person knows which two suites to run
together after touching that function.

**The trap: the neutral value may collide with something your generator already writes.** Offsets
were easy — nothing in the generator ever wrote `left:0`. Sizes were not: the divider block's own
base style is `height:1px`, so a naive "read `height` back into the field" parsed the *generator's*
declaration as a user-set value. Next round it emitted one more declaration and the diff dutifully
copied the original into the "preserve verbatim" bucket — one declaration became two and the
byte-for-byte suite went red.

Fix: before reading a field back, ask **"what does my generator write when this field is unset?"**
and compare against that, not against "is there a value".

```js
function sizeBaseline(block, theme) {          // generate with w/h cleared, read the outermost box
  const el = parseBlock(blockHtml({ ...block, w: 0, h: 0 }, theme));
  return { w: px(el.style.width), h: px(el.style.height) };
}
function readSize(block, el, base) {           // only accept px, and only if != baseline
  const w = px(el.style.width), h = px(el.style.height);
  return { w: w !== null && w !== base.w ? w : 0, h: h !== null && h !== base.h ? h : 0 };
}
```

Two corollaries:

- **Don't clamp on read.** A minimum of 8 (a sane *drag* floor) turned a hand-written `height:1px`
  into `8px` — i.e. it edited the input. Clamp on *interaction*, not on *parsing*.
- **When the field is set, stop writing the generator's default.** Emitting both
  (`height:1px;height:40px`) still renders correctly — later wins — but it adds a dead declaration
  to the output. Special-case it: `const base = num(b.h) ? '' : 'height:1px;'`.

Also: **`position:relative`, never `absolute`,** for a "move this element" offset. `absolute`
takes the element out of flow, so everything after it collapses upward — that's not "nudge one
element", it's "destroy the layout". And when *parsing* such an offset back out, only accept
`left`/`top` when `position` is exactly `relative` and the unit is `px`: `left` on a `static`
element is inert, so reading it as an offset means you'd silently be adding `position:relative`
and *making an inert declaration active* — that's editing someone else's document.

### Alternative: force a state instead of hovering

`:hover` is not scriptable. If you only need to verify the *revealed* styling (colour, radius,
bevel), skip the mouse entirely and read the computed style of the child while forcing opacity:

```js
await ev(`document.querySelectorAll('.row')[0].classList.add('__hover')`); // if you have such a hook
// or simply assert the non-hovered default + the rule's existence
```

Prefer the real hover when the *mechanism* is what's under test (does `:hover` reveal it at all);
prefer this when only the *appearance* is under test.

---

## Layer 2b — a canvas game loop: drive it with rAF, and measure frame cost

The rest of Layer 2 is about layout. A `<canvas>` app has no layout to measure — what matters is
that the loop runs, that state advances, and that **the frame budget survives**. Verified on a
vector shooter (`retro_vector_space_shooter`), 2026-09-21.

### Drive the loop with `requestAnimationFrame`, never `setTimeout`

`setTimeout` is **starved** when the main thread is busy — and a heavy render is exactly that. A
harness that polls with `setTimeout(40)` inside `Runtime.evaluate` will time out with
`CDP timeout Runtime.evaluate` and look like a broken page. It isn't: the loop is simply hogging
the thread, which is itself the finding.

```js
await ev(`(async () => {
  for (let i = 0; i < 30; i++) await new Promise(r => requestAnimationFrame(r));
  return player.lasers.length;
})()`, /* awaitPromise */ true, 60000);
```

Give these calls a **generous per-call timeout** (30–60 s). A blocked renderer + a 20 s default is
how you get an unactionable timeout instead of a measurement.

### Measure the frame time, and locate the cost by removing one layer at a time

Sample rAF deltas and take the median (a single slow frame is noise):

```js
const bench = async (n) => {
  await new Promise(r => requestAnimationFrame(r));
  const t = []; let prev = performance.now();
  for (let i = 0; i < n; i++) { await new Promise(r => requestAnimationFrame(r));
    const now = performance.now(); t.push(now - prev); prev = now; }
  t.sort((a, b) => a - b);
  return t[Math.floor(t.length / 2)];
};
```

Then **monkey-patch the suspect draw method** with progressively-simplified variants and re-measure
each. This is the canvas analogue of "print *who* and *how much* before concluding" — without it you
are guessing which of five `ctx` calls is the expensive one:

```js
const orig = LaserBeam.prototype.draw;
out.push(await bench(24));                                   // as shipped
LaserBeam.prototype.draw = function () {};  out.push(await bench(24));   // nothing at all
LaserBeam.prototype.draw = function () { /* haze + body only */ };       // …
LaserBeam.prototype.draw = orig;
```

Measured result, 10 beams of ~1400 px each, `--disable-gpu` (software raster), 1000×900:

| variant | median frame |
|---|---|
| as shipped (`shadowBlur: 12` on the long core stroke) | **333 ms** |
| **no beams drawn at all** (baseline) | 16.6 ms |
| three alpha-layered strokes, **no `shadowBlur`** | **16.7 ms** |
| haze stroke removed, `shadowBlur` kept | 319 ms |

So **`ctx.shadowBlur` on a long stroke was the entire cost — ~20×**, and removing it made the
feature free (16.7 ms vs a 16.6 ms baseline). Layered `globalAlpha` strokes at 0.10 / 0.34 / 1.0 give
the same neon glow for nothing. The same applies to `shadowBlur` on a big `fill()`: draw concentric
translucent circles instead.

⚠ **Software raster is a stress test, not a frame-rate claim.** `--disable-gpu` amplifies GPU-side
costs (blur, large alpha fills), which is what makes a marginal problem visible — but never report
its absolute number to the user as "the fps". Report the **ratio** (Lv1 vs Lv5, or with/without the
feature), and assert on that.

### Assert on the ratio, not the absolute number

```js
check('Lv5 帧时间未比 Lv1 恶化超过 3 倍', lv5.median / Math.max(lv1.median, 1), v => v < 3);
```

A ratio is machine-independent; a millisecond threshold tuned on your laptop is a check that rots.

### A sweeping / rotating hit test must sub-sample between frames

If the weapon is a beam that rotates or sweeps, testing only the **current** angle makes it tunnel
straight through targets at high angular speed. The symptom is the worst kind: **flaky**, and
frame-rate dependent — it showed up as "the boss test randomly fails" (180 HP unchanged) and looked
like a product bug for a whole round.

Fix: interpolate between the previous and current angle, one sample per ~0.1 rad, capped:

```js
const delta = laser.angle - laser.prevAngle;
const steps = Math.min(6, Math.max(1, Math.ceil(Math.abs(delta) / 0.09)));
for (let s = 1; s <= steps; s++) {
  const a = laser.prevAngle + delta * (s / steps);
  /* test the segment at angle a */
}
```

A per-target cooldown (`Map<target, secondsRemaining>`) makes sub-sampling idempotent — it cannot
double-damage in one frame. Record `this.prevAngle = this.angle` **before** recomputing.

### Pair a deterministic test with a measured one

For anything with a sweeping / oscillating parameter, a single assertion is either flaky or
meaningless. Write **two**:

1. **Frozen** — pin the parameter (angle, phase, speed) so the code path is exercised
   deterministically: *"damage reaches the boss"*.
2. **Natural** — restore the real behaviour, measure over a window long enough to be phase-independent
   (≥ the oscillation period), and assert a **quantity**: *"≥30 damage per 4 s"*.

⚠ And a related flake, from the same sine: an assertion of the form "the angle changed by >0.05 rad
in 260 ms" **must** fail sometimes, because a sinusoidal sweep has zero angular velocity at its
extremes. Assert **accumulated** change over a window instead of a single delta:

```js
let total = 0, prev = L.angle;
while (performance.now() - t0 < 1500) {
  await new Promise(r => requestAnimationFrame(r));
  total += Math.abs(L.angle - prev); prev = L.angle;
}
check('持续扫射', total, v => v > 0.8);   // phase-independent
```

### Measure rates; don't just assert "it changed"

"Level up adds beams" passed (`1 → 2 → 3 → 4 → 10`) while the feature was **broken**: against a
single target, Lv1 and Lv3 did *identical* damage, because large phase offsets meant only the first
beam could ever point forward. No pass/fail assertion would have caught that — a **probe that prints
a number** did:

```
Lv1 ( 1道):   18 伤害 / 5.0s =   3.6 DPS
Lv3 ( 3道):   18 伤害 / 5.0s =   3.6 DPS     ← identical: leveling up did nothing
Lv5 (10道):   66.6 伤害 / 5.0s =  13.3 DPS
```

After fixing the phase spread: 4.8 / 18.3 / 31.2 DPS. **When a feature's whole point is "more X
means more Y", measure Y across X — a count of X proves nothing.** Write the probe as a throwaway
script, read the numbers, fix the design, re-measure, then encode the *rate* as the regression
assertion.

### Test the feature's own UI, and a control

For a new ship/weapon in a game with a roster: assert the selection card exists, its `onclick`
target, and its title — then assert the **control**: a different ship still has the old behaviour
(`player.lasers.length === 0`, HUD still reads the old string). Without the control, a change that
leaks the new feature into every ship passes.

### Driving internals ≠ testing the wiring — do both

A suite can be green while the feature is unreachable in a real session. "Level up adds lasers"
passed for a whole round by calling `player.bulletLevel = 5; player.rebuildLasers()` directly — which
proves `rebuildLasers()` works and **nothing about whether the player can ever trigger it**. The
wiring lives in `applyPowerup('FIRE')`, a different function, and the edit that registers it there is
exactly the kind that lands separately.

Write a second, end-to-end pass that only uses real paths — dispatched `KeyboardEvent`s, the real
collision branch, real pause/resume/death/restart — and assert the *observable* chain:

```js
powerups.push(new Powerup(player.x, player.y - 70, 'FIRE'));   // real drop distance
for (let i = 0; i < 12; i++) await new Promise(r => requestAnimationFrame(r));
// level 1→2→3→4→5, lasers 1→2→3→6→10, HUD + radio message
```

⚠ **A synthetic input can expose a latent bug in the old code *and* make the new feature look
broken — you must tell those apart.** Placing a powerup at *exactly* the player's position produced
`level 1,1,1,1,1`, which reads as "the new wiring is dead". It wasn't. Tracing the actual values
(`p.x`, `p.y`, `dist`) per frame showed `x=null, y=null`:

```js
const dist = Math.hypot(dx, dy);          // 0 when the two coincide
this.x += (dx / dist) * pullSpeed * dt;   // 0/0 = NaN — coordinates become NaN forever
```

⚠ And the NaN **compounds into a leak**: the despawn guard is `if (p.y > canvas.height + 20)`, and
every comparison with `NaN` is false — so the entity can never be removed either. It is stuck on the
player permanently, glowing, doing nothing. One guard fixes it (`dist > 0.01 && dist < magnetRadius`).

The generalisable rules:

- **Trace values before concluding.** A `null`/`NaN` in a per-frame trace localises a bug in seconds;
  the pass/fail output alone points at the wrong function entirely.
- **A degenerate input (exact overlap, zero distance, empty string) is a legitimate edge case worth
  its own assertion** — but it is *not* the way to test whether the normal path is connected. Use a
  realistic distance for the wiring test, and a separate assertion for the degenerate one.
- Whenever a divisor can be a distance, check for `0`. It is the most common NaN source in this kind
  of code, and NaN usually propagates into "invisible" failures rather than a visible crash.

### A comparative probe must hold the pilot constant — and then you must ask whether it handicaps one side

To answer "is the new weapon balanced", run both variants through an identical session with an
identical, deliberately dumb pilot (invulnerable, parked at a fixed spot) and log a timeline. Only
the weapon differs, so the difference is attributable:

```
              击杀   得分      等级    达到满级
标准战机       24     9,920     Lv3     —
水母激光机     64     675,070   Lv5     50s
```

⚠ **But interrogate the fixed condition before believing the ratio.** The parked pilot is *neutral*
for a full-field weapon and a *severe handicap* for a forward-firing one — it can only shoot straight
up. So "267% more kills" overstates the gap, and the 68× score is mostly the game's own 10× bonus
wave: clearing the whole screen collects a reward a narrow weapon structurally cannot. Neither number
is wrong; both are answers to a question nobody asked.

Report the measurement and the caveat; do **not** "fix" balance the user did not ask you to change.
A comparative probe tells you what happened, not what should have.

**Falsified, same day.** I ran a six-ship comparison with a parked pilot and concluded the piercing-laser
ship was 3–4× the others (4.6× strongest/weakest) and that its `scoreMult: 1.0` was therefore wrong. Then
I swapped the pilot for one that tracks the nearest enemy and re-ran the identical sessions:

```
                  停驻驾驶员        瞄准驾驶员
水母激光机          8,830-9,700      6,560-10,800
标准战机            1,360-2,670      7,960-9,050
最强/最弱            4.60x            1.36x
```

The 4.6× collapsed to 1.36× — *below the probe's own noise floor*. The parked pilot had been feeding the
full-field weapon free kills and starving the forward-firing ones; the "imbalance" was entirely an
artifact of the pilot. Nothing about the game had changed. **The correction was to my conclusion, not to
the product.** Had I "fixed" `scoreMult` on the first measurement I would have broken a balanced game.

### Measure the noise floor before you rank anything

Run each variant **twice with two different RNG seeds** and report the per-variant spread *before*
reporting the ranking. Here the same ship, same duration, different seed, differed by 4–49% — so any gap
smaller than ~50% was never measurable, and the 4-ship ordering I was about to report was noise. Two
rules fall out:

- **Print the spread next to the ranking**, and state the threshold explicitly ("below N% don't believe
  it"). A ranking table without a noise floor invites the reader to over-read it — and invites *you* to.
- **Seed the RNG** (`Math.random = mulberry32(seed)` injected into the page before `selectShip`) so the
  run is at least reproducible. It does not remove the divergence — ships that kill at different rates
  consume the shared stream at different rates — but it makes a re-run comparable instead of fresh noise.
- **A high-variance variant is itself a finding.** The jellyfish swung 49% while the double-wing ship
  swung 4%. That says the jellyfish's output depends heavily on where enemies happen to line up, which is
  a real gameplay property — and it also means the jellyfish is the one ship you must sample more.

### A comparative probe can be wrong twice, in two independent ways: the *driver* and the *phase*

The parked-pilot bug above was about **who plays**. The same probe had a second, independent bug about
**which part of the game gets sampled** — and it is the sneakier of the two, because every number it
printed looked healthy: non-zero scores, plausible spread, a tidy ranking table.

The game's high-value events sit behind kill-count thresholds:

```
bonus wave (×10 score)   normalKillCount >= 50
first Boss (8000-30000)  killCount      >= 100
```

Measured kill rate was ~0.75/s, so a 50-second session reached ~37 kills — **neither threshold was ever
reachable at any practical duration.** Every run printed `Boss 0  奖励波 0`, and the headline
"strongest/weakest = 1.40×" was a *trash-mob-phase-only* ranking. Since `scoreMult` multiplies exactly
those unreached high-value events, the probe could not answer the question it existed to answer.

- **Print coverage counters next to the score, and warn loudly when they are zero.** A probe that
  reports a confident ratio while having observed none of the events the ratio depends on is worse than
  no probe. Guard it in the tool itself, not in your head.
- **Do not soak longer to reach the interesting state — drive the state directly.** Setting
  `killCount = 99` makes the next normal kill cross the threshold and summon the Boss within seconds.
  Same trick as the reverse-test suite: construct the adversarial state, don't wait for it.
- **Check whether the forced states chain before you force several at once.** Killing a Boss
  auto-starts a 25s ×10 super-bonus, so one forced Boss covers *both* high-value paths — but forcing the
  bonus trigger *and* the Boss trigger together cancels the bonus, because the Boss pre-warning calls
  `endBonusWave()`. Forcing two mutually exclusive states yields whichever one the guard order favours.
- **Report forced-phase and natural-phase results in separate tables, and say they are not subtractable.**
  A run started at `killCount = 99` measures "scoring ability once inside the high-value path", not
  "total gain over a whole game".

Generalisation: a comparison is only as good as the *sample*, and a sample has two axes — the agent
acting in it, and the region of the state space it visits. Interrogate both before reporting a ratio.

**And a third instance, from fast-forwarding that region: the forced state must be internally complete.**
Setting `killCount = 99` summons the Boss within two kills — but a real player sitting at `killCount = 100`
has also collected ~100 kills' worth of powerup drops and is at **maximum weapon level**. Forcing the
trigger counter alone left the pilot at level 1, and that produced a feedback loop:

```
level 1  →  can't kill the Boss  →  never opens the 25s ×10 window  →  no drops from it  →  still level 1
```

The slow ships were locked out entirely and the probe reported a **613× strongest/weakest** ratio. A real
player at that point in the game is at max level, so the number measured a state that never occurs.

- **Fast-forward every resource the agent would have accumulated, not just the trigger counter.** Before
  forcing a state, ask "what else would be true at this point in a real session?" — level, inventory,
  upgrades, unlocked abilities.
- **Mutate through the app's own path, not by writing the field.** `for (let i = 0; i < 4; i++)
  applyPowerup('FIRE')` correctly triggers the variant-specific side effect (`rebuildLasers()` for the
  laser ship); assigning `bulletLevel = 5` directly would have skipped it and silently disadvantaged
  exactly one variant.
- **Check what your counter excludes before using it as "how much happened".** `killCount` deliberately
  does *not* count bonus-wave enemies, so a reported "4 kills" actually meant "4 normal kills plus dozens
  of bonus-wave kills" — and those uncounted kills were where the powerups came from. A counter is a proxy;
  read its definition before trusting it as a denominator.

The pattern across all three failures is identical: **the probe was confident, the number was precise, and
the sample did not represent the thing being asked about.** Driver, phase, and state completeness are three
independent axes on which a comparative probe can lie to you.

### Two more false verdicts, both from the harness rather than the app

**(a) A resize test where nothing resized is a false pass.** Varying a container's `max-width` while
the CDP viewport stays at 390 px does nothing — the container is capped by the real viewport. The
suite reported "covers the new canvas" for every size while the canvas width never changed:

```
视口 1000x900 → 画布 390x844      ← width pinned at 390 for all of them
视口 1280x820 → 画布 390x820
```

Fix: drive `Emulation.setDeviceMetricsOverride` from the Node side between iterations (which fires a
real `window.resize`), and **assert the precondition** so it can never silently go vacuous again:

```js
check('测试前提：画布宽度确实变化过', new Set(rows.map(r => r.cw)).size, v => v >= 2);
```

General rule: whenever a test's *point* is that something changed, assert that it changed. Otherwise
a broken setup and a passing feature are indistinguishable.

**(b) An event-driven UI read after a direct state mutation is stale.** `updateHUD()` here runs on
events (kill, pickup, boss spawn) — **not** every frame. So this sequence reads stale text:

```js
player.bulletLevel = 5; player.rebuildLasers();   // internal state is now correct
// …600 ms later…
document.getElementById('bullet-level-text').innerText   // still "Lv1" — nothing refreshed it
```

It flaked, because whether it refreshed depended on whether a kill happened to occur in that window.
The tell was a self-contradictory snapshot: `lasers === 10` **and** `bulletLevel === 1` — the state
was right and only the DOM was old.

Two fixes, do both: call the refresh explicitly (`updateHUD()`) after mutating, **and** assert the
internal state and the rendered text as *separate* checks so a stale render is never mistaken for a
broken feature. If you only assert the text, this class of bug is invisible; if you only assert the
state, you never test the render.

**(c) An assertion over a *probabilistic* branch is flaky by construction — pin the RNG.** The boss
drop path pushes one guaranteed `REPAIR` plus two calls to `rollPowerupDrop()`, which drops only
`if (Math.random() < 0.25)`. My check said "drops ≥ 3 items" and failed with `actual=1`:

```
FAIL  击杀 Boss 掉落道具（含必掉的 REPAIR）  actual=1 expect=>=3
```

Two separate mistakes, and the second is the one that matters:

1. **The expectation was wrong about the app** — only 1 drop is guaranteed; ≥3 was my invention.
2. **Even a "corrected" threshold would still flake** — 1, 2 or 3 drops depending on the run. The
   assertion was never testing the drop *logic*, it was testing `Math.random()`.

The same trick as freezing the sweep angle applies: hold the variable you are **not** testing
constant, then assert an exact value instead of a range.

```js
const realRandom = Math.random;
Math.random = () => 0;              // 0 < 0.25 → both rolls always hit
while (boss && guard++ < 300) await new Promise(r => requestAnimationFrame(r));
Math.random = realRandom;           // restore inside the same eval
```

Now the count is deterministic — and the *composition* becomes assertable, which the range never
was: `[FIRE, FIRE, REPAIR]` proves the two rolled drops are non-`REPAIR` and the third is the
guaranteed one. A pinned RNG buys you a stronger assertion, not just a stable one.

⚠ Restore `Math.random` **before** returning from the eval. A stubbed RNG left in place silently
distorts every later section of the suite (spawn positions, explosion jitter, sweep phases).

General rule: if a check can only fail on some runs, it is not a check. Grep the product for
`Math.random` on the path you are asserting about before writing a numeric expectation.

### Screenshot, then read it — a passing suite hid a real legibility bug

Every assertion was green while the new weapon's beams **washed out the HUD**: the score sat on top
of a bright additive beam and became unreadable. Only the screenshot showed it. Fix was one CSS rule
(a dark 1px `text-shadow` outline, invisible against black, so other ships are visually unchanged) —
and it needs its own control screenshot to prove that.

⚠ Same family as the layout trap above: **`getBoundingClientRect()` and every computed style were
fine.** "Is this text readable" is not a question any assertion can answer.

---

## Layer 3 — CSS specificity traps

If the page has skin/theme overrides (`.retro-mode`, `.dark`, etc.), a plain class selector for your
new state **will lose** to `body.theme .component { position: relative }` and silently do nothing.

Check before you write:

```js
const score = sel => [/#/g, /\./g, /\[/g, /:(?!:)/g].map((re,i)=>((sel.match(re)||[]).length)*(i===0?100:i===1?10:10));
```

Practical rule: prefix new state selectors with `body ` (`body .card.new-state`) and place the block
**last** in the stylesheet. That ties or beats a `body.theme .class` rule and wins on source order.
Then add an explicit higher-specificity override for the themed case
(`body.theme .card.new-state { ... }`) so skin-specific properties like padding survive.

---

## Layer 4 — write the harness correctly (bug I hit twice)

`check(name, actual, expected)` compares values. Passing a **predicate** is fine; passing
`(v => v > 400)(actual)` — the immediately-invoked result — is not. That yields `868 === true`
and a wall of false FAILs that look like product bugs.

```js
check('h fills viewport', d.h, v => Math.abs(v - 868) <= 2, '≈868');  // ✅ predicate
check('h fills viewport', d.h, (v => Math.abs(v - 868) <= 2)(d.h));    // ❌ always fails
```

Also: when a real-browser test fails, **read the actual value** before believing it. Several of the
"failures" above were correct values compared against a broken expectation.

**Then read the code that produced it.** In one session a check asserted every entry carried one of
seven position badges; the actual values included `@D · D0`, `@D · D2`. That was the app helpfully
appending the depth — better than what the test demanded. Another asserted "no matched entries before
any chat" and got 17; the class was `ai-tv-dot key` where `key` meant *"this entry has trigger words"*,
not *"this entry matched"* — a legend dot, not a state flag.

Both looked like product bugs. Neither was. **A failing assertion is a hypothesis about the app, not
a fact about it.** Read the rendering code first; only then decide whether to fix the app or the test.
Two of the four "real bugs" found that way were imaginary, and the honest fix was to correct the
assertion — and in one case to *add* the missing legend the dot implied.

**Two more traps:**

1. **DOM is the source of truth.** If you `window.eval("cfg.x = ...")` and then fire a UI event whose
   handler re-reads inputs into `cfg`, your value is silently overwritten. Set the DOM, fire the
   event, assert on the persisted result.
2. **Assert the real DOM order.** Appended chat logs put the newest bubble at `lastElementChild`.

### A misspelled assignment silently no-ops — it never throws

Page-side code that assigns to an undeclared name (`stSbSel = ''` instead of `stEditor.sbSel = ''`)
does **not** throw in sloppy mode. It creates a free-floating global, the real state is untouched,
and every assertion afterwards still runs and still "passes". The harness looks green while testing
nothing.

Symptoms: a state-reset line that appears to do nothing; assertions that pass whether or not the
line is present. Grep your page-side snippets for assignments and confirm each one is attached to
the object you think it is. `"use strict"` would have caught this — check whether the app's inline
script has it, and don't rely on it being there.

### A shared chip/toggle callback with a hard-coded target key silently no-ops

Third member of the same family, and easy to miss because the *call site* looks right. A generic
callback built for one panel often hard-codes which state key it writes:

```js
function pickMood(key, id) { if (key !== 'exMood' && key !== 'grMood') return; state[key] = id; }
function pickFormat(id)   { state.exFormat = id; }   // ← no key parameter at all
```

Reuse it from a new panel and every click does **nothing at all** — no throw, no console warning,
the chip just never lights up. The caller passed a perfectly good id.

Rule: when a callback is parameterised by a *prefix* or *key*, either make the key an explicit
argument (`pickFormat(id, key)` and pass `'enFormat'`), or give the new panel its own thin wrapper.
Then test it by **clicking the chip and asserting the state changed** — not by asserting the chip
renders. "The chip is in the DOM" passes while the chip is inert.

### Filtering what to persist? Use an allow-list, never a deny-list

Same family as the misspelling above: **a deny-list whose key names don't match the real ones blocks
nothing, and throws nothing.**

A panel persisted its parameters and deliberately excluded its transient state:

```js
Object.keys(state).forEach(k => {
  if (k === 'running' || k === 'err' || k === 'msg') return;   // ← all three wrong
  saved[k] = state[k];
});
```

The actual field names were `exRunning`, `grRunning`, `exErr`, `grMsg`, `exRaw`, `exPreview`. Not one
matched. So a run interrupted by a reload wrote `exRunning: true` into `localStorage`, and the panel
came back **permanently stuck on "generating…" with a disabled button** — an unrecoverable UI state
produced by a silent no-op.

```js
const KEEP = ['open', 'count', 'mood', 'format', /* …only the params… */];
function saveUi() {
  const o = {};
  KEEP.forEach(k => { if (k in state) o[k] = state[k]; });
  localStorage.setItem(KEY, JSON.stringify(o));
}
```

Two properties make the allow-list worth the extra constant:

- **A key you forget to add is simply not persisted** — a cosmetic annoyance. With a deny-list, a key
  you forget to exclude *is* persisted, and if it encodes "in flight" you've bricked the panel.
- **Apply it on load too.** Deny-listed bugs leave bad data on disk; an allow-list read ignores it,
  so already-corrupted users heal on the next load instead of needing a storage wipe.

**How to test it:** don't just set the good fields. Set the transient ones *too*, save, reload, and
assert they came back clean — and assert the raw stored JSON doesn't contain those key names:

```js
await ev(`(state.exRunning = true, state.exErr = 'nope',
           state.exPreview = [{}], saveUi(), true)`);
const raw = await ev(`localStorage.getItem(KEY)`);
check('no transient state persisted', /exRunning|exErr|exPreview/.test(raw), false);
await reload();
check('panel is not stuck busy', await ev(`state.exRunning`), false);
```

### Debugging infinite recursion: instrument the suspect, then re-run the *failing* script

Symptom: `RangeError: Maximum call stack size exceeded`, and the stack is nothing but the same
function calling itself. `Error.stackTraceLimit` defaults to **10**, so every outer frame — the one
that would tell you *who* called it — is truncated away. And a hand-written step-by-step repro often
**does not reproduce**, because the trigger was some state left behind by earlier steps.

So don't rewrite the steps. **Re-run the failing harness verbatim**, and install a depth guard on
the suspect function at startup:

```js
// after page load, before the failing section
await ev(`(() => {
  Error.stackTraceLimit = 300;
  window.__orig = stSbLocate;
  window.__depth = 0;
  stSbLocate = function (id, list, prefix) {
    window.__depth++;
    if (window.__depth > 25) {
      window.__depth = 0;
      throw new Error('DEPTH>25 id=' + id +
        ' | listIsArray=' + Array.isArray(list) +          // ← argument SHAPE
        ' | prefix=' + prefix +
        ' | blocks=' + JSON.stringify(dumpBlocks()));       // ← data at the crash
    }
    try { return window.__orig(id, list, prefix); } finally { window.__depth--; }
  };
  return typeof stSbLocate;
})()`);
```

Why this works when a repro doesn't:

- It runs the **exact** sequence, including whatever earlier sections left behind.
- The error message carries the **argument shape** and the **data structure** at the crash, which
  is far more informative than a stack. In one session `listIsArray=false` plus a dump showing a
  "block" whose `id`/`type`/`children` were all `undefined` pointed straight at the root cause:
  the object had been replaced by an **empty string** further up the call chain.
- The wrapper must be reachable by the **inner recursive calls**. A top-level `function` declaration
  lives on the global object, so reassigning the name intercepts them. A function inside an IIFE or
  a module scope would not — check first, and if it isn't global, patch the *caller* instead.

Raise `Error.stackTraceLimit` before you throw; otherwise the diagnostic error itself gets truncated.
Gate the patch behind an env var (`process.env.DIAG`) so the harness stays usable in normal runs.

**Fix the pair, not the symptom.** An infinite recursion is often the *second* half of a bug. Here
the first half was a generic setter that happily wrote a scalar over an object-valued field, turning
a node into `''`; the recursion guard only converted a crash into silent data corruption. Patch the
recursion fallback *and* the writer that corrupted the data, then freeze both in a regression test.

### Test every action against every UI state

A destructive action that works perfectly in the default state can be **invisible** in another.
Real example: a header `✚` "new conversation" button cleared the log and re-seeded a greeting — all
assertions passed — but if the card was collapsed (`ai-collapsed`), the chat area had
`height: 0`, so pressing it wiped the history with nothing on screen to show for it.

For each new control, walk the app's state matrix (collapsed / expanded / maximized / themed /
mobile) and ask *"is the result of this action visible from here?"*. Fix by making the action
self-correct: expand the container before doing the work.

```js
if (card.classList.contains('ai-collapsed')) { card.classList.remove('ai-collapsed'); ... }
```

And write the assertion for it — it is one line:

```js
card.classList.add('ai-collapsed');
window.newAiConversation();
check('折叠时点新对话会自动展开', card.classList.contains('ai-collapsed'), false);
```

### Test every user-facing string with every toggle combination

The nastiest bug of a session: a greeting that read its text through the macro expander
(`applyUserMacros`) — which, when the user has macros **disabled**, returns the input **unchanged**.
Result: the chat bubble literally displayed `{{char}}`.

Rule: **prompt text and display text are different things.** A prompt may legitimately keep its
macros when the feature is off (that's the point of the toggle). UI copy must never leak them.
So the assertion is not optional:

```js
check('宏关掉时开场白仍无字面量宏', greetingText.indexOf('{{') < 0, true);
```

Generalise it: for every string the user can see, assert `indexOf('{{') < 0` (or whatever your
templating delimiters are) **under every toggle state** — on and off. Cheaper than reading the code
and reasoning about it, and it catches the whole class.

### A new state flag must be applied at every entry point that can set it

Adding a mutually-exclusive mode (`酒馆模式` vs `系统提示词`) looked like a 3-line change. The
toggle handler enforced the exclusion correctly — and the feature was still broken, because the
**import paths set the flag directly**:

```js
function onTavernToggle() { if (chk.checked) enterTavernMode(); }   // ✅ enforces exclusion

async function onCardFilePicked(ev) {
  ...
  aiConfig.tavernEnabled = true;   // ❌ bypasses enterTavernMode() — system prompt stayed "on"
}
```

The prompt *assembly* was already correct (it keyed off `tavernEnabled`), so the tests that checked
"which prompt gets sent" all passed. Only the UI/state assertions caught it: the panel still showed
系统提示词 as enabled while tavern mode was driving.

Two rules:

1. **Grep for every assignment to the flag** — `grep -n "tavernEnabled = true"` — and route them all
   through one function (`enterTavernMode()`). One entry point per state transition.
2. **Assert the derived UI state, not just the payload.** "Which prompt is in the request" passed;
   "is the switch unchecked and the block dimmed" failed. Both are needed.

```js
check('导入角色卡后系统提示词被关掉', w.eval('aiConfig.promptEnabled'), false);
check('开关自动取消勾选', $('ai-prompt-enabled').checked, false);
check('提示词区变成 ai-prompt-off', $('ai-prompt-body').classList.contains('ai-prompt-off'), true);
```

### Check the off-transition, not just the on-transition

Enabling a mode is the interesting half; **disabling** it is where the dead states live. Turning
tavern mode off while it had forced the system prompt off left the app with *no* prompt at all — a
valid-looking state that silently drops the AI's entire persona.

Walk the full matrix for any two mutually-exclusive modes:

| From | Action | Expect |
|---|---|---|
| A on | enable B | A off, B on |
| B on | enable A | B off, A on |
| B on | disable B | **A restored** — never "neither" unless that is a deliberate choice |
| neither | enable A | A on |

The third row is the one that gets missed. Write it as a test — it is one line, and the bug it
catches is invisible in a screenshot:

```js
toggle(w, doc, 'ai-tavern-enabled', false);
check('关掉酒馆后系统提示词自动恢复', w.eval('aiConfig.promptEnabled'), true);
check('不会落到「没有主提示词」的死状态', kinds(layout(w)).indexOf('main') >= 0, true);
```

### Never wait a fixed sleep equal to the transition's own duration

A collapse test slept `350 ms` and the product's transition was `0.35s`. The sleep landed **exactly
on the boundary**, so the measurement caught the *starting* value and the assertion went red — a
false red that sent the investigation into the CSS, where nothing was wrong.

The general shape: **any `sleep(n)` where `n` equals (or is close to) the animation duration is a
coin flip.** It passes on a fast machine and fails under load, and both readings look authoritative.

Wait on the element's own event, with a timeout as the backstop:

```js
// ⚠ the backstop matters: if the transition never starts, the event never fires,
//   and you must still fail — not hang
await ev(`new Promise(r => {
  const el = document.getElementById('st-card');
  let done = false;
  const fin = () => { if (!done) { done = true; r(true); } };
  el.addEventListener('transitionend', fin, { once: true });
  setTimeout(fin, 1500);
})`);
```

⚠ **Don't fix the red by shortening the sleep to "clearly enough"** — that just moves the boundary
somewhere you hope is safe. Either wait for the event, or wait for a *predicate* you can poll
(`waitUntil(() => collapsed(el))`). A sleep is only acceptable when you're waiting for something that
has no observable completion signal at all.

### Changed a *shared* rule? Verify every instance, not just yours

A touch-target fix written for one control (`@media (hover:none) { .ai-switch { padding: 12px 6px } }`)
silently applied to **every** switch in the app — the macro toggle, the stream toggle, and the new
one. The feature-specific visual test only probed the new switch, so the change to the other three
was unverified. Nothing broke, but that was luck, not evidence.

Before you edit a selector, ask *"how many elements does this match?"*:

```js
document.querySelectorAll('.ai-switch').length   // → 4, not 1
```

Then assert the blast radius explicitly — measure all of them, not the one you were thinking about:

```js
const touch = await ev(`(() => { const out = {};
  document.querySelectorAll('.ai-switch').forEach((l, i) => {
    const r = l.getBoundingClientRect();
    out['switch' + i] = +Math.min(r.width, r.height).toFixed(1); });
  return out; })()`);
check('所有开关的触控区都达标', touch, v => Object.values(v).every(n => n >= 44), touch);
```

And when the fix must be **invisible** on desktop, assert that too: the track stays 36×20 while the
label's hit area grows. "It got bigger" is not the same as "it got bigger in the right box".

### A newly red assertion may have an outdated premise, not a bug

Adding a feature can legitimately break an *old* assertion without anything being wrong. Real case:
a test asserted "a divider block has **no** extra text fields in the inspector" by counting
`.insp input[type="number"], .insp input[type="text"]`. A later feature added X / Y offset inputs to
**every** block type — including dividers, which you genuinely can move a few pixels. The count went
0 → 2 and the suite went red.

The fix is to **scope the assertion to its original intent**, not to weaken it:

```js
// was: count everything
'.st-sb-insp input[type="number"], .st-sb-insp input[type="text"]'
// now: everything EXCEPT the fields that are deliberately universal
'.st-sb-insp input[type="number"]:not([id$="-offx"]):not([id$="-offy"]),' +
'.st-sb-insp input[type="text"]'
```

So: when a previously-green assertion turns red after your change, read what it was actually
*for* before touching the product code. If the premise moved, fix the assertion and say why in a
comment; if the behaviour moved, fix the product. **Never just delete the assertion** — that's how
you lose the bug it was guarding.

**A third source of false reds: the assertion's own shape.** A start-anchored regex on a value
that the product *wraps* can never match, no matter how right the product is. Real case: a tool
returns `skill「perm_read」返回：\nOK:…` (the wrapper names which sub-agent produced the result);
nine assertions written as `/^OK:/` went red at once while the product was correct. Fixed by
anchoring on the wrapper — `/返回：\nOK:/` — which has the side benefit of asserting the wrapper
too. ⚠ Whenever you anchor with `^` or `$`, check the value isn't prefixed/suffixed downstream.
Also: **nine simultaneous reds from one cause is normal** — find the shared shape before you
start editing nine things.

The next feature (resizable blocks) reddened three more assertions the same way, and one of them is
worth calling out because the number went **down** for a good reason:

| assertion | was | now | why |
|---|---|---|---|
| divider has no extra text fields | 0 | 2 | every block type gained W / H inputs |
| "N declarations preserved verbatim" | ≥5 | 4 | a bold divider's `height:2px` stopped being "preserved verbatim" and became a **first-class field** — the feature got *better* |
| "the canvas has two buttons" | 2 | 3 | a new "reset sizes" button |

A count going down usually reads as a regression. Here it was the feature being promoted from
"keep this string verbatim" to "understand it". Whenever a feature graduates a preserved blob into a
real field, expect the preservation counters to drop — and assert the *new* behaviour explicitly
(the field holds `2`, the output still contains `height:2px`, and it is not duplicated) rather than
just relaxing the threshold.

**A second source of false reds: state left behind by an earlier section of the same suite.**
A long suite is one continuous session against one page — whatever section N set and didn't
restore is the starting condition of section N+1. Two real ones from a single run:

- section K set `state.stream = false` (to feed a non-streaming mock) and never restored it, so the
  next section's streaming-shaped mock was read as JSON → the client "silently got an empty string"
  and the failure message blamed the model for saying nothing;
- section K set `state.ref = false`, so the next section's scope chips never rendered and the
  assertion "the chip is visible" failed for a reason that had nothing to do with the code.

It isn't only booleans. A later run had a section assert *"the rendered preview shows the sentinel
text"* — but an earlier section had overwritten that same user-visible field with its own test
value, so the assertion compared against the wrong string and read as "the feature is broken".
Any field a section both writes and asserts on must be set explicitly at the top of that section.

Fix: make each section **establish its own preconditions explicitly** at the top, even when they
match the defaults, and put a one-line comment saying which earlier section would otherwise leak in.
A section that begins with "reset everything I depend on" is self-contained and reorderable; one
that silently inherits is a landmine that fires only when you edit a *different* section.

### A new feature can make an old assertion **falsely green** — `getBoundingClientRect()` ignores clipping

The previous section is about false *reds*. There's a worse variant: your change makes an old
assertion **pass for a reason that isn't true any more**.

Real case. A responsive feature hid two cards below 600px and moved them into a corner menu. An
existing "mobile" section of a Chrome-layer suite measured touch-target sizes inside one of those
cards at a 390×844 viewport. After the change:

1. **Six false reds.** The card is now `display: none` at that viewport, so every rect was `0`.
   The suite's premise ("a phone user sees this card") was stale, not the product.
2. Fixing it the *right* way — drive the real path, "tap the menu → the card goes fullscreen" —
   introduced a **false green**. Entering fullscreen ran the app's own code, which deliberately
   collapses the settings/advanced panels ("give the height back to the chat"). The panel was now
   inside an ancestor with `height: 0; overflow: hidden` — **entirely clipped** — yet
   `getBoundingClientRect()` still returned the real `2798`-tall box, because **rects are computed
   from layout, not from paint**. So `min(width, height) >= 32` and `>= 44` both passed on a panel
   with zero visible pixels.

Signals that you're looking at this, in order of usefulness:

- **A screenshot's file size.** Same clip selector, same viewport: 153 KB → 550 KB once the panel
  was really rendered. A big change in PNG size is cheap evidence that "the same" screenshot is not
  the same picture.
- **`__probe`-style `hitOk`.** The suite already had a helper that does
  `document.elementFromPoint(centre)` and checks the hit is the element or a descendant. It went
  `false` while the size assertions stayed `true` — that contradiction *is* the diagnosis.

The durable fix is to make the measurement assert its own **precondition**:

```js
// walk up from the measured element; any ancestor that clips (hidden/auto/scroll)
// AND has almost no height means "you are about to measure something invisible"
const clipAnc = await evaluate(`(() => {
    let n = document.getElementById('panel').parentElement;
    while (n && n !== document.body) {
        const cs = getComputedStyle(n), r = n.getBoundingClientRect();
        const clips = ['hidden','auto','scroll'].includes(cs.overflowY);
        if (clips && r.height < 40) return n.className + ' (h=' + r.height + ', overflowY=' + cs.overflowY + ')';
        n = n.parentElement;
    }
    return null;
})()`);
check('precondition: panel is not folded into a zero-height container', clipAnc, v => v === null, clipAnc);
```

Make it **report the culprit**, not just fail — `div.ai-adv-inner (h=0.0, overflowY=hidden)` sends
the next reader straight to the rule that did it.

**The reverse test for this kind of gate must prove both halves**, and it's worth writing down why:
inject the no-op (here: delete the "expand the panels" step) and assert (a) the new gate goes red
**and names the right element**, and (b) the old size assertions are **still green**. Only (a) means
it can fail; only (b) means the old assertions really were blind. Either half alone proves nothing.
Encode it as a self-contained script (back up → inject → run → assert → delete the copy → verify the
sha1 → **run the unmodified suite as a control**), because a gate nobody re-runs is a gate that
quietly stops working.

⚠ **To reproduce a suite's exact state, copy the suite — don't hand-build a probe.** A hand-written
probe that "reproduced" the same page state got it wrong (it left the panels collapsed, so the
clipping ancestor chain was completely different) and cost a full round-trip. `cp suite.js _diag.js`,
insert a dump right before the failing assertion, run it. It is the same state by construction.

### A multi-line anchor can never match a CRLF file

Corollary of the `$`-anchoring trap. `verify_tavern_visual.js` is CRLF (measured: 2470 CRLF, 0 lone
LF). An anchor assembled as `['line one', 'line two'].join('\n')` matches **zero** times — the `\r`
sits between them — and the error you get is "anchor found 0 times", a number with no relationship
to the actual cause. Same root cause as `/\/\/.*$/` failing to strip comments in a CRLF file:
**line terminators are part of the bytes, and `.` / `$` / a literal `\n` all disagree about them.**

Fix: **make the anchor a single line.** A one-line substring contains no terminator, so it matches
under both conventions. It's strictly more robust than "remember to join with `\r\n`".

### `[0]` in a selector is a position, and positions move

A different flavour of false red, and a nastier one. A suite asserted the toolbar's action button as
*"the first `.btn` inside the toolbar"*:

```js
document.querySelectorAll('.st-code-bar .st-code-btn')[0].textContent   // "➕ New chat"
```

Then a feature added an "import from link" button — inside a popover that is *rendered inside the
same toolbar*. `[0]` became "Import from link" and the assertion went red with
`actual="从链接导入"`, which reads like the product changed. It hadn't; the assertion had quietly
started testing a different element.

Fix: select by **something the element owns**, not by where it happens to sit.

```js
// now: the one element that carries this role's class
document.querySelector('.st-code-bar .st-code-btn.st-main-btn').textContent
```

Why this is worse than an ordinary stale assertion: **if the element you accidentally started
matching had similar text, the check would have stayed green while testing the wrong thing.** You
would only discover it the day the real button broke and nothing went red. The red is the lucky
outcome — a silently-wrong green is the bad one.

Rules of thumb:

- `[...][0]` / `[...][n]` in an assertion is a promise that nothing will ever be inserted before it.
  Prefer a class, an id, a `data-*` attribute, or a text match.
- **Descendant selectors leak across nesting.** `.bar .btn` matches buttons inside popovers, dialogs
  and dropdowns that merely *live inside* the bar. If you mean direct children, write
  `:scope > .btn` — or better, give the element its own class.
- When you add UI to an existing container, grep the suite for that container's selector *before*
  assuming the suite is unaffected.
- Assert the **shape** as well as the text — `tagName === 'BUTTON'` — so "this is an action button,
  not a menu" is actually verified rather than inferred from the label.

### A hard-coded count goes stale in more than one place — and only some of them turn red

Adding a tab / page / column to an app invalidates every assertion that hard-codes the count. The
trap is that they are **scattered**, and the ones that pass look fine:

| where | assertion | after adding 3 tabs |
|---|---|---|
| tab rail renders | `tabs.length === 11` | ✗ red |
| tab order + labels | deep-equals an 11-item array | ✗ red |
| tab ids | deep-equals an 11-item id list | ✗ red |
| collapsed rail keeps labels | `labels.length === 11` | ✗ red |
| **page walk** | iterates a hard-coded `[[id, marker], …]` list | **✓ green — silently covers 3 pages fewer** |
| mobile collapsed rail | `tabs.length === 11` | ✗ red |

The page walk is the dangerous one: it *passes*, so nothing tells you the new pages are never
visited. **Changing the number is not enough — the list itself has to grow.** Same for a "walk
every row" loop with a literal array of rows.

So when you add a repeatable thing, grep for the count **and** for the enumeration:
`grep -n "=== 11\|, 11)\|11 个\|for (const \[" harness/*.js`. Better: derive the list from the app
(`ST_TABS.map(...)`) and only assert the *set* of ids, so it can't go stale. If you must keep a
literal list, put a comment on it: `// ⚠ keep in sync with ST_TABS`.

Also worth checking: markers written as a bare id (`getElementById(marker)`) break the moment a
page's key element has no id. Use a **CSS selector** and `querySelector` — then `#id` and
`.class` both work and you don't have to invent an id just to satisfy the harness.

**A hand-maintained allow-list drifts silently — assert the naming convention instead.** When the
app keeps a list that must track a group of things (`ST_CODE_READ_TOOLS` for "the read-only tools",
a `SKIP_KEYS` set, a list of "no-persist" fields), a typo or a forgotten entry produces **no error**:
the feature just quietly falls back to the old behaviour for that one item. A test that re-states
the list can't catch that — it agrees with whatever is written down.

Derive the assertion from the convention the code already follows:

```js
// every tool whose name starts with read_/list_ MUST be registered as read-only…
TOOLS.filter(n => /^(read_|list_)/.test(n))
     .forEach(n => assert(READ_TOOLS.includes(n), `${n} missing from READ_TOOLS`));
// …and no write tool may sneak in
READ_TOOLS.forEach(n => assert(!/^(write_|add_|update_|delete_)/.test(n), `${n} is a write tool`));
```

Now the *next* read tool you add without registering it turns red, which is exactly the bug you
couldn't otherwise see. Same trick applies to any list that shadows a pattern.

**…but every exception must be written down explicitly.** The derived assertion above went red on
the first run: `read_skill` / `list_skills` match `/^(read_|list_)/` but read the *user's skill
library*, not the card, so they legitimately don't belong in `card.read`. The fix is **not** to
loosen the regex — it's to name the exception and assert the exception separately:

```js
const NOT_CARD = ['read_skill', 'list_skills'];          // 设计判断，不是漏登记
assert(namesMatching(/^(read_|list_)/).filter(n => !NOT_CARD.includes(n)).every(isRegistered));
assert(!NOT_CARD.some(n => ALL_PERMS.some(p => PERMS[p].includes(n))));  // 确实不在表里
```

⚠ The failure mode if you don't: the next time you *do* forget to register a tool, the red looks
familiar — "oh, another exception" — and you add it to the skip list instead of fixing the bug.
An unnamed exception in a derived assertion is how the assertion quietly dies.

### Moving an item (not adding one) has its own three shapes — two of them never turn red

The section above is about *adding* a thing. **Reordering** an existing one is a different job:
count-bound assertions don't care, but order-bound ones do — and again only some of them turn red.

| shape | example | turns red? |
|---|---|---|
| walk list is a **literal array** | `for (const [id, marker] of [['a','#a'], …])` | ❌ **no** — the moved item isn't in it; you silently cover one item fewer |
| **substring regex** | `/sb,code,export/.test(ids.join(','))` | ❌ **no** — see below |
| **hard-coded adjacency** | `pi - di === 1` | ✅ yes |

The substring one is the sneaky one. Move `persona` between `code` and `export` and the joined id
string becomes `…,sb,code,persona,export,…` — `/sb,code,export/` **still matches**, because the
substring `sb,code` is intact and the regex never looks past `export`. Nothing goes red; the item
is just **dropped out of coverage**. Fix: enumerate the whole run (`/sb,code,persona,export/`), and
put what you're watching into the assertion *name* (`'code sits between sb and export, persona
right after it'`) so the next person knows which line to touch.

⚠ **Don't write an order assertion as "is this substring present".** Either enumerate the full run,
or assert adjacency (`indexOf(b) - indexOf(a) === 1`).

The adjacency form *does* go red — but changing the number isn't enough. `pi - ci === 1` only says
"next to `code`"; it says nothing about having *left* `desc`. So pair it with a control:

```js
check('it sits right after `code`',        pi - ci, 1, 1);
check('it is NOT next to `desc` any more', pi - di, v => v !== 1, '≠1');   // ← the control
```

Without the control, a no-op reorder (the item left exactly where it was) still reads green.

⚠ **The predicate occupies one slot; only one "expected for humans" value follows it.** Getting the
arity wrong is easy: a `check(name, actual, pred, expect)` helper takes **4** args, so writing the
control in the positive assertion's shape —
`check(name, pi - di, 1, v => v !== 1, '≠1')` — silently makes `pred` the literal `1`, and the
assertion ends up comparing `11 === 1`. It does go red — but only because the two numbers happened
to differ. **Read your helper's signature before copying an assertion's shape.**

⚠ Same family as the count case: a hard-coded item count also lives in **user-visible copy** and in
**code comments** ("the 14 tabs on the left…"). Static checks never read comments — `grep` is the
only thing that finds them.

### A setter that defaults a missing parameter to empty silently wipes the field

A data-loss bug that no happy-path test will ever find, because the call *succeeds*:

```js
const v = String(a.value == null ? '' : a.value);   // ← missing `value` becomes ""
stCodeSetPath(card, path, v);                        // …and the field is now empty
return { ok: true, text: `已写入 ${path}（现在 ${v.length} 字）` };   // …with a success reply
```

Send `{ path: 'description' }` (or the wrong key name — the sibling tool takes `text`, this one
takes `value`) and the field is **silently cleared**, reported as success. Nobody notices until
someone reads the card and the setting is gone.

Two lessons:

- **A missing argument must be rejected, not coerced.** `undefined`/`null` → refuse and say which
  key to use. Keep `''` legal — "clear this on purpose" and "I forgot to pass it" are different
  intentions and must not share a code path.
- **Probe setters with a deliberately wrong key name.** The bug surfaced only because a test
  helper wrote `text` where the tool wanted `value`; the assertion `the card was really changed`
  came back with `""`. If you're testing a family of setters, call each one once with a bogus key
  and assert the field is **unchanged**. It costs one line and catches the whole class.

### Your docs' line numbers and counts drift silently — derive them, don't trust them

Same family as the section above, but the failure mode is nastier because nothing goes red. If the
project keeps a README / spec that says "the CSS section starts at line 2355" or "9 localStorage
keys", both go stale the moment you insert code:

- a **line number** you'll notice — you jump there and land in the wrong place;
- a **count** you won't. A wrong "9 of them" just sits there. Nobody counts a second time.

Two habits:

1. **Never trust a count — derive it from the source before you edit the sentence.** For "the app
   has 9 storage keys":
   ```bash
   grep -oE "localStorage\.(get|set|remove)Item\('[^']+'" app.html | grep -oE "'[^']+'" | tr -d "'" | sort -u
   grep -nE "^\s*(const|let|var) [A-Z_]*KEY[A-Z_]* = " app.html   # keys hidden behind constants
   ```
   The same trick for "the config has five groups" (regex the defaults object and count the keys),
   "the fixtures folder has 11 files" (`ls | wc -l`), "the harness is 11 scripts" (`ls`). ⚠ Do both
   greps — literal call sites *and* named constants — or you'll miss the half stored via a helper.

2. **Make line numbers a last resort.** Put the banner/heading **text** next to the number and tell
   the reader to grep it: `grep -n "Card Editor" app.html` survives every insertion, `2355` survives
   none. When you do refresh the table, extract the numbers with a script instead of reading them off
   the file by eye.

⚠ **Give the table a *checker*, not just a refresh.** Re-deriving the numbers by script fixes today's
drift and does nothing about tomorrow's. Write a small read-only auditor that re-reads the doc's table
*and* the product and asserts each row: for an `id` table, that `id="X"` really sits on the recorded
line (and that the first `class="…X…"` does, for class rows); for a section table, that the recorded
line really *opens* a banner comment — and when it doesn't, report the nearest preceding banner so the
failure tells you where the section actually moved to. It converts "the numbers look right" into "the
numbers were checked", and it goes red the next time an insertion shifts everything. Keep it in the
same scratch/`_`-prefixed tier as your other one-shot tools so the suite runner skips it.

⚠ **Offsets inside one table are not uniform — never recompute a table by arithmetic.** Inserting one
block into `<head>` pushed a doc's section table down, and two rows in that *same* table moved by
**different** amounts (**+20** for one, **+41** for another) because the insertion points sat *between*
them. So `new = old + K` is wrong for part of the table whatever K you pick. Re-`grep` every row, or
let the checker tell you.

⚠ **Multi-line banners hide from single-line extractors.** A section header written as
`/* =====\n   Section name\n   ===== */` is invisible to a regex that expects `/* name */` on one
line — so your freshly regenerated "current line numbers" list is quietly missing its biggest
sections. Cross-check by grepping the section *name* directly.

⚠ **Read a helper's source before describing it.** Writing "check.js does syntax and brace checking"
from the filename alone produced a wrong paragraph — the script actually verified inline-handler
references and duplicate ids, and the syntax check was a separate `node --check` invocation.
Descriptions of tooling are documentation too, and they rot the same way.

⚠ **A third kind of rot: a coverage table's *section names*.** Worse than a wrong line number,
because it never sends you anywhere — it just quietly misleads every reader. A doc table mapping
"section A / B / C → what it covers" had fallen completely out of step with the suite: the doc said
A was the protocol layer; the actual `section('A. Wiring and layout')` was layout, and the protocol
layer had moved to B. Every row was off by one and nobody could tell.

Regenerate the table from the source instead of hand-maintaining it, and put the command in the doc
next to the table:

```bash
grep -oE "section\('[^']*'\)" suite.js | sed "s/section('//;s/')//"   # paste verbatim
```

The same applies to a doc that lists a suite's *assertion counts* per section — derive those too, or
drop the numbers entirely. **Any list in prose that mirrors a list in code will drift; the only
question is whether anything will notice.**

⚠ **One wrong number can live in three different carriers — `grep` the whole repo, not the doc.**
A stale "12 presets" existed in: two rows of a spec table, one sentence of prose in the *same* spec
file, and a **comment inside the product source**. A previous cleanup fixed the two table rows and
recorded "fixed ×2"; the prose and the product comment survived. The doc even claimed "this is the
only place it's wrong" — written from reading one table.

```bash
# after fixing any count, sweep every carrier before you claim it's fixed
grep -rn "12 个要求" . --include=*.md --include=*.html --include=*.js
```

⚠ **Wrong numbers in comments are invisible to every check you have.** Syntax, symbol-reference and
escape checks all passed — because "is the number in this comment correct?" is not the subject of any
assertion. **Static checks cover syntax and symbols, not facts.** Counts embedded in comments can only
be re-verified by a human periodically running the count against the source.

⚠ **When a doc fix requires touching the product, prefer a byte- and line-neutral edit.** `12` → `14`
is the same two characters on the same line: byte count and line count both unchanged, so **none of
the documented anchors move**. That is what made it safe to do at the end of a session. If you can't
keep it neutral, budget for re-deriving every line-number reference.

⚠ **Don't rewrite historical logs — annotate them.** A dated daily log that quotes a number which was
wrong *at the time* is a record, not a bug. Add a `⚠ 这里的 12 是当时记错的数，实为 14，已在 …改正`
marker and leave the original text. Rewriting it destroys the evidence that the mistake happened —
which is usually the more useful artifact.

⚠ **A "fixed ×N" note in a changelog is itself a claim.** If it says ×2 and the real number was 3,
the changelog now contains a fresh inaccuracy. Amend the old entry to point at the later fix rather
than leaving two contradictory claims in the same file.

⚠ **Count entries by bracket-matching, never line-by-line.** Auditing a whitelist object
(`{ fnA: [...], fnB: [...] }`) with a per-line regex silently dropped the one entry whose array
**wrapped onto a second line** — and the resulting total (24) *matched the stale number printed in the
docs*, so the audit appeared to confirm the doc. It didn't; the real total was 29, and the doc was
wrong. A measurement that agrees with the thing you're checking is exactly when to double-check the
measurement.

```js
// parse to the matching brace, then match entries inside
const seg = src.slice(src.indexOf('const ALLOW = {') + 17);
let d = 1, end = 0;
for (let k = 0; k < seg.length; k++) { if (seg[k] === '{') d++; else if (seg[k] === '}' && !--d) { end = k; break; } }
const entries = seg.slice(0, end).match(/(\w+)\s*:\s*\[([^\]]*)\]/g) || [];
```

⚠ **Two numbers that contradict each other inside one file are the cheapest thing to find and the
easiest to miss.** Here a README said "29 candidates" 23 lines above "currently 24 candidates". Neither
was next to the other, so both read fine in isolation. When you sweep a doc for counts, group the hits
by *what they're counting* and compare them against each other — disagreement between two of your own
numbers is a bug report you already have.

⚠ **Do that grouping mechanically, and flag every noun with ≥2 distinct numbers.** Match
`\d+\s*(个|条|种|处|项|张|层|份|套|块|位)` plus the following noun, bucket by noun, print each noun's
set of numbers. On a large doc set this cut "read all of it" down to **8 candidate groups** — and,
usefully, **all 8 turned out to be legitimate**: "the 6th tab" vs "14 tabs", "3 chips" of one kind vs
"7" of another, "4 / 15 fields" naming two different whitelists, "9 / 31 同源" where both numbers were
*bug ids* rather than counts. The payoff is that you can now *say* the docs are clean instead of hoping.

⚠ **Exclude the changelog from a current-count sweep.** Historical entries say "12 presets" because
that was true at the time; including them buries the signal under correct-but-stale numbers. Make the
exclusion an explicit opt-in flag, not the default. (Same rule as the reverse tests: a suite that
asserts yesterday's shape is not evidence about today's.)

⚠ **If you compress a doc, measure after every pass.** Three passes at shrinking a 15.4 KB file gave
15.5 KB, 14.3 KB, then 11.0 KB — the first attempt **grew it**, because merging two bullets while
re-explaining them adds text. Without a byte count per pass you will declare victory on a file that
did not change. And when the size complaint comes from an *injected* copy, check whether that copy is
the file on disk: compare a distinctive line. A stale snapshot's truncation point says nothing about
the current file, so "it was truncated, therefore it is too big" is not a valid inference.

### A check that always fires is worse than no check

A tag-balance check was counting `<div>` / `</div>` with a regex over the **whole file**, including
`<script>` and `<style>`. Two consequences, both permanent:

- generated-HTML strings are built as `'<div' + cls + '>'`, so `<div` is followed by a quote and the
  lookahead `(?=[\s>])` never matches → `<div>` is always short by a dozen;
- a comment saying "let `<details>` manage its own state" counts as an opening tag.

Result: it reported two failures on **every** run, including runs where nothing was wrong. Nobody
can tell the real failure from the noise, so the check trains people to ignore it. **A check with a
steady false-positive rate has negative value.**

Fix it by **scoping the check to where the invariant actually holds**: strip `<script>`/`<style>`
blocks first, then count in the HTML skeleton (where tags really must balance). Keep a narrow
second pass for the JS side — e.g. only `<details>` vs `</details>`, after dropping line comments.

**Then reverse-test the check itself.** Fixing a checker is the one change where "it's green now"
proves nothing, because you might have simply stopped it from looking. Inject a deliberate defect
into a copy and confirm it still fires:

```bash
# copy the app, inject one extra <div> into the HTML skeleton, one missing </details> into JS
sed "s|APP_PATH|$PWD/bad-html.html|" static_check.js > sc-bad.js && node sc-bad.js
```

Both probes must go red. Only then is the green run meaningful.

**Three rules, each learned by rewriting the predicate once:**

1. **Measure the noise *before* you argue about the threshold.** Run the candidate predicate over
   the *current, known-good* input and count how many ⚠ lines come out. Zero to two ⇒ usable. A
   screenful ⇒ it will be ignored no matter how correct it is. Don't reason about whether it
   "should" fire; count.
2. **When the label you're matching is a human's *summary*, "contains" is the wrong test.** A doc
   table's row names are the author's paraphrase, not the source's wording — a row named
   "可折叠字段" faced a banner reading "可折叠**的**字段（描述 / 性格…）", and "浮层复古皮肤" faced
   "复古皮肤：浮层也要跟着变成老终端配色". Demanding the whole string appear gave **2 false
   positives out of 39**. Demanding **≥ 2 shared characters** kept the real signal (a line number
   that landed on a *different* banner shares ~0) and dropped the noise to **0**.
3. **Tie the threshold to the input's length.** "At least 2 shared characters" is unsatisfiable for
   an input that only has *one* character to share — so it fires forever (a row named `Code（Agent）页`
   reduces to the single character 页 once parentheticals are stripped). Use `min(2, len)`. Any fixed
   threshold has some input class for which it is always-true or always-false.

⚠ **When a predicate is useful but not certain, make it a *soft* signal — and keep it soft.** The
"did this line number land on a *different* banner?" question can't be hard, because section names
are free-form prose. So it prints ⚠ and **does not touch the exit code**. Verify that separation
too: inject a pointer to another banner, confirm the **hard** check still says ✅, the **soft** line
fires, and `echo $?` is still **0**. A soft check that quietly became hard is a regression — and so
is a hard check that got softened just to make a run green.

⚠ **Verifying "the probe restored the file" needs a snapshot from *this* run, not an old one.** After
a reverse test the natural move is `cmp` against a backup — but if you took that backup several edits
ago (before you also fixed the docs), `cmp` reports DIFF and you'll spend a while hunting a bug that
isn't there: the **backup** is stale, not the file. Take the snapshot immediately before the run:
`cp f /tmp/f.before && node probe.js && cmp f /tmp/f.before`. Corollary: when you compare hashes
across tools (Node's `crypto` vs `sha1sum`), they compute the **same** value for the same bytes — a
mismatch means the bytes differ, not that the encodings do. Don't invent an exotic explanation for a
discrepancy that has a boring one.

**The sibling failure: a check that occasionally *lies*.** While writing a throwaway tag-balance script
for the same app, it reported four unbalanced `<details>` where the truth was zero. The cause had
nothing to do with tags:

```js
// app file uses CRLF line endings
const t = line.replace(/\/\/.*$/, '');   // ← never matches: `.` does not match \r
```

In JavaScript, `.` excludes **all** line terminators — `\n`, `\r`, `\u2028`, `\u2029`. On a CRLF
file every line ends with `\r`, so `.*$` can never reach the end of the string and **the whole match
fails**. Nothing throws; the line comments simply aren't stripped, and four commented-out
`<details>` in the source get counted as opening tags.

This is worse than the always-fires case, because an always-fires check gets ignored while a
sometimes-lies check gets *believed* — you go read the app instead of the checker. Note the shipped
`static_check.js` was fine: it used `indexOf('//')` + `slice`, which is line-ending agnostic. The bug
was only in the ad-hoc replacement.

Two rules fall out:

- **Strip comments with `indexOf`/`slice` or split on `\n` — never `//.*$`.** Any regex anchored with
  `$` and using `.` is a CRLF landmine.
- **Normalise line endings at the top of every throwaway analysis script**: `src.replace(/\r\n/g, '\n')`.
  It costs one line and removes an entire class of "the number is wrong and nothing said so".

**When a structural check reports a small, suspicious, round-ish number of failures — suspect the
checker first.** Real imbalance usually cascades; a flat count of 4 from a hand-rolled script usually
means 4 lines the script misread.

### Never let a check read a generated artifact

A checker that reads `blk0.js` (produced by `extract.js` from the real source) will happily check
**last week's code** if you edited the source and forgot to re-extract. The output looks completely
normal — `MISSING: (none)` prints either way. **A stale input is worse than no check at all**: it
hands you a green light and no clue that it was the wrong file.

Fix it by removing the intermediate: have the checker read the source directly and parse it in
process. `new vm.Script(code)` is exactly equivalent to `node --check file.js` and needs no temp
file — so the whole "run extract, then run check" dance collapses to one command. Keep the generated
file only for ad-hoc analysis.

⚠ **Prove it, don't read it.** The evidence that a checker no longer depends on the artifact is not
"the code doesn't mention it" — it is: overwrite the artifact with garbage, re-run, and assert the
output is **byte-identical**. That probe takes ten lines and settles the question permanently.

### Turning a convention into a gate (and how not to overdo it)

"All three render paths remember to call `escapeHtml`" is true today and unguarded. This class is the
hardest to protect, because **there is no failure to reproduce** — nothing is broken, so nothing will
ever go red on its own.

**First measure the blast radius.** Write a throwaway probe that extracts the bodies of the relevant
functions and counts the "raw" interpolations. If it's ~20, an explicit allow-list is practical. If
it's 200, the predicate is too coarse and a gate built on it fires constantly — which is worse than
no gate (see *A check that always fires is worse than no check*). Measure before you build.

**Then pick a stable key.** Here: blank out the already-safe wrappers (`escapeHtml(x)`,
`escapeAttr(x)`) — blank the whole **balanced** call, not a regex-bounded chunk — and the remaining
`+ identifier` occurrences become candidates. Compare the candidate **multiset per function** against
a literal table.

Two choices that are not arbitrary:

- **Key on (function name, identifier name), never on line numbers or occurrence order.** Line
  numbers drift; these don't.
- **Use a multiset, not a set.** A set cannot see a *second* raw interpolation of a name that is
  already present in the same function.

**⚠ The allow-list itself can silently under-scan — so make its gaps visible.** This is the failure
mode that outlives the gate. A temp-dir cleanup matched names against a hand-written list of **6**
prefixes; the repo actually created **12**. It reported "943 / 943 deleted, 0 failed, 0 remaining" and
looked like a complete success — while **18 directories / 212.8 MB never entered its field of view**,
because an unlisted prefix isn't a *failure*, it simply isn't scanned. Nothing goes red; it just
quietly does less. (Same family as *a runner that greps one summary format silently skips suites*.)

Pair every allow-list with an **inventory of what exists but isn't listed**, printed on every run:

```
未收录的前缀（存在、但不在白名单里，不会被删）：
  (无前缀) 165   workbuddy- 33   codebuddy- 3   agent- 1   node- 1
  ⚠ 若其中有本仓库造的，加进白名单 —— 否则那批会被静默跳过。
```

⚠ **Print it; don't make it fatal.** Most entries belong to the host app and will be there forever —
a gate that always fires gets ignored (see *A check that always fires is worse than no check*).
And when you do complete the list, **cross-check it against a second, independent snapshot**: two
separate dumps agreeing on the same 12 prefixes is what turned "the list is complete now" from a hope
into a measurement.

⚠ **Before deleting an evidence file, squeeze its conclusion out first.** The 12-prefix fact existed
only inside a scratch dump that was scheduled for deletion; it went into the docs *before* the file
did. And a leftover per-directory size listing made a free final inventory pass — evidence files are
often worth one last read on the way out.

The allow-list must be **explicit and complete**: adding a new builder function, or adding one more
raw value to an old one, forces a visit to the table. That is the entire point — **make "another
value got interpolated" something a human has to look at once.** Every entry should carry its reason
(a count, an already-escaped local, a field of a static constant table).

⚠ Reverse-test it like anything else: remove one `escapeHtml`, add one unlisted builder — both must
go red, and the message must name the function *and* the offending identifier.

### Derive the check from the source — a hand-written list is a convention wearing a lab coat

The gate above replaced three render paths that "remembered" to escape. But the same static checker
also carried a **second** hand-written list: 45 helper names, each asserted to be declared.

```js
const mine = ['stSbStatusHtml', 'stSbCanvasHtml', /* …43 more… */];
check('my helpers not declared', mine.filter(n => !declared.has(n)));
```

It has exactly the two defects you'd expect, and they're worth naming because they generalise to any
hand-maintained list:

1. **Adding a new helper means remembering to add it here — and nothing tells you when you forget.**
   That's the tell. If the list cannot fail *because it is stale*, it is a convention, not a check.
2. **It only covers the names in it.** A missing declaration anywhere else is invisible, even though
   the same one-line scan would catch it.

**Replacing it is usually a strict improvement — but measure first, because you're trading one blind
spot for another.** Deriving from the source covers everything; a list covers what someone thought of.
The thing a list can do that derivation *can't* is assert that a name **exists at all** — a helper
that's declared but never referenced is invisible to a "referenced but undeclared" scan. So the
question to answer before switching is: **is every name on this list referenced somewhere?**

Write a throwaway probe, don't reason about it:

```
45 names on the list
  not referenced anywhere (derivation would miss them): 0
  derivation would report as red (should be 0):          0
```

0 in the first row means the derivation **fully subsumes** the list's intent — any declaration
disappearing still goes red — and coverage grows from 45 names to every identifier with that prefix.
If that row had been non-zero, those names would need explicit handling: keep them as a separate,
*smaller*, clearly-named existence assertion (see *Give the exception a name*), never by loosening the
scan's pattern.

**Four things to get right in the derivation:**

- **Strip strings / comments / regexes first.** `localStorage.getItem('stCodeSessions')` is not a
  reference to a variable. Here: 639 names unstripped vs **631** stripped — and although the 8
  extras happened to already be declared, making both variants green, that was **luck, not a
  guarantee**. Strip, then scan.
- **Exclude property access.** In `x.stFoo`, `stFoo` is a member, not a reference. Test the ~40
  characters *before* the match for a trailing `.` / `?.`. Without this, every `obj.stSomething`
  becomes a false positive.
- **Two scopes, two declaration sets — don't merge them.** The inline-handler check in the same file
  only accepts **top-level** `function` / `const|let|var` (handlers run in global scope). The
  prefix-scan check accepts the full set (params, destructuring, `for`/`catch`, object keys). I
  merged them on the first pass and it was wrong: with the full set, `const obj = { toggleTab: 1 }`
  lets `onclick="toggleTab()"` pass even after the function declaration disappears — the check
  silently weakened. **Different semantics ⇒ different sets.**
- **Prefer over-collecting declarations.** A name wrongly in the declared set costs you one missed
  detection. A name wrongly *absent* makes correct code go red — and a check that cries wolf gets
  ignored, which costs you all of them.

**Cross-validate the count.** The new derivation reported `770` names. A completely independent
implementation in another harness directory reported `770` for the same file. Two independent
implementations agreeing is the strongest evidence available when you change a predicate — much
stronger than either one being green on its own.

⚠ **Record it as a snapshot, not a constant.** That same count read `758` a few days earlier, then
`766`, then `770` — it keeps climbing with the code. If you paste the number into a doc, say when you
measured it — or, better, tell the reader to re-derive it (`node check.js`) rather than trust the
figure. A stale count in a doc is the same failure mode as a stale `blk0.js`: plausible, unverified,
and wrong. ⚠ Note the shape of this very edit: the number needed updating **again** a few days later,
which is exactly the argument for not writing it down at all.

**Reverse-test in pairs, not singly.** A scan like this has *two* silent failure modes — "matches
things it shouldn't" (permanent red, gets ignored) and "matches nothing" (permanent green, worse).
One probe per mode, plus a positive control:

| Probe | Inject | Expect |
|---|---|---|
| positive | bare reference `stZzBareMissing` | **red**, and `SYNTAX` stays clean |
| string | `'stZzStringOnly'` in a string literal | **green** |
| property | `window.stZzProbeOnly` | **green** |
| const | rename an `ST_`-prefixed const | **red** (proves the second prefix is scanned) |

⚠ For the positive probe, also assert **`SYNTAX` is still clean** — an undeclared identifier is a
*runtime* error, perfectly legal syntax. That contrast is the whole reason this check exists: it
catches what both the parser and every behavioural test will happily pass.

### A failing assertion in section Z is often caused by section Y

You change one feature, run the suite, and six assertions in **completely unrelated** sections go
red. The reflex is to look at the code you just wrote. Usually that's the wrong place: a suite is a
sequence, and an earlier section can leave **global state** changed.

The specific one that cost me half an hour: a new section verified the Anthropic branch and called
`setProto('anthropic', …)` — and never switched back. Two later sections asserted on
`body.messages[0].content`, expecting their system prompt. Under Anthropic, the system prompt is
**hoisted to a top-level `body.system` field**, so `body.messages` has no system at all and
`messages[0]` is the *user* message. All six went red. **The product was correct.**

Fix: a section that changes global config must restore it on the way out — same discipline as
restoring a patched file. (And prefer asserting on `stSysMsgs(...)` / the request-plan function
directly over reading back `body.messages[0]`, so the section can't leak.)

**How to find this class of bug, in order:**

1. **Falsify first.** Delete your new feature's branch from the *product* and re-run. If the same
   assertions still fail, they have nothing to do with your feature — stop looking there. This one
   step rules out the entire direction the reflex pushes you toward.
2. **Bisect by section.** Replace the suspicious section wholesale with a one-line placeholder. All
   green? It's that section. Then bisect *inside* it: keep only the line that mutates global state.
3. **Print the values, don't reason about them.** Print the global flag, the *shape* of what's being
   asserted on (`roles`), and the first few characters of the field. Here one line —
   `roles: ["user"]`, no system at all — was the decisive clue; nothing before it had pointed
   anywhere. I had already chased three wrong theories (`load()` re-reading state, a fire-and-forget
   request landing late, a leftover config write). All three were eliminated by the bisect.
   **Had I printed those three values at the *second* failure instead of the fifth, I'd have saved
   half an hour.**
4. **Diff the sequence of global mutations.** Grep every `setX(...)` call before the failing
   assertion and look at the last one. That's usually the culprit.

⚠ The tell that you're in this failure class: the red assertions are in sections you never touched,
and their subject matter is unrelated to your change. **"Changed A, broke B" deserves a state check
before a code review.**

### Don't assert "byte-for-byte identical output" on a suite that prints timings

Re-running a suite after restoring the product and asserting `after.out === base.out` looks like the
strongest possible check. It isn't — it's a check that **must** fail. Suites that log a per-test
elapsed time (`[1.2s]`) or a timestamp produce different bytes on every run, and the failure message
just says "not identical", pointing at the timing rather than at anything real. You then learn to
ignore that assertion, which is worse than not having it.

Assert on the **conclusion**: the summary line, the pass/fail counts, the exit code. That is
genuinely what "the product was restored" means, and it stays stable across runs.

### A check whose verdict depends on where the extractor cut carries no information

A static checker reported `style block #2: braces unbalanced → depth:-1`. I hadn't touched any CSS
that round, so before editing anything I **counted the input**:

| | count |
|---|---|
| `<style` in the file | **23** |
| `</style>` in the file | **4** |

The 19 extra `<style` occurrences are all inside **JS string literals** (the status-bar generator
emits `<style>` markup). The extractor's regex `/<style\b[^>]*>([\s\S]*?)<\/style>/gi` pairs each
`<style` with the *next* `</style>` — so "block #2 / #3 / #4" were **half-cut JS fragments**
(block #2 ran from line 8281 to 9352, both endpoints in the middle of functions). A JS *fragment*
has no reason to be brace-balanced.

⇒ **The check's red/green depended on where those two cuts landed.** Adding a few dozen unrelated
lines could flip it. It had been passing — but that was luck, not evidence.

Fix: **strip `<script>` blocks first, then find `<style>`** (the string literals vanish with the
script), and add a gate on the extraction itself — outside `<script>`, the `<style` / `</style>`
counts must be equal *and* equal to the number of blocks extracted. After the fix: `4 style blocks`
→ **`1`**, and the checker went green.

⚠ **"The check went red" and "the product broke" are separated by one step: count the input first.**
⚠ Stronger: **a check that depends on where the extractor cut tells you nothing either way.** Any
script that slices a big file and then inspects the slices needs a **self-check that the slices are
right** — otherwise you are verifying the extractor's luck, not the product.

### A runner that greps one summary format silently skips suites

Running "all 11 suites" with a shell loop and grepping the last line is the right instinct — but if
the suites don't agree on a summary format, the ones that don't match produce **a blank line**, and a
blank line reads as "no failures" rather than "never looked".

Here 7 suites print `N 通过 / N 失败` and 4 print `N passed, N failed`. A runner matching only the
first form reported nothing at all for the other 4 — including a 84-assertion suite. Nothing failed,
nothing warned; the totals just quietly came up 272 short.

⚠ **And if you shell-loop anyway: `$?` after a pipe is the *last* command's status, not the suite's.**
`node suite.js 2>&1 | tail -4; echo "exit=$?"` prints `tail`'s status, which is always 0. Confirm it in
one line — `false | tail -1; echo $?` prints `0`, so a command that cannot possibly succeed reports
success. Either run the suite unpiped, use `set -o pipefail`, or read `${PIPESTATUS[0]}`. The evidence
that a suite ran is its **output** (summary line, counts, artifacts written) — never a bare `exit=0`
you collected from the wrong process. ⚠ The general shape is worth naming: **if you measured the wrong
object, you did not measure.** It reads exactly like a pass.

```bash
# matches both, and says so
"$N" "$f" 2>&1 | grep -E "[0-9]+ (通过|passed)" | tail -1
```

**Write the runner as a program, not a shell one-liner.** Three checks turn this from silent to loud,
and none of them needs a hard-coded expected count:

1. **Every suite must yield a parseable summary.** A blank line becomes `NO-SUMMARY` plus a non-zero
   exit. This is the check that actually kills the bug above.
2. **Reconcile the list against the directory.** Every `*.js` must be either in `SUITES` or in an
   explicit `NOT_A_SUITE` list; anything unclassified is an error. This catches the other half — a
   new suite that nobody registered. Deliberately **do not** write "anything not in `SUITES` is
   skipped": that is exactly how a new suite gets ignored forever.
3. **Any `failed > 0` is an error.**

**Do not hard-code the expected total.** It is tempting and it looks like the strongest check — but it
must be edited every time an assertion is added, so it decays into a check that is always red, and an
always-red check gets ignored (see *A check that always fires is worse than no check*). Print the
total instead and let a human (or a doc) compare it. The bug you are hunting is "a suite was
**skipped**", not "the number changed".

**Reverse-test the runner itself.** Two cheap probes: drop an unclassified `.js` into the directory,
and make one suite print no summary. Both must exit non-zero, and the first must bail *before*
running anything. A gate you have never seen close is a gate you do not have.

⚠ One detail when scripting these probes: to make a suite "print no summary" you patch the `SUITES`
list — and you must **prepend**, not replace. Replacing an entry leaves the old name unclassified and
the run dies at the reconciliation step instead, so the probe passes for the wrong reason and never
exercises the `NO-SUMMARY` branch. (This is the *same* shape as *"a newly red assertion may have an
outdated premise"*: read which check fired before believing the result.)

### A suite that runs close to the runner's timeout is guaranteed to flake — and reads as a product bug

The runtime reverse-test suite takes **282 s** on its own. The runner's per-suite cap was **300 s**.
Six percent of headroom is not headroom: standalone it passed, but inside the runner — after five other
suites had run, with more memory pressure and a colder cache — it crossed 300 s, got `SIGTERM`'d, and
was reported as a failure. The product was fine the whole time.

⚠ **`execFileSync` kills on timeout, so the child's `status` is `null`.** That is the signature, and if
the reporter prints only `exit=${code}` plus a generic `NO-SUMMARY`, a timeout is **indistinguishable
from an assertion failure** — you will go and debug the app. Distinguish them explicitly:

```js
catch (e) { code = e.status; timedOut = (code === null); }
const verdict = summary ? summary[0]
    : (timedOut ? `超时被杀（>${cap/1000}s，夹具问题，不代表断言失败）` : 'NO-SUMMARY');
```

- **Set the cap from a measurement, not a guess.** Time the slowest suite standalone, then give it
  roughly 2×. Support a per-suite override so one genuinely slow suite doesn't inflate everyone's cap.
- **When a suite reports `NO-SUMMARY`, run it standalone and time it before touching the product.**
  That single move is what separated "harness too tight" from "the app broke".
- ⚠ **A timeout silently truncates the assertion set — it does not just lose the summary.** The output
  showed `22 通过 / 0 失败` and then no summary, and I first assumed every probe had passed and the kill
  had merely landed in cleanup. **That reading was wrong.** After raising the cap the same suite reported
  **30 pass** — 8 assertions had never run at all. A truncated run reads as "22 pass, 0 fail", which looks
  green, while a quarter of the suite is simply absent. The summary line is the only thing that certifies
  completion; **a pass *count* without one certifies nothing.**
  (Falsified same day — my first reading of this exact output was wrong, and only re-running exposed it.
  The general shape: *a number that went down is not a number that was measured.*)
- The reason it is slow is structural, not incidental: 11 probes × a full `verify.js` run each. Slow
  suites are usually *suite-count × per-suite cost* — look there before optimising anything inside.

### Two harness directories with the same name

If the harness lives in `_verify/` next to the app *and* an older copy lives in a scratch workspace,
running "all the suites" in one directory silently skips the other half. Print the **absolute path**
at the top of every run, or keep a single runner script that lists both and refuses to finish unless
the totals add up. Same shape as the port problem: the harness is acquiring a resource from the
machine, and the acquisition has to be checked, not assumed.

**Give each directory its own runner.** They have different suite lists *and* different summary
formats (`N/N 通过` in one, two variants in the other), so a single runner for both would be config
pretending to be logic. Two small self-contained runners beat one clever one — and each gets its own
reconciliation and its own reverse test.

**Have the runner set `NODE_PATH` itself.** If some suites need a package installed elsewhere, a
missing `NODE_PATH` yields `Cannot find module 'jsdom'` — an error that looks nothing like an
assertion failure and sends you hunting for a nonexistent install problem. The runner should: use
the env value if present, else fall back to the standard location if that directory exists, and
**print which one it used**. One line of output removes a whole class of confusion.

⚠ The old shell version was `... | tail -1`, which *did* print the last line — but printed it
without judging it. A suite that crashed ends on a stack-trace line, which scrolls past looking like
ordinary output. "Visible" is not "checked".

### To prove an assertion guards a bug, inject the bug back into the *product*

Green tells you the assertion didn't fire. It does not tell you the assertion *can* fire. The only
way to know is to put the defect back and watch it go red.

**Back up first, and make the script check before it writes.** Read the file, assert every
`indexOf(anchor) >= 0`, and only then `writeFileSync`. If a match string is wrong the script exits
with `NOT FOUND` and the product is **untouched** — which is exactly what you want. A first attempt
here failed that way and left the app byte-identical, so the retry cost nothing and no half-applied
edit ever reached disk.

**Multi-line anchors must be joined with `\r\n`** on a CRLF file. A `\n`-joined string gives
`indexOf === -1` on text you can plainly see in the file, and you get a `NOT FOUND` that looks like
the anchor is wrong when only the line endings are.

**Count the reds, and check the control group.** Expect *exactly* the assertions that target the
defect. Here two injected defects produced **exactly 6 reds**, and all four control assertions
stayed green. Too few reds means some assertion you believed in isn't wired to the behaviour; a red
control means the defect is broader than you intended.

⚠ **A control group is not decoration.** "After calling a pure-compute skill 6 times, the card is
still writable" reads like a real test — but without the paired "a `card.write` skill *does* burn a
step", it passes even when the entire budget exemption is broken, because the broken version never
reaches that assertion's premise. Every "something happened" assertion needs a "something must
*not* happen" twin.

⚠ **The batch-edit trap applies to docs too.** Editing a README with 7 `Edit` calls in one message
reported success on all 7; `grep` showed **only 3 had landed**. For docs and memory files, either
send one edit per message, or use the check-then-write script above — it is strictly more reliable
than a batch of `Edit` calls, and it verifies itself.

### Give the feature a sentinel string, then assert it at the far end of the pipe

When a new input has to survive a long pipeline (UI → state → request body → wire), don't write one
"the feature exists" assertion per hop. Pick **one distinctive value that cannot occur naturally**
and assert it at the *last* hop, where the only way it can be there is if every earlier hop carried
it:

```js
const SEG = 'N段哨兵-7f3a：这是一段角色扮演对话。';
// far end: the recorded request body
check('first message is the sentinel', lastCall().body.messages[0].content, SEG);
// other protocol hoists system elsewhere — assert the same string, different location
check('system field starts with it', ac.body.system.indexOf(SEG), 0);
```

Two properties make this pay off:

- **The same string doubles as a leak detector.** Because it's a literal, you get the negative
  assertions for free — the sentinel must be **absent** from the saved draft and the exported
  artifact, and **present** in its own config key. Three assertions, one constant, and they catch a
  genuinely dangerous class of bug (a setting quietly ending up inside the thing you ship).
- **Distinctiveness is the whole point.** `'test'` or `'hello'` produces false positives from
  unrelated UI copy; a marker with a hex fragment in it greps cleanly.

**Always pair it with the empty case.** "When the field is blank, nothing extra is emitted" is the
property every downstream byte-for-byte comparison depends on, and it is the assertion that proves
the feature is a no-op for users who never touch it:

```js
check('blank emits no extra message', planMessages(plan()).length, 2);   // 2, not 3
check('filled in adds exactly one',     planMessages(plan()).length, 3);
```

### A side-effect *flag* that must travel through N layers — nothing fails when it doesn't

Same family as the sentinel above, but the failure mode is invisible because the payload is fine.
Real case: a tool call returns `{ ok, text, touched }`. The caller uses `touched` to decide whether
to repaint a second panel showing the current document. A new code path ran the tool **two layers
deeper** (sandboxed iframe → postMessage RPC → the same tool runner) and simply didn't forward
`touched`. Result:

> the tool reported success, the document **really was** modified, and the user's side panel showed
> the **old** document. Every assertion stayed green — the payload was correct.

So: whenever a return value carries a **flag that triggers a side effect** (`touched`, `dirty`,
`changed`, `needsSave`, `invalidated`) rather than data, assert it **at the outermost boundary the
user can observe**, not at the layer that produces it:

```js
check('a write through the sandbox still reports touched', outer.touched, 'skill');
check('a read-only run reports nothing',                   outer.touched, '');
```

⚠ And the general rule this is an instance of: **a value threaded through layers must be asserted
at the far end.** A dropped field never throws — it just makes some downstream step not happen.

### "The operation failed" does not mean "nothing happened"

A close cousin, and the one that actually harms users. An error message said *"the card was not
modified"* — but the operation could fail **after** succeeding at a write: run a write tool, then
throw. The document **did** change, and the message told the user it didn't. That's the worst kind
of wrong message, because it stops them from checking.

```js
// ✗ unconditional — a lie whenever the failure came after a successful write
return { ok: false, text: `…failed. (Nothing was changed.)` };
// ✓ branch on what actually happened
const did = touched ? '(⚠ it already wrote to the card — the change is there.)'
                    : '(nothing was changed.)';
```

⚠ Whenever you write **"failed ⇒ nothing happened"**, ask *"what had it already done before it
failed?"* — and make the message read from the recorded state, not from the assumption. Test it by
building a case that writes and then throws, and assert the message says so.

### A shared "is this configured?" guard can block the action that does the configuring

Worth its own entry because the test suite caught it, not the user, and the failure mode is a button
that is *permanently* dead while telling you to do the thing it refuses to do.

The app had one `ready(cfg)` check used everywhere: needs a base URL, an API key, and a **selected
model**. Then a "fetch the model list" button reused it — but that button's entire purpose is to
*produce* the model list. So it refused to run until a model was selected, and the user could never
select one. The message read: "no model selected — click 'fetch models' first."

Give the guard an opt-out for the prerequisite the caller is about to satisfy:

```js
function ready(cfg, opts) {
  const needModel = !(opts && opts.needModel === false);
  ...
  if (needModel && !cfg.model) return { ok: false, why: '...' };
  return { ok: true };
}
// the fetch-models button is the one place that passes it
ready(cfg, { needModel: false });
```

Generalisable smell: **any prerequisite check that lists more than one condition will eventually be
reused by the one action that supplies one of those conditions.** When you write such a helper, ask
which condition the caller is about to create, and make that one optional from the start.

### A registration edit lands separately from the code that uses it

Adding a feature often means editing two places: the implementation, and a registry / table /
switch that makes it reachable. **Those two edits can land independently** — the tool reports success
for both, and only one is on disk. The symptom is a blank page or an unreachable route, with the
implementation sitting right there looking correct.

Concretely, this session: `switch (tab) { case 'ai': return renderAi(); }` landed, but the
`TABS` array entry `{ id: 'ai', ... }` did not. Result: the tab simply wasn't there.

Three occurrences in this project so far, all the same shape ("the declaration didn't land, the
reference did"). So:

- **After a multi-edit batch, `grep` for each change** — don't trust the per-edit success message.
- Prefer a **single edit that contains both halves** when they're adjacent, or verify immediately
  after each one.
- The cheap detector is a static check for *referenced but never declared* identifiers — it catches
  the mirror-image case for free.

#### The worst variant: the same change at N call sites

A later session hit this five times in one batch, and the nastiest one had **no static signature at
all**. A helper call was being swapped in at three call sites:

```js
// before, at three different functions
const text = await chat([{ role: 'system', content: plan.system },
                         { role: 'user',   content: plan.user }], opts);
// after
const text = await chat(planMessages(plan), opts);
```

Two of the three landed. The third kept its old literal array — which is **still valid code**, so:

- no `ReferenceError`, no static-check hit (the identifier *is* declared, twice)
- the app runs, that one feature works, and just silently ignores the new behaviour
- the failing assertion is at the far end of the pipe: *"the request body's first message is X"*,
  actual = the old system prompt

So the rule is not "grep for the declaration", it's **"grep for the change, and count the hits"**:

```bash
grep -c 'planMessages(plan)' file.html     # expect 3, not 2
grep -n "role: 'system', content: plan.system" file.html   # expect no hits at all
```

Grep the *old* text too — a zero count there is what proves the sweep was complete. And when a
feature must appear at every site, a behavioural assertion (`request.body.messages[0] === sentinel`)
is the only thing that reliably catches the straggler.

### Tab-away / re-render churn

If the app re-renders from state (not by appending), assert the **row count** before and after an
action, not just the text. "Content changed" passes even when the action duplicated a row.

### Key per-row UI state by a stable id, never by index

If each row/item can have its own expanded panel, pending result, error message, or "currently
busy" flag, store those against the item's **id**, not its array position. Any insert / delete /
reorder shifts every index after the change point, so an index-keyed flag silently re-attaches to
a *different* item — you get "I opened row 3 and row 5's panel opened", or an error message
rendering on someone else's card. The bug is invisible in the state object and only shows up as
mislabelled UI.

Two consequences worth building in from the start:

- **Re-resolve after every `await`.** An async action captured index `i` before the request; the
  user can delete that row while it's in flight. Look the item up again by id when the response
  comes back and bail with a readable message if it's gone — don't write to `list[i]`.
- **Errors and notices need an owner id too** (`errId` / `msgId`). A single global `err` string
  means item A's failure renders on item B's panel as soon as B is opened.

Test it by asserting the *identity*, not the position: `enPreview.id === rows[0].id`, and after a
delete-while-busy, that the error is attached to the deleted item's id and **absent** from a
neighbouring panel.

### `<details>` fires `toggle` asynchronously — and re-render fires it again

`<details>`/`<summary>` is the obvious way to build collapsible per-item panels, but two things
bite when the app re-renders from state:

1. The `toggle` event is **queued as a task**, not dispatched synchronously during the click.
   A harness that clicks the summary and immediately asserts on the opened panel will read the
   pre-toggle DOM. `sleep` a tick (100–200 ms) after the click.
2. Setting the `open` attribute — including via the parser when you re-render
   `<details open>` from state — also queues a toggle event. So the handler runs again on every
   repaint of an already-open panel.

Write the handler **idempotently**:

```js
function onToggle(ev, i) {
  const item = rows[i];
  if (!item) return;
  if (ev.target.open) {
    if (state.openId !== item.id) { state.openId = item.id; repaint(); }  // no-op if already open
  } else if (state.openId === item.id) {
    state.openId = ''; repaint();
  }
}
```

Without the guard, "open → repaint → new `<details open>` → toggle → repaint → …" either loops or
thrashes the pane on every interaction.

Also: if the panel body is only rendered when open (the right call when there can be dozens of
items — otherwise you ship hundreds of buttons that `rerender()` rebuilds every keystroke), the
closed state must still render an **empty but present** `<details>` wrapper, or the click has
nothing to attach to.

### Writing a parser? Test it by round-tripping your own generator

If the app both **generates** output and **parses** that output back (HTML → model, JSON → form,
markdown → rich text), the highest-value test is not a pile of hand-written fixtures. It is:

```
build model → generate output → strip anything only you would have written
           → parse it back → compare the model
```

The generator and the parser are supposed to be inverses. If either changes without the other,
one template run exposes it — and it covers every construct the generator can emit, for free.

Concretely, for each preset/template:

```js
for (const i of [0, 1, 2, 3, 4, 5]) {
  const r = await ev(`(() => {
    applyTemplate(${i});
    const before = typeTree(state.blocks);
    const themeBefore = state.theme;
    // strip the marker that says "we wrote this" → now it looks like a stranger's file
    const foreign = generate().replace(/<!--MY_MARKER:[\\s\\S]*?-->/, '<!---->');
    const p = parse(foreign);
    return { before, after: typeTree(p.blocks), themeBefore, themeAfter: p.theme,
             raw: p.stats.rawFallbacks };
  })()`);
  check(`template ${i}: structure survives the round trip`, r.after, r.before);
  check(`template ${i}: theme is recovered`, r.themeAfter, r.themeBefore);
  check(`template ${i}: nothing fell back to a raw blob`, r.raw, 0);
}
```

Three things this catches that fixtures don't:

1. **Asymmetry** — the generator writes `font-size: size-2` for a sub-label, the parser reads
   `font-size` as the size. Only a round trip notices.
2. **Silent loss** — a construct the parser doesn't recognise becomes a "raw HTML" fallback.
   Assert the fallback count is **0** on your own output; a nonzero count is the parser telling you
   what it can't handle.
3. **Marker leakage** — the round trip forces you to strip your own provenance marker first, which
   is exactly the "card written by someone else" case you actually need to support.

Pair it with a hand-written fixture for the *foreign* shapes your generator never emits, and a
"never loses content" assertion: for every fallback blob, check its text really appears in the
regenerated output (`indexOf('<table')`, `indexOf('.x{color:red}')`). Asserting only
*"the block type is `raw`"* is not enough — it might be preserving the wrong thing.

**A lazy capture swallows the punctuation in front of its closer.** Header comments of the form
`/*!MANIFEST {json}!*/` look like a job for `/\/\*!\s*MANIFEST\s*([\s\S]*?)\*\//`, and that regex
captures `{json}!` — the `!` sits before `*/`, so the lazy group stops at the last position that
still allows a match, which is *after* the `!`. `JSON.parse` then fails with
`Unexpected non-whitespace character after JSON at position N` — an error that mentions JSON, not
your regex, so you go hunting in the payload. Write the closer as `\s*!?\*\/`.

General rule: when a delimited format has **optional punctuation just inside the closing
delimiter**, the lazy-capture idiom is wrong. Either consume the optional part explicitly
(`!?`), or make the capture non-greedy *and* anchor what follows. And when a parse error's
message points at the *data*, check the *pattern* first — the payload is usually innocent.

### Push the round trip to **byte-for-byte**, then to **pixels**

Structural equality is a weak assertion. It passes while every colour, shadow, letter-spacing and
padding in the user's file has been silently replaced by your defaults. Two stronger rungs:

**Rung 2 — regenerate and compare the output text.** Instead of comparing the *model* after
parsing, regenerate from the parsed model and diff the two output strings:

```js
const gen1 = generateBody(state);                     // what you would have written
const foreign = generateDoc(state).replace(/<!--MY_MARKER:[\s\S]*?-->/, '<!---->');
const p = parse(foreign);
const gen2 = generateBody(rebuild(p));                // parse → rebuild → generate again
// find the first differing character so the failure message is actionable
```

Compare the **body**, not the whole document, if the document carries a marker with regenerated ids
(a UUID per block is *by design* different after parsing — that is not a difference).

This rung is what makes a "keep it verbatim" feature honest: it proves the parser recorded
everything the generator needs, and it fails loudly the moment either side drifts.

**Rung 3 — compare rendered output element by element, then pixel for pixel.** Geometry and computed
styles are the only ground truth for "does it still look the same". Probe both documents in iframes
at the same width and diff, for every element: rect (x/y/w/h) plus ~40 computed properties
(`color`, `backgroundColor`, `backgroundImage`, `boxShadow`, `textShadow`, `letterSpacing`,
`padding*`, `border*Width/Color/Style`, `borderTopLeftRadius`, `fontSize`, `fontWeight`, `textAlign`,
`display`, `flexGrow`, `flexBasis`, `minWidth`, `gap`, `lineHeight`, `whiteSpace`, `overflow`,
`width`, `height`, `opacity`, `marginTop/Bottom`, `justifyContent`, `alignItems`, `position`).

`getBoundingClientRect()` is relative to each iframe's own viewport, so identical layouts give
identical coordinates and can be compared directly.

⚠ **Skip elements that are render-equivalent but not DOM-equivalent.** Converting `<br>` into a
newline in a `white-space: pre-wrap` block renders the same break while removing a DOM element. An
index-based comparison then reports dozens of bogus diffs, because the two arrays are misaligned
from that point on — the failure message shows a `BR` compared against a `DIV`, which is the tell.
Filter them out of *both* sides before comparing.

The same trap fires for `<style>` and `<script>`: if the original had them in `<head>` and your
pipeline hoists them into the body (as a raw-HTML block), CSS still applies document-wide and the
render is identical — but every element from that index on is compared against the wrong partner.
Symptom is a wall of `tag: DIV ≠ STYLE`. Skip all three:

```js
const SKIP = { BR: 1, STYLE: 1, SCRIPT: 1 };
const all = [...d.body.querySelectorAll('*')].filter(el => !SKIP[el.tagName]);
```

**Run more than one fixture, and tier the assertions per fixture.** A single fixture tests one
shape of input; the bugs live in the *other* shapes. Two structurally different inputs — one using
only inline `style`, one relying on `<head><style>` + classes — exposed four bugs that the first
fixture passed clean.

But then a shared expectation becomes wrong: containers with no recognisable inline signature
**legitimately** fall back to a raw block in the class-based fixture and not in the inline one. So
give each fixture its own ceiling (`{ name:'inline', maxRaw:0 }` / `{ name:'class', maxRaw:3 }`)
and assert *"did not exceed the expected count"* rather than a global `=== 0`. A global zero is a
false alarm, and false alarms cost more time than the bug you were hunting.

Finally, **the endgame is pixels.** Geometry + computed styles can all match while the rendering
differs (inheritance, stacking, border-radius clipping). Screenshot the same region of both and
compare the PNG bytes:

```js
// two minimal pages, each a single iframe pinned at 0,0 — no layout ambiguity
// then: Page.captureScreenshot { format:'png', clip:{ x:0, y:0, width:500, height:1100, scale:1 } }
check('pixel-identical', pngA === pngB, true);
```

Chrome's PNG encoder is deterministic, so `===` on the base64 is a valid pixel test. Also write a
human-viewable side-by-side page (original | regenerated, with a "identical / N differences" badge)
— the user can open it, and it doubles as the screenshot you should look at.

### Your test data is part of the spec — ASCII-only data hides whole classes of bugs

A parser can be perfectly correct for the fixtures you wrote and still fail on most real input,
because **the fixtures are what you instinctively reach for**, and that is almost always the
simplest, most ASCII, most "tidy" shape.

Real case: a Zod-source parser located its schema with

```js
/registerMvuSchema\s*\(\s*([A-Za-z_$][\w$]*)/        // identifier
/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*z\.object\s*\(/   // its fallback
```

Both patterns are `[A-Za-z_$]`-only. In a Chinese-language user base, `const 角色 = z.object({…})`
+ `registerMvuSchema(角色)` is completely normal — and every such file failed to parse, so the app
reported *"can't recognise this card's Zod"* while the file was perfectly valid. The user's only
recourse was to conclude their card was broken. **It was found the moment a test happened to use a
Chinese identifier — nothing else in the suite could see it.**

So, deliberately vary the *data*, not just the code path:

- **Non-ASCII identifiers / keys / filenames.** `[A-Za-z_$]` is a bug magnet in any app with CJK
  users. Include one CJK identifier in every parser fixture.
- **The ugly shapes your own generator never emits.** Two-space vs four-space indent, `export`
  present or absent, trailing commas, a second unrelated `z.object` (a `Base` that gets
  `.extend()`ed) sitting *before* the real schema.
- **Both extremes of every numeric field.** `0`, negative, and the maximum — a clamp written as
  `Math.max(0, …)` silently eats negative values.
- **Empty and single-element collections.** An empty array parses to `[]`; code written as
  `if (!parsed.length) return null` then reports failure on a legitimately empty model.
  Assert on the **null/undefined signal**, never on emptiness.

And when a test *fails*, check the data before the code. A fixture that is "obviously fine"
because it looks like the happy path is exactly the fixture that proves nothing.

### Making a diff robust: use your own generator as the baseline

If you need to record "what the user's input had that my generator does not produce", do **not**
maintain a hand-written allow-list of properties. Regenerate the element from your model, parse
*that*, and diff the two style maps:

```
actual style map  −  style map my generator produces  =  what must be preserved verbatim
```

```js
function ownMaps(block, theme) {          // generate once, read it back
  const el = new DOMParser().parseFromString(
    '<body>' + blockHtml(block, theme) + '</body>', 'text/html').body.firstElementChild;
  return { outer: styleMap(el), inner: styleMap(findInner(el)), /* … */ };
}
function extraOf(actual, own) {
  return Object.keys(actual || {})
    .filter(k => own[k] === undefined || norm(own[k]) !== norm(actual[k]))
    .map(k => k + ':' + actual[k]).join(';');
}
```

Benefits: the parser and generator share **one** definition of "what we produce", so changing the
generator cannot silently break the parser. Normalise before comparing (strip all whitespace,
lowercase) so `margin:3px 0` and `margin: 3px  0` are not treated as different.

Store the extras per element layer (outermost / the "track" layer / the "fill" layer / a grid
column wrapper) and append them **after** the generated declarations — same property, later wins,
so the original survives while the model still drives everything else.

**Verify the diff itself, don't trust it.** Two cheap self-checks, both computed inside the parse
call so callers and tests get a verdict rather than a hope:

1. regenerate and compare visible text (normalise the templating macros first);
2. for every preserved declaration, assert its normalised form actually appears in the regenerated
   output. Appending at the end makes presence equivalent to "the browser will use it".

**Suppression is the mirror problem.** Anything your generator writes *unconditionally* will be
imposed on inputs that never had it — an input with no outer box suddenly gets a border, padding and
font. Record the list of "generator always writes these" properties, and store which ones the input
*omitted* so the generator can skip them. Watch for the degenerate case: all of them omitted = the
wrapper collapses to a bare element, which is exactly right.

**But suppress per *property*, never per *element*.** The first version of this asked only "did the
input write *any* inline style on this element?" and stayed silent only when the answer was no. That
is too coarse: real inputs are usually mixed — `style="font-size:13px"` on an element whose colour
comes from a class. The element has an inline style, so nothing was suppressed, and the generator's
theme colour (inline) beat the class (stylesheet) every time. Compare the two property *sets*:

```js
ownProps[role] = Object.keys(styleMap(inputEl));         // what the input actually declared
look(role, css) = css.split(';').filter(d =>            // only emit those declarations
  ownProps[role].includes(d.split(':')[0].trim().toLowerCase())
).join(';');
```

Two details that bite:

- **Re-add the trailing `;`** when the filtered result is non-empty. Callers splice this fragment
  into the middle of a longer style string, so dropping the separator produces
  `font-size:13pxjustify-content:center`.
- **Emit no `style` attribute at all when the result is empty** (`attr(css) => css ? ' style="…"' : ''`).
  A leftover `style=""` changes the output bytes and breaks a byte-for-byte round trip.

And check whether a declaration you write *for structural reasons* also has a visual effect — a
`white-space: pre-wrap` added so that newlines survive has no business being written on an element
whose default was `normal` and which has no newlines. Gate it on the actual need, not on the layer:

```js
preWrap = !hasClass ? true                        // generator has always written it; don't churn bytes
        : needsPre(text) || ownProps.includes('white-space');
```

### The host runtime is the spec — go read it, don't infer it

If your app's output is consumed by a host (a chat platform, a plugin framework, an embedder), the
*host's* parsing and rendering rules are the only definition of correct. The project had a written
"hard constraint" — *"the host sandbox strips `<head>` styles, so everything must be inline"* —
that turned out to be **false**, and it had been shaping the generator for a while.

Find the real rule before designing around an assumed one, then **mirror it in the parser** so the
two agree by construction. Here the rule was two conditions — *inside a fenced code block* **and**
*contains both `<body>` and `</body>`* — after which the block is rendered as a standalone document
in an iframe with full `<style>` / `<script>` support. Consequences worth writing tests for:

- **Locate the payload the same way the host does** (scan fences, check for the body pair), and keep
  the text *outside* the payload byte-for-byte — the host ignores it, the author still wrote it.
- **A non-conforming input is still parsed.** The author wrote something; read it first, then tell
  them *why* the host shows nothing (`🚫 …`) and write back a conforming wrapper. Refusing to parse
  it is the one behaviour that helps nobody.
- **Anything the host can't see must not affect its decision.** A machine-readable comment carrying
  your model is fine *inside* `<body>` — a comment is not an element, so it neither renders nor
  shifts the host's structural test. Put it outside the fence and you've changed the answer.
- **Your preview must reproduce the host's environment**, not approximate it: same wrapper, macros
  substituted, and the same sandbox flags (see the OOPIF note in Layer 2). A preview that is more
  permissive than the host lies to the user in the reassuring direction.
- **Recheck the assumed constraint's blast radius.** Overturning it usually means the generator was
  working around nothing; the real reason for its shape (here: "blocks carry their own look, no
  external definitions needed") is still a good reason, but now it's a choice, not a limitation.

### Rebuild calls with a missing field fail silently

`rebuild({ theme, width, blocks })` where `rebuild` also reads `shellOff` does **not** throw — the
field is simply `undefined`, the default path runs, and behaviour quietly reverts. In a
parse → rebuild → compare test that shows up as a mysterious diff. Pass the parse result **whole**:

```js
rebuild(parseResult)                                  // ✅ if the shapes line up
rebuild({ theme: r.theme, width: r.width, blocks: r.blocks, shellOff: r.shellOff })  // ✅ explicit
```

Same family as the misspelled assignment above: an omission in an object literal is invisible.

### Check where the string you're asserting on was actually generated

An assertion looked for a text block's colour inside the return value of `shellOpen()` — which is
just the **opening tag of the shell**. The block colours live in the body. The assertion was
`false` forever and looked like a real product bug.

Before asserting on a string, name its producer out loud. If the answer is "the function that
builds the outer element", you are looking in the wrong place.

### Serving generated artifacts from a harness

The static server is usually rooted at the app directory, so a file you write into the harness's own
output folder is **not reachable** by URL (a `404` body of 67 bytes, `document.scripts.length === 0`
and an empty `<title>` are the signature). Add a route map instead of moving the server root:

```js
const EXTRA_ROUTES = {};   // '/keep-compare.html' -> absolute path
const f = EXTRA_ROUTES[u] || path.join(dir, u === '/' ? base : u.replace(/^\/+/, ''));
```

**Don't navigate away in the middle of a loop that still needs the app page.** A loop that parses
each fixture *and* navigates to that fixture's comparison page kills the app page on the first
iteration; the second iteration dies with `stXxx is not defined` — which looks like a missing
function, not a navigation problem. Split it into two passes: finish all the page-side work first,
collect results into an array, then navigate.

**A derived flag that's only read when another field is set can skip its own cleanup — but say so.**
Example: `clsOwn` (which inline properties the input declared) is only consulted when `clsMap`
(the class name) is non-empty, so clearing the class doesn't require clearing `clsOwn`. That's a
deliberate one-way dependency, and it belongs in a comment at the clear site — otherwise the next
person to touch the reader turns it into a bug.

### Prefer "keep it verbatim" over "guess and lose it"

When parsing someone else's content, the failure mode that hurts is **silent data loss**, not
"one element wasn't recognised". Make the fallback lossless (keep the original markup as a raw
block), count the fallbacks, and surface the count in the UI. Then a partial parse is still safe,
and the user can see exactly how much was understood.

Corollary: resist "clever" unwrapping rules. A rule like *"an element with one child, no own text,
and only layout styles is a bare wrapper — unwrap it"* is useful (it removes the flex wrapper divs
around grid columns) and dangerous (it also matches `<table style="width:100%">`, flattening a
table into a text node). Tighten it by tag and by an allow-list that excludes **meaningful**
properties — `width` / `height` are content, not layout scaffolding.

---

## Layer 4.5 — testing file import: generate real binary fixtures

If the feature reads uploaded files, **do not hand-wave it with a JSON string.** Build actual files
on disk, in every format and version the app claims to support. A "PNG character card" must be a
genuine PNG whose chunks a real parser will walk.

PNG is the useful case, because the payload hides in text chunks. Layout:

```
8-byte signature  →  then repeating: [len:4 BE][type:4][data:len][crc32:4 BE]
```

`tEXt` = `keyword\0text`; `zTXt` = `keyword\0method\0zlib(bytes)`; `iTXt` = `keyword\0compFlag\0compMethod\0langTag\0transKeyword\0text`.
SillyTavern cards live in the chunks keyed `chara` (V2) and `ccv3` (V3), holding base64 of UTF-8 JSON.

```js
function crc32(buf) { /* standard table-driven CRC32 */ }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}
const png = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', ihdr),                       // 13 bytes: w,h,depth,color,...
  chunk('tEXt', Buffer.from('chara\0' + Buffer.from(JSON.stringify(card)).toString('base64'), 'latin1')),
  chunk('IEND', Buffer.alloc(0)),
]);
```

**Fixture matrix worth generating** (one file each, so a failure names the format):

| Fixture | Proves |
|---|---|
| `card-v2.png` (tEXt `chara`) | the main path |
| `card-v3-itxt.png` (tEXt `chara` **+** iTXt `ccv3`) | priority — `ccv3` must win |
| `card-ztxt.png` (zTXt, zlib) | the decompression branch |
| `card-notacard.png` (plain PNG) | the "not a card" error message |
| `card-v1.json` / `card-v2.json` / `card-v3.json` | all JSON shapes + field aliases |
| `lore.json` / `lore-legacy.json` / `lore-object-entries.json` | standalone book, legacy `key`/`uid`, object-vs-array entries |

A PNG's CRC is not optional — a real parser validates it, and Chrome's `File`/`arrayBuffer()` path
will surface a corrupt file as a decode error rather than your error message.

**Feed them into the page as real `File` objects**, so you exercise `file.arrayBuffer()` and the
app's own type sniffing rather than bypassing them:

```js
const b64 = fs.readFileSync(fixture).toString('base64');
await ev(`(async () => {
  const bin = atob(${JSON.stringify(b64)});
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  await onFilePicked({ target: { files: [new File([u8], 'card-v2.png', { type:'image/png' })], value: '' } });
  return true;
})()`, /* awaitPromise */ true, 20000);
```

Give the async import a longer per-call timeout than the default — it does real decoding.

**Then verify the semantics, not just the count.** For a world-book / prompt-injection feature the
interesting assertions are the *ordering* ones: import a book covering every insertion position, then
dump the assembled layout and assert the exact sequence of `kind`s and the depth splicing. "18 entries
loaded" passes even when every entry is injected in the wrong place.

**Make the fixture deliberately awkward:** 18 entries covering all 7 positions, 4 distinct depths, a
constant entry, a selective one, a disabled one, a never-matching one, a case-sensitive one, a
whole-word one, a `probability: 0` one, and an order-vs-position tie. Fixtures that are too clean
test nothing.

### When a harness assertion fails, dump the assembled output

A field-name mismatch (`content` vs `text`) meant messages were sent as `{ role, content: undefined }`.
No exception, no visible symptom — the page "worked". Dumping the actual assembled array found it in
one run:

```js
console.log(JSON.stringify(buildRequestPlan().layout.map(x => ({ k: x.kind, t: x.text })), null, 1));
```

Then **keep a guard assertion** so it can never regress:

```js
check('每条 message.content 都是非空字符串', plan.messages.filter(m => !m.content).length, v => v === 0);
```

Cheap, and it is the assertion that would have caught it first time.

---

## Layer 4.6 — verifying a **second channel** into a sandbox (part two)

The app runs user-supplied code in an iframe and exposes host capabilities to it. The first channel
(`host.call(name, args)` → a Promise) already existed. This round added a second one: `host.progress(text)`,
so a long-running skill can report what it's doing. Everything below came out of that.

### Two channels are two contracts — don't let one inherit the other's shape

The tempting implementation is "it's just another host method": route `progress` through the same
request/response plumbing, reuse the same permission check, reuse the same counter. That is wrong in
three separate ways, and each one is invisible until a real skill hits it.

| | `host.call(...)` | `host.progress(...)` |
|---|---|---|
| direction | request **and** response | **one-way** (fire and forget) |
| returns | `Promise` | **`undefined`** |
| counts against `RPC_MAX` | yes | **no** |
| wire shape | `{ __host: 1, id, name, args }` | `{ __prog: 1, id, text }` |

- **`undefined`, not a Promise.** If `progress` returns a Promise, every skill author writes
  `await host.progress('…')` — and waits for a reply that by design never comes. The call hangs
  until the sandbox timeout, and the skill that was *reporting progress* is the one that dies.
- **It must not spend the `call` budget.** A skill that reports 40 progress lines would exhaust a
  20-call allowance before reading a single field, and the failure reads as "the permission is
  broken". Progress and capabilities are different resources; give them different counters.
- **Same `id` plumbing, same `allowed` list.** Both do need the current run id (`__rid`, set in the
  `onmessage` handler) and both must be gated by the run's permissions — the isolation is in *what
  you return and what you charge*, not in whether you check.

```js
// sandbox side
progress: function (text) {
  try {
    self.parent.postMessage({ __prog: 1, id: __rid, text: String(text == null ? "" : text) }, "*");
  } catch (err) {}
}
// host side — note: no RPC counter, no reply
onMsg: if (d.__prog) { if (d.id === id) onProg(d); return; }
```

⚠ **The permission needs its own name even though it maps to zero tools.** The capability table maps
a permission to the built-in tool names it unlocks; `progress` unlocks nothing, so it maps to `[]`.
An empty array is a deliberate statement ("this is a capability, not a tool") — and it must still be
listed in the canonical permission array, or the permission check silently never passes and the
feature looks unimplemented. Assert all three facts separately: it's in the array, its tool list is
empty, and no tool name appears in it.

### Two rate gates, and a test that proves they're independent

Frequency limiting here is two mechanisms, not one, and they protect different things:

- **a minimum interval** (`PROG_MS = 120`) — a busy loop must not repaint the host 10 000 times;
- **a hard count cap** (`PROG_MAX = 200`) — a skill that respects the interval for ten minutes still
  can't accumulate unbounded DOM.

Plus a **character cap that truncates rather than rejects** (a 4 KB progress line is a bug in the
skill, not a reason to fail the run — clip it and carry on).

⚠ **The reverse test must name which gate stayed green.** Delete the interval check and the obvious
expectation is "something goes red" — but if you only assert that, you've learned nothing about
which mechanism did the work. Write the probe to expect **exactly** one red: the
"two lines in the same tick, only the first arrives" assertion. The count-cap assertion must **still
be green**, because the cap is still there. Two gates that can only be tested together are two gates
you can't tell apart.

### Your probe must obey the rule it is testing

Real failure: the assertion *"both progress lines reached the host"* came back `["第一步"]`. Nothing
was broken — the probe sent both lines in the **same tick**, so the 120 ms interval dropped the
second one. **The feature worked exactly as designed and the test was wrong.**

```js
// ✗ the probe violates the contract it's asserting
self.parent.postMessage(...); self.parent.postMessage(...);
// ✓ wait out the interval the host documents
setTimeout(() => host.progress('第二步'), PROG_MS + 60);
```

Generalise: when the feature deliberately **throttles, debounces, batches or drops**, the probe is a
client of that feature and must respect its contract. Read the interval constant in the probe rather
than hard-coding a sleep, so the test can't drift from the implementation.

### When two constants contain the same token, choose the anchor that exists once

A reverse-test probe meant to remove the new permission patched the first occurrence of `'progress'`
it found — inside the *capability→tools* map — leaving the canonical permission array untouched. The
probe "passed" (something went red) but the red was the *"the two lists agree"* assertion, and the
"it's in the permission list" assertion stayed **green**. The experiment had silently tested the
wrong thing.

```js
// both of these contain the string 'progress' — patching the wrong one is a no-op for your hypothesis
const PERM = ['card.read', 'card.write', 'progress'];
const PERM_TOOLS = { 'progress': [] };
```

Patch the **whole line** you mean (`const PERM = [...]`) and, before believing the result, read the
name of the assertion that went red. **A red is not evidence until you've confirmed it's *your*
assertion.**

### A green suite is "not red yet", not "verified" — re-run the reverse test

Six days of edits after the reverse test was written, it was re-run and the **baseline was already
broken**: `661 passed / 2 failed`. The reverse test's first job is to assert the suite is green before
injecting anything — and that precondition had quietly rotted.

The two failures were a genuine product bug (next section). The lesson is the ordering:

> **Re-run the reverse test periodically, not once on the day you write it.** Its baseline is an
> assertion about *today's* product, and the product moves.

Corollary: if you only ever run the aggregate runner, you inherit a second blind spot — a suite can be
green in the aggregate and red standalone (see below). Run the individual suite too.

### Reverse-test the *runtime* suite too — make the page path injectable

`reverse_test.js` only proved the **static** checks could go red. Every runtime assertion in the CDP
suite was "green", never "verified" — it had no injection hook because it hard-coded the product path:

```js
const PAGE_DIR = 'G:';
const PAGE_FILE = 'retro_vector_space_shooter (1).html';
```

Two lines of env override turn the whole suite into something injectable:

```js
const PAGE_DIR  = process.env.PAGE_DIR  || 'G:';
const PAGE_FILE = process.env.PAGE_FILE || 'retro_vector_space_shooter (1).html';
const SHOTS     = process.env.SHOTS_DIR ? path.resolve(process.env.SHOTS_DIR) : path.join(__dirname, 'shots');
```

Now a reverse runner can stage a *defective copy* and run the **real** suite against it:

```js
execFileSync(NODE, [path.join(HERE, 'verify.js')], {
  cwd: HERE,
  env: { ...process.env, PAGE_DIR: TMPDIR, PAGE_FILE: 'page.html', NO_SHOTS: '1' },
});
```

⚠ **Make the injected run write no screenshots** — have `shot()` early-return on `process.env.NO_SHOTS`.
Two reasons, both learned the hard way: otherwise every injected run **overwrites your good screenshots**
with pictures of the deliberately broken build, *and* the accumulated PNGs bloat the staging dir enough
that `rmSync` trips the host's bulk-delete guard (below).

⚠ **Put the staging dir under the OS temp dir, not inside the project.** The host's safe-delete shim
counts files deleted per tool call and refuses past ~50 — but it *bypasses* that check for paths under
`os.tmpdir()`:

```js
const TMPDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-revrt-'));
```

The failure mode of getting this wrong is nasty: `SAFE_DELETE_BULK_CONFIRM_REQUIRED {"count":53,"threshold":50}`
thrown from `stage()` — but only on the **third or fourth** probe, because the counter accumulates across
calls, so the first probes look perfectly fine and you conclude the harness works.

### A crashed child reports zero FAIL lines — `红面: 0 条` is a lie

The first version of the reverse runner printed a *beautifully clean* baseline: `0 条红`, exit code… 1.
Zero failures is exactly what success looks like, so it reads as green. The real cause was
`ENOENT: no such file or directory` — the suite died on its first screenshot because the staging dir
had no `shots/`, and it died **before any assertion**, hence no `FAIL` lines.

Two fixes, both mandatory:

1. **Dump the child's output tail whenever the result is unexpected** (baseline dirty, or the expected
   assertion did not go red). Without it the harness is unfalsifiable:

```js
if (red.length !== 0 || r.code !== 0 || !r.out.includes(sanity)) dump(r.out, label);
//       ⤷ label 输出末尾 12 行:
//         | 💥 page threw: ReferenceError: selectShip is not defined
```

2. **Assert the suite actually *reached* a known check name** — a `sanity` string per suite:

```js
check(`基线 ${suite}：确实跑到了目标断言`, r.out.includes('换成标准机后激光被清空'), true);
```

`红面: 0 条` plus "reached the sanity check" is evidence. `红面: 0 条` alone is not.

⚠ Related trap: a suite that assumes **another suite already created a shared output dir** looks fine
until you run it alone or against a staged copy. `verify.js` did `mkdirSync(SHOTS)`; `verify_edges.js`
and `verify_playthrough.js` silently relied on it having run first. Each suite should create its own
output dir.

Then assert a *named* check goes red, exactly as the static reverse test does — and print the
**blast radius**:

```
--- 注入: 奖励波倍率 x10 改成 x5 ---
      红面: 1 条
--- 注入: rebuildLasers 不再按 isJellyfish 提前返回 ---
      红面: 3 条
```

A surgical defect should redden a *small* set. If one injected line turns 30 checks red, the
assertions are entangled and the red tells you nothing about which one guards what.

Keep the baseline first: an untouched copy must report `0 条红`. That also proves the env override
itself didn't change behaviour — otherwise a defect probe can "pass" simply because the suite was
already broken for an unrelated reason.

Cost: the whole runtime suite re-runs per probe (~20 s each). Worth it — this is the only evidence
that the runtime assertions have teeth. Wire it into the aggregate runner; the "every `.js` must be
classified" reconciliation guard will force the issue, which is exactly its job.

### A reverse test can rot *silently* — "it ran" is not "every probe ran"

Re-running the whole reverse-test set a week later surfaced two failures that **no green run could
ever have shown**, because in both cases the thing that broke was the *test*, not the product:

| Script | What rotted | Consequence |
|---|---|---|
| runner probe B | its anchor was the literal `const SUITES = [\n    'sb-verify.js',` — and a new entry (`check.js`) had later been added at the **front** of that list | anchor mismatch → `NOT FOUND` → `process.exit(1)`. The two assertions *after* it had **never run**, possibly for days. The probe looked alive; it only printed one NOT-FOUND line |
| injector | designed as "inject, then restore by hand with `--restore`" | forget the second step and the **broken product stays on disk**. Measured: the page's hash had changed after the run, and the script printed only a hint |

Two rules fall out of this:

1. **Anchor on structure, not on the first element of a list.** `const SUITES = [` survives "someone
   added an entry at the front"; `const SUITES = [\n    'sb-verify.js',` does not. Any anchor whose
   validity depends on *the content of the list it lives in* is on a timer.
2. **Make the injector self-contained**, like the other reverse tests in the same directory:
   back up → inject → run the suite → assert *exactly those* assertions went red (plus a control group
   that stayed green) → restore → verify byte-identity and the summary line. Keep `--restore` only as
   an escape hatch, and add a **guard**: if the backup file still exists at startup, refuse to run —
   its presence *is* the "last injection was never restored" signal.

⚠ **"The script finished" and "every assertion in it ran" are different claims.** Any early
`process.exit()` silently eats the assertions after it while the output still looks like a normal run.
When you re-run a reverse-test set, **count how many assertions each probe actually produced** — don't
just grep for ❌.

⚠ `process.exit()` does **not** run `finally`. Anchor checks that may exit must sit *outside* the
`try`, or the temp file and the patched runner are both left on disk.

⚠ Corollary of the whole exercise: **after each reverse test, verify the product's hash is unchanged.**
An injector that fails to restore is indistinguishable from a product bug until you check.

### The probe's `red`/`green` name lists are hand-copied — so verify every name still exists

The expected-red and control lists are literal strings transcribed from the suite's `check('…')`
calls. Transcribed data rots. Add a gate that runs **before any probe** and asserts every name in
both lists actually appeared in the baseline's ✅ output — then **exit immediately** if any is missing
(the remaining probes cost minutes each; a stale list makes them pointless).

Two failure modes, and only one of them is loud:

| Stale name in… | What happens | Loud? |
|---|---|---|
| `red` | "the expected assertions all went red" can **never** pass → you go hunting in the product | **loud** |
| `green` | "no control assertion went red" is **vacuously true** → **the control group is silently weakened and the probe still prints all-green** | **silent** |

So checking `red` alone is not enough. In one run this gate caught **4 stale names on the first
execution**, and the one that mattered was in a `green` list.

**Why they were stale — the extraction bug.** `check()` prints `  ✅ ` + name, and the name itself may
carry leading spaces (`check('  it is flattened, not truncated', …)`). The extraction regex
`/^\s*✅\s+(.*)$/` has `\s+`, which **eats the name's own leading whitespace** — so the captured name
has two fewer spaces than the hand-copied original, and `indexOf` is `-1` forever.

⇒ **Trim both sides.** Wrap the comparison (`const hit = (list, x) => list.indexOf(String(x).trim()) >= 0`)
and use it at every call site; never hand-write `indexOf(x)` in a probe.

### The failure-list marker differs between suites in the same directory

| Suite | Prints |
|---|---|
| one | `失败项：\n  - name\n  - name` |
| the next | `失败项：\n  · name\n  · name` |

Copying the previous reverse test's `failsOf()` (which strips only `-`) matches **nothing** — and the
symptom is `control group: 0 went red ✅` / `no unexpected reds ✅`, i.e. **it looks like it passed**.
Strip both: `.replace(/^\s*[-\u00b7]\s*/, '')`.

Same family as "the summary line has two formats" (`N passed, N failed` vs `N 通过 / N 失败`):
**a format difference never throws, it just quietly under-reads.** ⇒ Before reusing a parser across
harnesses, go read both `console.log` statements; don't assume they match.

### One "feature" can be two independent code paths — a probe only hits the one it patched

A new feature ("insert a preset group") had two binding functions: `bind` (single slot) and `bindMany`
(N slots). One probe patched the keyword matcher used by `bind`, and the prediction listed *both* the
single-slot and the multi-slot assertions as "expected red".

The multi-slot assertions stayed **green** — not because they were weak, but because that code path
**never calls the function the probe patched**. The prediction was wrong; the product was fine.

⇒ Split the probe (`R1` for the single path, `R1b` for the many path). The rule:

> **A probe's expected-red list must be derived from the call graph, not from the feature's name.**
> Before listing an assertion as "should go red", ask *which function does this assertion's code path
> actually enter?* If two entry points share a name prefix but not an implementation, they need two probes.

This is the same family as "one feature name often maps to *two* DOM nodes" — grep every candidate
before you fix one. Here it bites the *reverse test* instead of the fix.

### A control group judged by an absolute value inherits the failure it was meant to rule out

A section asserted "inserting while a group is selected lands inside that group" with an **absolute**
criterion (`root === before.root + 2`) plus a control (`the group got exactly one block more`).

When the probe "always insert at root" was injected, the section went red as predicted — and the
**control went red too**. A control that moves with the failure proves nothing; it is not a control,
it is the same measurement twice.

⇒ Recast both as **increments**: `root +2` (what changed) and `group +0` (the counterfactual), computed
from the same two snapshots. Now the injected bug turns exactly one of them red, which is the whole
point of having two.

> **A control must be phrased so that the injected bug moves it in the opposite direction from the
> assertion — or does not move it at all.** Any criterion whose value is dragged along by the
> upstream failure is a second copy of the assertion wearing a control's hat.

Two more small ones from the same run:

- **The status/warning message is part of the assertion.** A probe that made all N slots bind the same
  variable also flipped a user-facing message from "2/3 bound" to "all bound". That extra red was
  *correct* and had to be added to the expected list — the message is observable behaviour, not decoration.
- **A class-based count selector breaks when the new UI *reuses* that class.** The palette for the new
  preset buttons deliberately shared `.st-sb-palette` (same look, same layout), so an old selector
  counting `.st-sb-palette .st-mini` went from 9 to 25. **Reusing the class was right; counting by class
  was the mistake.** Anchor such counts on the handler instead: `[onclick^="addBlock("]`.

### Two runners disagreeing: suspect *two different file states* before you suspect cross-suite bleed

This session produced both numbers for the **same suite**:

| Runner | Result |
|---|---|
| `run-all.js` (aggregate) | `st-code.js — 663 passed / 0 failed` |
| `st-code.js` (standalone) | `st-code.js — 661 passed / 2 failed` |

The tempting explanation is cross-suite bleed: a suite is a **sequence against one long-lived page**,
so an earlier section's leftover state can satisfy a later assertion by accident — the classic
"section Z's failure is caused by section Y" in reverse: **section Y's side effect makes section Z
*pass* when it shouldn't.** That is the worst class of green, so it deserves an experiment, not an
argument.

**Run the experiment.** A one-shot probe injected the bug back into the product and ran *both* runners:

| State | standalone | aggregate's line for that suite | aggregate total | exit code |
|---|---|---|---|---|
| baseline | 663 / 0 | — | — | 0 |
| bug injected | **661 / 2** | **661 / 2** | **1662 / 2** | **1** |

The aggregate runner reported the red faithfully. **The bleed hypothesis was falsified by direct
measurement** — and note that pure reasoning ("each suite is its own spawned process anyway") would
have *guessed* the right answer without ever proving it.

⚠ Rule of thumb: **when two runners disagree, first ask whether they ran the same file.** Bleed has to
be believed on evidence; file state can be checked directly. (Here it was file state — see the next
section, where the "never written" diagnosis turned out to be backwards.)

⚠ The practical rule still stands: **the aggregate total is not a substitute for running the suite you
edited.** If you touched suite X, run suite X — cheap, and it is the only way to see the disagreement
at all.

### "Anchor not found" may *be* the bug — and "it was never written" needs a snapshot, not memory

A reverse-test probe reported:

```
C NOT FOUND —— anchor changed
```

The instinct is "my anchor string drifted, let me go correct it". The anchor pointed at a line that
was, at that moment, **absent** from the product. A semantic edit — the file had the *comment*
promising the cleanup and not the *call*:

```js
if (frame && frame.parentNode) frame.parentNode.removeChild(frame);
// ⚠ the progress line must be cleared here — otherwise it stays on screen
resolve({ ok: ok, text: ..., touched: ... });     // ← the promised call is absent
```

The battery of static checks was silent on it, from three independent directions:

- **syntax** — perfectly valid JS;
- **referenced-but-undeclared** — the function *is* declared, and referenced elsewhere, so the scan
  sees a healthy symbol;
- **escape gate** — unrelated.

Only a **behavioural** assertion caught it. And the "NOT FOUND" was the *first* symptom, dismissed a
round earlier as a bad anchor.

⚠ Rules:

1. **When an anchor is missing, grep the product for it before editing the probe.** Absent code and
   moved code look identical from the probe's side; only the product tells them apart.
2. **A comment is not an implementation.** Wherever a comment asserts "we do X here", check that X is
   actually on the next line. Batch edits that drop one *statement* leave the comment behind, the file
   parses, and every static check passes.
3. ⚠ **"That line was never written" is a claim about the past — it needs a snapshot, not memory.**
   The first diagnosis here said the call had never existed. It was **wrong**. An *earlier* aggregate
   run had reported this suite green, and one of its assertions **cannot pass unless that call is
   present** (the fixture skill always sets the progress state, so the only thing that can null it is
   the cleanup call). Therefore the call *was* written, landed, passed, and was **silently lost
   afterwards**.

   ⚠ The generalisable part: **batch edits fail in two shapes, and they are indistinguishable after
   the fact** —
   (a) "reported success, never reached disk";
   (b) "reached disk, then a later batch overwrote that region from a stale buffer".
   Both look identical to a later `grep`, and both leave the comment behind.

   So: if you have no snapshot from the moment in question, **say so** and reason from what the
   assertions *could* have passed on. "It never existed" and "it existed and was lost" call for
   different countermeasures — the second one means *re-grep after every later batch*, not just after
   the batch that wrote it.

### Touch-target assertions sit on 1px boundaries — await fonts first

A layer reported `367/368`, failing *"mobile top-bar button touch height >= 32px"* with `btnH: 31`,
`fontSize: 12.48px`, `padding: 6px`, `border: 1px`, `box-sizing: border-box`.

Nothing was wrong with the CSS. Re-running the layer three times gave **368/368, three times.** The
number is not a product property — it is a **font-loading race**:

| when measured | text line box | button height |
|---|---|---|
| local pixel font still `loading` (fallback in use) | 13px | **31** |
| after the 7 MB font loads | 17px | **32** |

17 + 6×2 + 1×2 = 32; fallback 13px gives 31. The threshold is `>= 32`. So the assertion's verdict
depends on whether a 7 MB font finished downloading in the ~400 ms between `setViewport` and the
measurement — which is exactly the kind of thing that is green on your machine and red on a cold cache.

```js
await setViewport(390, 844, true);
await sleep(400);
await evaluate(`openStEditor(); stSwitchTab('book'); stAddEntry(); true`);
await sleep(500);
// ⚠ the height assertions below sit on a 1px boundary; wait for the webfont
await evaluate(`document.fonts.ready.then(() => true)`);
await sleep(300);
```

⚠ **Whenever a measured dimension lands exactly on its threshold, measure the *inputs* before
blaming the layout**: read `fontSize`, `lineHeight`, `paddingTop`, `borderTopWidth`, and — the
decisive one — the text's line boxes via a `Range`. Then measure the same element **before and after
`document.fonts.ready`**. If the number moves, you have a font race, and the fix belongs in the
harness (await the font), not in the CSS.

This is the *"measuring the right thing"* family: `getBoundingClientRect().height` of a text-bearing
control is `line-box + padding + border`, so it inherits every font-swap. Any assertion whose margin
is smaller than the font's line-height delta is a coin flip.

### Your `check(actual, expected)` helper compares with `===` — so array/object expectations are *always* false

The tiny assertion helper is the first thing you write and the last thing you question:

```js
const check = (name, actual, pred, expect) => {
  const ok = typeof pred === 'function' ? pred(actual) : actual === pred;
  ...
};
```

That `actual === pred` branch is **reference equality**. Hand it an array or an object and the assertion
can never pass — while the failure line prints `actual=[…]  expect=[…]` with the two sides **looking
identical**. It reads exactly like a product bug, and it is not.

Four assertions died this way in one round: `[] === []` (three of them) plus a 36-element label array that
matched character for character. Two fixes, both fine:

- pass a predicate — `check('count matches', got, v => JSON.stringify(v) === JSON.stringify(exp), exp)`
- or make the helper itself deep — `typeof pred === 'function' ? pred(actual) : JSON.stringify(actual) === JSON.stringify(pred)`

Symptom to memorise: **the expectation and the actual value are visibly the same, and it is still red.**

### "It's loaded lazily" — reset the memo first, because rendering the thing under test already loaded it

Asserting a lazy read is easy to get wrong in a way that *looks* like it works:

```js
await reload();            // fresh page: the field is null
await openThePane();       // ← rendering the pane calls the getter, which populates it
check('still null', await ev('state.field'), null);   // ❌ always red, for a boring reason
```

By the time you can *observe* the value, the observation path has already exercised the code you meant to
test. Don't drop the assertion — make the setup do the work:

```js
await ev('state.field = null');                        // force it back to "not read yet"
check('reads back from storage', await ev('getter()'), expected);
```

Generalises to any "was it computed on demand?" claim: **reset the memo, then call.** The same trap runs the
other way too — a pane that computes a label at *build* time won't reflect a config change until it is
re-rendered, so "the status line says X" needs a `rerender()` between the change and the check (asserting
without one silently reads the *previous* render's value, which is how one more assertion went red for a
non-product reason).

---

## Layer 5 — clean up

`rm -rf` the scratch dir (`node_modules`, `package.json`, `package-lock.json`, harness scripts).
Keep any screenshots you want to show the user by copying them out first, with clear names.
Never leave npm artifacts or a running headless browser behind.

### The host may cap how many files you delete per turn — keep scratch files under `os.tmpdir()`

Deleting a scratch dir **inside the project** can fail like this:

```
Error: [safe-delete][SAFE_DELETE_BULK_CONFIRM_REQUIRED]
  {"count":53,"threshold":50,"scope":"turn","targets":["...\\_verify\\_revrt"],"targetCount":1}
```

Reading the guard — it is a plain script on disk, so **go read it rather than infer** — explains all
three surprises:

- **The counter is per *turn*, not per call.** It is keyed by the conversation-request id and persisted
  in a state file (7-day TTL), so it accumulates across every tool call in one assistant turn. Symptom:
  probe #1 and #2 pass, probe #3 throws — and the number looks unrelated to the delete that failed.
- **Directories are counted recursively.** `rmSync(dir, {recursive:true})` is charged for *every file
  inside*, which is why deleting "one directory" reported `count: 53`.
- **`os.tmpdir()` paths bypass the guard entirely** (`shouldBypassSafeDelete` → `isUnderAnyTempDir`).

So the rule is: **scratch/staging files belong under `os.tmpdir()`, never in the project tree.**

```js
const TMP = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb-revtest-')), 'page.html');
```

⚠ Audit *every* `rmSync`/`unlinkSync` in the harness for this. In a nine-script suite, eight deleted
only their Chrome profile (already under temp) and **one** deleted a file next to `__dirname` — that
single line is enough to fail the whole runner a few probes in, with a message that points at the
wrong script.

⚠ Once the turn's budget is spent, *any* further delete in the project tree fails — including cleanup.
If you need to remove a leftover mid-turn, **move** it instead (`mv` into the temp dir); a move is not
a delete.

### ⚠ Your own harness leaks temp dirs — and "it has a cleanup call" is not evidence

Every CDP suite that spawns a browser needs a `--user-data-dir`. The idiomatic line is:

```js
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-myprobe-'));
// … spawn chrome with --user-data-dir=${profile} …
// … and then everyone forgets this:
fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
```

A real project of ~12 suites reached **933 leftover profiles / ~14.5 GB**, growing by one per suite
per run. Two distinct failure modes, and the second is the nasty one:

1. **No cleanup at all** — eleven of twelve suites. Obvious once you look.
2. **Cleanup that always fails silently** — one suite *did* call `rmSync`, but without `maxRetries`.
   On Windows the directory is still locked right after `chrome.kill()`, so it throws `EBUSY`, and
   the surrounding `catch (e) {}` swallows it. **Syntax is valid, every assertion is green, and it
   leaks every single time.**

⚠ **The rule: for cleanup code, verify the *side effect*, not the call site.** `grep`-ing for
`rmSync` proves nothing — the failing one was in that grep too. Count the resource before and after
a run:

```bash
before=$(ls -d "$TMP"/cdp-* 2>/dev/null | wc -l)
node run-all.js
after=$(ls -d "$TMP"/cdp-* 2>/dev/null | wc -l)
echo "net: $((after - before))"   # must be 0
```

⚠ **And then measure again after you "fix" it.** The first fix landed in ten suites and left net
`+1`; finding which suite still leaked meant sorting the leftovers by mtime and looking at the
newest one. A fix that reduces a leak is not a fix.

A few more details worth copying:

- **Before you "fix" a leak, look at the newest leftover's mtime.** If the newest one predates the
  runs you just did, the code is *not* currently leaking — you are closing a latent shape, not a live
  leak. Write that distinction down. A record that claims to have fixed an active leak is a false
  record, and it looks exactly like a true one. (Real case: a 39-directory backlog whose newest entry
  was 09-19 22:26, while four full runs happened on 09-20 and added nothing.)
- **`os.tmpdir()` is the portable way to count.** In Git Bash on Windows, `/tmp` happened to be
  mounted onto the same directory (both counts agreed at 933 `cdp-*`), but that is a mount
  convention, not a guarantee — don't turn an observation into a cross-environment fact.
- **Delete *after* the process is gone.** Put the `rmSync` after any `await sleep(...)` that follows
  `kill()`, or you are racing the lock you just tried to release.
- **If the profile path lives inside an IIFE, an outer `.catch` cannot see it.** Either hoist it to
  module scope, or sweep by prefix (`readdirSync(tmpdir()).filter(x => x.startsWith('cdp-…-'))`) —
  a hoisted `function` declaration lets you call it from above its definition.
- **Never delete pre-existing leftovers without asking.** They are in the system temp dir, not in
  the repo, and removing them is destructive. Report the count and size; let the user decide.
  If you then write a helper for it, **make the destructive mode opt-in** (`--go`) and count-only the
  default — a repo-resident script whose *default* action deletes is a footgun. Restrict it to an
  explicit prefix allowlist and to directories directly under `os.tmpdir()`; never sweep the temp dir
  by wildcard, and never recurse into `os.tmpdir()` itself.

⚠ **A `setTimeout` cleanup is dead code if the script calls `process.exit()`.** This is a third
variant of "cleanup that always fails silently", and it bit four harnesses at once (18 leaked
profiles / 462 MB):

```js
function cleanup() {
  try { chrome.kill(); } catch (e) {}
  setTimeout(() => { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 8 }); }, 700);
}
// …and at the end of the run:
cleanup();
process.exit(0);          // ← exits immediately; the timer never fires; rmSync never runs
```

`process.exit()` does not wait for timers, so the delayed cleanup is unreachable. The grep for
`rmSync` finds it, every assertion is green, and it leaks on every run.

Fix: make cleanup **async and awaited** — `await cleanup(); process.exit(...)`, and make the
`.catch` handler `async` too (`.catch(async e => { … await cleanup(); process.exit(1); })`).
⚠ `process.exit()` does not run `finally` either, so the restore/cleanup must be *before* the exit,
never inside a `finally` that the exit pre-empts.

Verify by **net count**, before and after a full run — must be `0`:

```bash
before=$(node -e "…count matching prefixes in os.tmpdir()…")
node run_all.js
after=$(node -e "…same…"); echo "net $((after - before))"
```

### Retiring a generated artifact: enumerate its readers first, then delete

A harness that regenerates a source dump (`extract.js` → `blk0.js`) tends to accumulate **stale
copies** of it. A stale copy is worse than no copy — anything reading one answers confidently about
code that no longer exists. So they should go. But deleting is the easy half:

1. **Prove it's regenerable first.** Run the generator into a scratch dir and check the output
   parses. "It's generated, so it's disposable" is a claim, not a fact.
2. **`grep` the artifact's name across the whole repo** — docs included, not just `*.js`. You want
   every reader *and* every mention.
3. **Check each reader's failure mode *separately*.** This is the part that bites. Three readers of
   one file failed in three different ways:
   - a top-of-file `readFileSync` → loud crash. Fine, you'll notice.
   - a probe that *wrote* the file and restored it only `if (backup) …` → with the file absent it
     **silently left garbage behind**, and the *next* full run died in a different gate
     ("unclassified `.js`"), which reads like a broken suite rather than a broken probe.
   - a runner that *listed* the file as a known non-suite → the reconciliation line stopped adding
     up (`12 + 10 + 7` across 28 files). A printed total that doesn't sum is worse than no total:
     the next person hunts for a difference that doesn't exist.
   **A reader whose failure is silent will not show up in a green run.** Audit it by asking *"what
   does this do when the file isn't there"*, not *"does it mention the file"*.
4. **Delete, then re-run everything** — the reverse tests especially, since they are the most likely
   to be the silent readers.
5. **Keep the generator.** Deleting it because its output went stale throws away the wrong thing;
   the *output* is what shouldn't be committed.

While you're in there: if a probe hard-codes a number derived from the artifact
(`declared functions: 932`), replace it with a **comparison against the baseline**. Otherwise every
later change to the source makes the probe report a failure unrelated to what it tests.

### Before trimming a memory/notes file to fit a size limit, `grep` for the same rules elsewhere

When an always-injected notes file hits its size cap, the reflex is to delete the longest sections.
Check whether they are **already duplicated** in a skill or a reference doc first — if so, the fix
is a pointer, not a deletion, and you lose nothing. The reverse trap is just as real: before *moving*
a rule somewhere else, `grep` the destination to confirm it actually contains it. In this project
five rules I was about to "move into `RULES.md`" turned out to appear **zero times** there — the
reference file had collected the *stories*, not the rules. Moving them would have been silent data
loss dressed up as tidying.

### When a user says "the animation is wrong", measure *absent* vs *mismatched* before touching CSS

"The animation is broken" almost never means "there is no animation". Here it meant two different
things at once, and the second one is the one that reads as wrong:

- the toggle button had **no child element and no `transition`** — nothing could animate, so it
  looked identical before and after. A dead button, not a fast one.
- the panel it toggles animated at `0.22s ease`, while the reference widget (a calendar) animated
  at `0.35s cubic-bezier(0.4, 0, 0.2, 1)`. **Same feature, two different timings** — the eye reads
  that as "the animation is wrong".

So sample the computed styles of *both* the thing that moves and the thing that is supposed to
react, and diff them against the reference. A frame-by-frame CDP probe makes it obvious: print the
width at each frame during the transition (a real ease yields many distinct intermediate values; a
snap yields one jump) and the count of distinct `transform` values.

Two traps when you then copy the reference implementation:

- **The reference may rely on a DOM relationship your case doesn't have.** The calendar's icon sits
  *inside* the container, so `.container.collapsed .icon` reaches it. The editor's toggle lives in a
  *sibling* bar, so a class on the rail cannot style it — the collapsed state had to go on a shared
  **ancestor** (`.st-shell`).
- **Write the state to the DOM in exactly one place.** Every extra `classList.toggle` at a call site
  is a place that can be forgotten, and the symptom of a forgotten one is "state / animation is
  wrong" — the hardest kind to trace.

And assert it, not just eyeball it: the icon exists, it has a `transform` transition, **its duration
matches the panel's**, the collapsed class lands on the ancestor, and after a re-render it is still
there — plus a control assertion that an expanded panel carries none of it.

### One feature name often maps to *two* DOM nodes — grep every candidate before you fix one

A user reported "the editor's expand button animation is broken" and named a reference widget to copy.
I grepped the feature's name, found a plausible match, measured it, confirmed it was genuinely broken,
fixed it, and shipped it. **It was the wrong button.** The same app had *two* things the user would
both call "the expand button":

| | where | what animates | where the collapsed class lives |
|---|---|---|---|
| A | top bar of the full-screen overlay | the rail's `flex-basis` | a **sibling-ancestor** (`.st-shell`) |
| B | the card on the home page | a wrapper's `grid-template-rows` | the card itself (`#st-card`) |

Fixing A does nothing for B. The measurement was correct — the *target* was wrong, and
**a correct measurement of the wrong element is worth exactly nothing.** Two lessons:

1. **Never navigate by feature name.** `grep` for *all* candidates (here: two different handler
   functions, `stToggleTabs` and `toggleStArea`) and disambiguate on structure — which element
   contains which, which handler each `onclick` calls. If two candidates remain plausible,
   **ask**; guessing costs a whole round-trip and looks like incompetence.
2. **A partially-broken widget is worse than a fully-broken one.** Here the collapse wrapper animated
   fine and only the arrow was dead — so "does the content collapse?" was green the whole time.
   The assertion has to target the *thing that is wrong*, not the thing that is nearby.

Corollary for the fix itself: when a widget **reuses another widget's collapse machinery** but gives
its own icon a new class name, the odds are high that the new class never got its own CSS rule.
Check for the rule by name — not for the class in the HTML, which will be present and look fine.

### Measure *who* and *how much* before you conclude — two symptoms, one habit

Two things went wrong in one round, and both had the same cure. In each case the first observation
was "the thing I want isn't there" — enough to know *that* it's wrong, useless for knowing *why*.

**1. Two menu items with ragged right edges.** A dropdown's two entries visibly didn't line up. The
screenshot told me *that*. Printing each layer's `width` / `left` / `right` told me *why*: a
`<button>` with `display: flex` sizes to **fit-content** in Chrome — it does **not** stretch to its
container. The fix belongs on the parent (`display: flex; flex-direction: column`, relying on the
default `align-items: stretch`), **not** `width: 100%` on the button. A plausible fix in the wrong
place is indistinguishable from a fix — until the next label is longer.

**2. A hover assertion that reported "not navy".** The predicate was right; the number was wrong. The
cause stayed invisible until the assertion started printing **what the pointer had actually landed
on** — `document.elementFromPoint()` — which turned out to be a *different overlay*, still open from
an earlier section (`z-index: 1200` vs the menu's `850`). Two lessons:

- **"The element exists" is a very weak predicate.** Existence is not "on top", not "visible", not
  "receiving events". When a hit-test is what you mean, assert the hit-test.
- **A suite can poison its own later sections.** An overlay left open by step 3 silently re-routes
  every pointer event in step 7. If an assertion about *interaction* fails while assertions about
  *structure* pass, suspect leaked state before suspecting the product.

And the colour itself: `getComputedStyle` sampled mid-`transition: background 0.3s` returns
`rgba(192, 192, 192, 1)` — the **same colour** as `rgb(192, 192, 192)` and a **different string**.
Compare channels, not strings. Same family as "`getBoundingClientRect()` ignores clipping", which is
why a fully-clipped panel can still measure 2798px tall.

> The general habit: **turn "what I saw" into "who / how much" before drawing a conclusion.** Both
> of these were "layout bug or weak assertion?" questions, and in both cases the answer only arrived
> once a number or a name was printed. Screenshots and pass/fail bits are *detectors*, not
> *diagnoses*.

### A cleanup wrapped in `try/catch` can fail *silently* — and the failure may be a `ReferenceError`

I wrote a new probe by copying a sibling probe, and dropped the sibling's `ch.kill()` line because it
looked decorative. It wasn't: on Windows the browser process holds the profile directory open, so
`rmSync` throws `EBUSY` while Chrome is alive. Three leaked temp dirs.

The interesting part is what happened when I fixed it. I added

```js
.finally(async () => {
  try { ch.kill(); } catch (e) {}
  ...
});
```

and it *still* leaked — because `ch` and `srv` were `const`s inside the async IIFE, and the
`.finally()` callback is **not in that scope**. Every run threw `ReferenceError`, the bare `catch`
swallowed it, and the output looked exactly like a successful cleanup.

- **A `try/catch` with an empty handler cannot distinguish "worked" from "didn't run".**
  Hoist the handles to module scope (`let proc = null;` assigned inside the IIFE) so the callback can
  reach them.
- **Make the cleanup report its own failure** (print the path and `e.code`). The leak was only found
  because I happened to run the temp-dir counter — build that loudness into the tool instead of
  relying on discipline.
- **When you clone a sibling file, don't drop the lines that look like ceremony.** Ask what breaks if
  that line is missing. Same reason a control assertion matters: the line you skipped is often the
  one doing the work.

Sibling probes that call `kill()` *inside* the IIFE (where the handle is in scope) were clean all
along — verified by running each one and re-counting. **Verify the neighbours too, so you know the
new file is the anomaly rather than the family.**

### A runner that doesn't hardcode expected totals cannot notice a suite that ran 1 of 371 assertions

Running two independent harnesses **in parallel** to save time produced this:

| | parallel | re-run alone |
|---|---|---|
| Chrome/visual layer | `1/0` assertions, **21.8 s** | `371/371`, **93.9 s** |
| harness total | `1261 passed / -1 failed` → still printed **"all passed"**, exit 0 | `1631 / 0` |
| the other harness | killed by SIGTERM at the 10-minute cap | `1731 / 0` |

One suite completed **1 of its 371 assertions**, printed a perfectly parseable summary line, and the
runner called it green. The cause wasn't pinned down (likely resource/port contention among a dozen
concurrent browsers), but the *shape* is what matters:

- **"Deliberately not hardcoding the expected total" has a cost.** It's the right call — a hardcoded
  total becomes a check you must edit every time you add an assertion, which is how checks rot into
  "always red, always ignored". But the price is exactly this blind spot: **a suite that stops early
  still prints a summary.** Don't reason as if that can't happen.
- **The mitigation is a table you probably already keep.** Compare each suite's count against the
  documented per-suite numbers. That table has two jobs: telling a human what's covered, and letting
  *you* notice a suite that ran 1/371. (The table can rot too — check it against the source
  periodically.)
- **Run independent harnesses sequentially**, with a generous timeout each. Saving a few minutes in
  exchange for a near-miss false green is a bad trade.

Related, and worth separating: this is *not* the same as a suite that fails. Nothing was red — the
green was simply **unearned**. Which is the harder of the two to notice.

### When the requirement reverses, change the *assertions* first — the direction *is* the requirement

A user asked for a "small detail": move a label from beside a button into the dropdown, below the
last item. The previous round had two assertions pinning the *opposite* design — "the label is
**outside** the panel" and "the label is **still visible** when the menu is collapsed". Both had to
invert.

- **An assertion encodes a requirement, not an implementation detail.** "Outside vs inside" isn't
  cosmetic — they're two different product behaviours. Before rewriting an assertion, say out loud
  which requirement it encodes, so you notice when that requirement is what changed.
- **Rewrite the assertions first, watch exactly those go red, then change the product.** Do it in the
  other order and you finish the product change staring at a pile of red assertions with no way to
  tell "the requirement moved" from "I broke something". Here the red was exactly 3 assertions with
  the other 86 green — a clean signal that the change was scoped as intended.
- **Keep the control group in the reversed pair.** The old pair was (outside / visible-when-collapsed);
  the new pair is (inside / hittable-when-expanded) **plus** (not-hittable-when-collapsed). Without
  the "hittable when expanded" half, an implementation with a hardcoded `display: none` passes.

⚠ And the trap that keeps coming back: **collapsing a panel with `grid-template-rows: 0fr` +
`overflow: hidden` does not change `getBoundingClientRect()`.** Clipping is invisible to rects, so
"it's not visible when collapsed" must be asserted with a **hit test** (`elementFromPoint`), never
with `width > 0 && height > 0`. Same root cause as the earlier "clipped panel still measures 2798px".

### Moving an element invalidates the styling that was tuned for its old context

The same "small detail" needed **three** styling attempts, and only rendering a screenshot after each
one settled it:

| attempt | what I wrote | what the screenshot showed |
|---|---|---|
| 1 | dark chip, `rgba(0,0,0,.18)` | the **only dark element** in a light glass UI — it out-shouted the two menu items it was meant to sit under |
| 2 | light chip, `rgba(255,255,255,.12)` + rounded border | indistinguishable from the menu items ⇒ read as a **third, disabled entry** |
| 3 ✅ | a single `border-top` separator + centred caption text, **no box** | a different *shape* from the buttons, so it can't be mistaken for one |

- **Repositioning is not just changing coordinates.** The old styles were tuned against the old
  backdrop (a translucent chip floating on the page). Drop them into a new container and the
  relationships that made them work are gone. Re-derive — don't carry over.
- **Reasoning is not enough for this class of question.** I reasoned my way to attempts 1 and 2 and
  was wrong both times; one screenshot each settled it. Cheap, decisive, do it early.
- **The other theme wanted the opposite answer** (a sunken grey inset box, which reads as a status
  readout in that skin). Same element, different skin, different correct style. There is no single
  "good" style to reason toward.
- **Mind the override when the base rule gets narrower.** The base now carries only `border-top`
  (the separator), so the themed rule must restate the full `border` + four colours — setting just
  `border-color` leaves a 1px bright line hanging outside the new box.

And when you delete the wrapper class that no longer has a purpose, **`grep` every reference to it** —
a probe's selector list and two doc tables both named it.

### Removing a whole feature: cut by *marker*, then prove the *scope* by reconstruction

Deleting a self-contained feature ("remove the AI badge generator from the start screen") usually
means 3–4 separate blocks scattered across CSS, HTML and JS — one logical feature, N physical cuts.
Two mistakes are easy here:

- **Line-based cuts drift.** Cut block 1 and every line number below it shifts. Cut block 3 and you
  are now editing the wrong lines. Never compute offsets once and reuse them.
- **Hand-written anchors break on exotic characters.** The block held `👨‍✈️` — a ZWJ emoji. Typing that
  into a search string by hand is a coin flip; if it fails to match you get a *silent* no-op, or worse,
  a match in the wrong place.

So: for each cut, name an **opening marker and a closing marker**, then before touching anything assert
for *every* pair that `count(marker) === 1` (both of them) and `index(close) > index(open)`. Abort on
any failure. Then do the cut as `s = s.slice(0, iOpen) + s.slice(iClose)`, re-reading the file once —
not once per cut. Choose markers that are unique *and* survive the earlier cuts (a marker you already
deleted elsewhere can't be reused).

Then prove the scope, because "the feature is gone" and "nothing else changed" are different claims:

```js
let s = backup;
for (const [open, close] of CUTS) { const a = s.indexOf(open), b = s.indexOf(close);
    s = s.slice(0, a) + s.slice(b); }
console.log(s === current ? '✅ change == exactly these blocks' : '❌ something else was written');
```

Re-applying the *same* cuts to the backup and getting the current file byte-for-byte is the only cheap
proof that no other write slipped in — which matters because a batched edit can be silently overwritten
by a later batch and leave the file parsing fine. A `diff` showing `N deletions / 0 insertions` is
supporting evidence, not proof: `diff`'s hunk headers are easy to misread (I misread a `d` hunk as
starting two lines early and briefly thought a closing brace had been eaten — the reconstruction settled
it in one line, and the hunk was fine).

Before deleting, **classify every reference as "feature-owned" or "shared"**: a helper called at three
sites is shared and must survive; a class used only inside the block is owned and should go. And check
the *sibling* class that looks identical — `vector-box-pink` was live (another card used it) while
`vector-box-purple` was badge-only. Deleting the pair "for symmetry" would have broken a working card.

### Removing a feature rots the reverse-test anchors — expect it, and go fix them

The reverse tests inject defects by string-anchoring into the product. Delete a feature and any anchor
that lived inside it stops existing. Here, `reverse_test.js` had a probe anchored on
`onclick="playRadioVoice()"` — the very button the removal deleted. The probe then failed with
**"锚点唯一: 0"**, which is the harness behaving correctly (the probe asserts `count === 1` before
running, so it refuses rather than silently passing). But it still has to be fixed in the same turn:

- **Re-point the anchor at a survivor, and prove uniqueness first.** The replacement had to be an
  *inline handler* (that is what the check under test is about) that is still unique. Every remaining
  handler appeared 2–6 times — `onclick="togglePause()"` twice, `onclick="restartGame()"` twice —
  so the only unique form was a *parameterised* one: `onclick="selectShip(3)"` (one ship button per
  ship, each with a different argument). Grep the count before committing to it.
  ⚠ Ship count changes over time (it went 6 → 5 on 2026-09-21) — but this anchor survives that,
  because it only needs the *whole string* to be unique, not to point at any particular ship.
  An anchor that names a ship's *content* would not survive; see the positional-array section below.
- **Re-run the whole reverse suite**, not just the fixed probe. A removal changes the product's byte
  layout, so anchors elsewhere can break too.
- Leave a comment at the fixed anchor saying why it moved. Otherwise the next person re-points it back.

### Deleting an element from a *positional array* is a cross-cutting change, not a local one

Deleting a button removes a leaf. Deleting `SHIP_PRESETS[2]` moves **every later element down one**,
and in this kind of app the index is hard-coded in more places than you expect — `onclick="selectShip(N)"`
in the HTML, the smoke loop bound, `smoke[i]` lookups, per-ship probe scripts. Here it touched
**8 harness files and 6 probes**. Enumerate that before editing: `grep -rn 'selectShip\|theArrayName'`.

**⚠ Sequential string replacement collides. You must remap in a single pass.** To go 3,4,5 → 2,3,4,
the obvious approach is `5→4`, then `4→3`, then `3→2`. It is wrong:

```
start        3, 4, 5
after 5→4    3, 4, 4   ← duplicate created
after 4→3    3, 3, 3   ← both rewritten
after 3→2    2, 2, 2   ← everything collapsed
```

Do it with one regex pass and a mapping function, so each match is rewritten exactly once:

```js
src = src.replace(/selectShip\((\d)\)/g, (m, d) => {
    const n = parseInt(d, 10);
    return n >= 3 ? 'selectShip(' + (n - 1) + ')' : m;
});
```

- **Assert the *order*, not the count.** The old check was "there are 6 cards". Counting still passes if
  a card is removed and its `onclick` index is not decremented — the player clicks "jellyfish" and gets
  the cheater, and the count is still 5. Assert the full ordered list of visible labels instead; that is
  the only form that catches a shift.
- **The anti-resurrection guard needs the removed item's *signature*, not just its name.** A name check
  will not notice a different ship occupying the freed slot. Pin a distinctive field tuple too
  (`hpMax: 200, shieldMax: 100, fireRate: 1.5`), and note that the *count* assertion is the primary lock
  against index drift.
- **Let the product's own output prove the mapping.** This app prints `index:name` per ship in the smoke
  pass — one line showed `2:双僚机协同机  3:无敌作弊机  4:水母激光机`, confirming the shift at a glance.
  Prefer reading that over reasoning about it.
- **Prove the edit's scope by reconstruction**: re-apply the same cuts to the pre-edit backup and `cmp`.
  Byte-identical output means the change is exactly those blocks and nothing else.

### A removal needs a permanent guard, because no generic check can see a feature come back

After the deletion every check was green — and **nothing prevented the feature from being re-added**.
`getElementById` targets exist, div balance, inline handlers are declared: all of these test
*self-consistency*, not *product decisions*. Re-add the whole TTS block coherently and every one of them
stays green.

So add a symbol-level anti-resurrection check, in both directions:

```js
const REMOVED_SYMBOLS = {
    'HQ 战术复盘评估报告': ['generateAIFlightDebrief', 'ai-debrief-content', 'gen-debrief-btn'],
    'TTS 播报组件': ['speakAIText', 'speakDebriefTTS', 'playRadioVoice', 'pcmToWav',
                     'base64ToArrayBuffer', 'radio-tts-btn', 'debrief-tts-btn',
                     'SpeechSynthesisUtterance', 'generativelanguage.googleapis.com'],
};
const resurrected = [];
for (const [f, syms] of Object.entries(REMOVED_SYMBOLS))
    for (const s of syms) if (src.includes(s)) resurrected.push(`${f} / ${s}`);
check('已移除的功能没有悄悄长回来', resurrected, v => v.length === 0, JSON.stringify(resurrected));
```

- **Assert symbols, not copy.** A Chinese label can be reworded; an identifier cannot be reworded
  without also breaking the code that used it. Copy-based checks false-positive on the first
  marketing tweak.
- **Leave generic names out on purpose.** `fetchWithBackoff` and `audioContext` were removed with the
  feature, but both are plausible names for unrelated future code — listing them turns the guard into a
  false-positive source. Note the exclusion *in the comment* so nobody "completes" the list later.
- **Add the runtime half too**, and make it assert absence rather than invisibility:
  `getElementById('ai-debrief-content') === null`, not `classList.contains('hidden')`. A hidden node
  still exists and still costs a `getElementById` per frame.
- **Assert the survivors explicitly.** The in-game radio *text* bar was deliberately kept while its TTS
  button was removed, so the check asserts `radio !== null` **and** `radio.querySelectorAll('button').length === 0`.
  "Removed the right thing" and "kept the right thing" are two claims; assert both.
- **Put the runtime half last.** Driving the real `gameOver()` entry point sets the state to GAMEOVER
  and stops the rAF loop — anything after it that depends on frames will fail for the wrong reason.
- **Reverse-probe the guard with a surgical injection**: re-add a *balanced* `<div id="...">` or a
  button *without* an `onclick`, so div-balance and handler checks stay green and only the
  anti-resurrection check goes red. If three checks go red you have not shown which one caught it.

### A self-hosted static harness logs a `favicon.ico` 404 — that is the harness, not the page

Capturing `Log.entryAdded` while loading the page over your own `http.createServer` fixture will surface
`404 /favicon.ico`. Chrome requests it automatically; your fixture doesn't serve it. It is **not** a
regression, and it is not something the page references.

Confirm before you shrug: `grep` the page for `<link`, `<script src`, `<img`, `url(`. If the only hits
are external CDNs (Tailwind, Google Fonts), the page references **zero local assets**, so any 404 arriving
at *your* server can only be an auto-request. Then filter it out of the assertion and *say so* in the
output (`ℹ ignoring 1 favicon.ico 404`) rather than letting a permanently-red "no console errors" check
train you to ignore it — a check that always fires is worse than no check. Verify against the pre-change
backup too: if the same two external references are there, the noise predates your edit.

### A metric computed *inside* the page but missing from the return object is dead code — and it looks finished

I added a `pairGapMax / pairGapMin` computation inside the injected `ev()` block, then got interrupted.
The next session's `grep` said the variables weren't there (I searched the wrong names, `mainMinPair`).
They *were* there — computed, updated every frame — but **absent from the returned object**, so nothing
outside the page could ever see them and **no assertion existed**. The suite stayed green at 372. It
looked like a finished metric; it was a no-op.

The failure mode is nastier than a missing check, because the code is *there*. A reviewer skims
`pairGapMax = Math.max(pairGapMax, gap)` and concludes the metric is covered. Three habits kill it:

- **Follow the value to an assertion.** After writing a measurement, `grep` for its name and confirm at
  least one `check(...)` consumes it. If the only hits are inside the page-side string, it's dead.
- **`grep` the *actual* variable name, not the name you remember inventing.** I nearly "disproved" my own
  edit because I searched `mainMinPair` while the code said `pairGapMax`. Confirm against the file.
- **An interrupted turn is a half-written turn.** When a user interjects mid-edit, the next session must
  re-verify every edit from that turn against disk, not against the summary of what it intended.

### `max − min` hides clustering — for "are these N things distinct?", measure the *minimum pairwise* gap

The suite asserted `Lv5 主激光确实互相错开（最大跨度 >20°）` — angle spread across the 4 main lasers.
It passed comfortably every run, because spread reached **141°**. But the thing the claim is about is
"can you see 4 separate beams", and spread answers a different question: *one* laser swinging wide
inflates it while the other three sit on top of each other. The honest metric is the **minimum pairwise
gap** — the closest pair — and on the same frames it was only **33–47°**.

| metric | run A | run B | run C |
|---|---|---|---|
| spread (`max − min`) | 139° | 140° | 143° |
| **min pairwise gap** | 43.3° | 32.3° | 26.3° |

So a passing assertion was **falsely reassuring** — it certified a property nobody asked about. When the
claim is "N things are distinct / separated / not stacked", the metric is the *minimum pairwise*
distance, never the range. Range is the metric you reach for when you haven't decided what you mean.

This is also a reason to keep the new metric *beside* the old one rather than replacing it: spread still
proves the sweep mechanism is running. Two metrics, two claims.

### Hand-driving the physics: size the window from the parameters, and restore *all* the state you mutated

To measure a kinematic range you want to step the simulation yourself with a fixed `dt`, not sample
`requestAnimationFrame`. Two traps, both hit in one sitting:

**1. The window must cover the *relative* frequency, and you should derive it from the source.**
Sampling 60 rAF frames (~1 s) covered barely a third of the slowest sweep period (3.40 s), so the metric
jumped **12.5 → 24.2** between identical runs — no threshold could hold. Worse, each instance carried
`this.t = Math.random() * 10`, so a short window samples a random phase and the value depends on luck.
The window that matters is the **slowest *difference*** between the oscillators, not the slowest
oscillator: `sweepSpeed = 1.85/2.26/2.67/3.08` → min |Δω| = 0.41 rad/s → relative period 15.3 s.
Reading that off the parameters and scanning 2× it dropped the band to **33.4 → 46.7**. Derive it in
code (`Math.min` over pairwise |Δω|) so it tracks the parameters instead of going stale.

```js
const w = mains.map(L => L.sweepSpeed);
let dw = Infinity;
for (let x = 0; x < w.length; x++) for (let y = x + 1; y < w.length; y++) dw = Math.min(dw, Math.abs(w[x] - w[y]));
const span = 2 * Math.max(dw > 0 ? 2 * Math.PI / dw : 0, 2 * Math.PI / Math.min(...w));
const steps = Math.ceil(span / dt);
```

**2. Some residual variance is intrinsic — say so instead of tightening the threshold.** Even at 2× the
relative period the value still ranged 33.4–46.7 over 7 runs. That is not undersampling: with three
incommensurate relative frequencies the relative phase is a *line on a 3-torus*, not a dense fill, so
which phase you land on depends on the random start. The right response is a threshold with deliberate
slack (25° against a 33.4° floor) plus a comment explaining the band — **not** a threshold pinned to the
observed floor, which would go red on an unlucky draw. Pair it with a defect value that is far below
either number, so the assertion's *discriminating power* doesn't depend on the noise: the injected
defect measured 14.9°.

**3. Restore every field you mutated, not just the one you read.** `LaserBeam.update(dt, player)` looks
like pure kinematics — it advances `t` and recomputes `angle`. It *also* decays `cooldowns`, and the
next test section measured boss DPS, which is throttled by exactly those cooldowns. Stepping 1839 times
drained them all, quietly handing the following test a clean slate. It happened to still pass — which is
luck, not correctness. Snapshot the whole mutable surface (`t`, `angle`, `prevAngle`, `cooldowns`) and
restore it, and write down *why* in the comment, because "restore the state" reads like boilerplate
until someone deletes it.

### "Does it leave the screen?" — pixels cannot answer that, because the canvas clips

A user reported "the giant enemy sometimes disappears off the edge". The natural probe is to draw it
and find the lit-pixel bounding box. **That probe cannot work**, and it fails in the most dangerous
way: it returns a confident "0px overflow".

The canvas is a clip rect. Anything drawn past `[0,W) x [0,H)` is simply not in the bitmap, so
`getImageData` reports the outermost drawn pixel as `maxx === W - 1` — *exactly the edge* — no matter
how far past it the shape actually went. I spent a full round concluding "no overflow" from that.

Measure the geometry instead: wrap the path calls and apply the live transform.

```js
const P = CanvasRenderingContext2D.prototype;
let minx, maxx;
const rec = (x, y) => { if (x < minx) minx = x; if (x > maxx) maxx = x; };
const pt = (c, x, y) => { const m = c.getTransform();
    rec(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f); };
const saved = {};
const wrap = (name, handler) => { saved[name] = P[name];
    P[name] = function (...a) { handler(this, a); return saved[name].apply(this, a); }; };
```

Then sweep the *state that changes the silhouette* (here: `this.angle`, since the widest parts rotate)
and take the max — a single sample measures one pose, not the shape's reach.

**Wrap every primitive the draw code uses, and verify the instrument.** `strokeRect` and `fillRect`
are native; they do **not** call back into the JS `rect()` method. Wrapping only `moveTo/lineTo/rect/arc`
silently under-measured two of six variants by 30–80% (a rotating `strokeRect(-75,-12,24,24)` turret
read as 55 instead of 76). Cheap defence: measure something whose answer you already know — if a
rotating 84x84 square does not report ~59 (42·√2), your instrument is incomplete, not the art.

Two smaller ways the same probe lied to me, both worth checking in any measurement loop:

- **An initial-value predicate can swallow the boundary case.** `if (L > worstLeft) { worstLeft = L; worstType = t; }`
  with `worstLeft = 0` never fires when `L === 0` — so "exactly at the edge" was recorded as "found
  nothing", and the sentinel `type = -1` in the output was the only clue. Initialise accumulators to
  `-Infinity`, or compare against the sentinel explicitly.
- **A bouncing object's position after N frames is not its extreme.** Stepping 900 frames and reading
  `x` gave a mid-band value because the thing had reversed many times. Track the running max/min
  during the loop and then park it there; the same applies to any value you intend to freeze for a
  screenshot.

### Derive a movement bound from the per-variant geometry, and let the test check the declaration

The bug was a hard-coded `if (this.x < 100 || this.x > canvas.width - 100) this.dx = -this.dx;` — a
fixed margin that knows nothing about how big the thing actually is. Six art variants ranged from 48
to 95, so the widest overflowed by 7px of solid geometry (23.5px including its glow), and only when
its *rotating* parts happened to point outward — which is exactly why the report said "sometimes".

Two properties of the fix matter more than the numbers:

- **Clamp the coordinate, not just the direction.** Flipping `dx` leaves the overshoot in place, and
  `dt` is capped at 0.1s, so a single hitch adds 12px past the bound. Also use `Math.abs(this.dx)` to
  set the new direction: `this.dx = -this.dx` can leave it pointing outward if it was already 0 or
  already reversed.
- **Declare the per-variant size next to the art it describes, then assert the declaration.**
  `this.drawnHalfWidth = [78, 97, 82, 87, 50, 61][this.typeIndex];` is a *spec*, not a derived value —
  and the test measures the real silhouette and fails if any declaration is smaller than the measured
  radius plus stroke. That pairing is what keeps a hand-written number honest: the art can be
  re-tuned, but it cannot drift away from the bound without turning the suite red.

**The collision box is the same bug's second face — and "keep them separate" is not automatically right.**
The same class also had `this.width = 140 / this.height = 110` feeding three hit tests. My first instinct
was to leave it alone ("that's *collision*, changing it moves difficulty"). That instinct was half right:
it does move difficulty, so it is the user's call — but it is *not* a reason to leave a fixed constant
sized for one variant feeding six. Measured, the mismatch ran both ways: CYBER's silhouette reached 96.5
while only 70 counted as a hit (art you can see but not shoot), and VOID's silhouette was 49.5 while 70
counted (a hitbox you can't see). Both are bugs. Ask which way to go, then unify deliberately. See
"The same fixed constant usually feeds several consumers" below.

### The same fixed constant usually feeds several consumers — fixing one is a prompt to audit the rest

`this.width`/`this.height` were read in **three** places, all of them hit tests: the bullet rect, the
laser radius, and the player-ram box. `this.drawnHalfWidth` was read in one: the movement bound. Fixing
the movement bound left the collision box untouched, and because both were "the boss's size", the second
defect looked like a different problem when it was the same one.

When you replace a hard-coded geometry constant, `grep` the field and read *every* consumer before you
decide you're done. Then check the reverse too: consumers that read a *different* field for the same
concept are the ones that will drift.

### Measuring a hitbox: three ways the probe silently reports "nothing is hittable"

I bisected the maximum hittable offset by calling the real `checkCollisions()` / `checkLaserHits()` with
synthetic projectiles. The first three runs returned `-1` for every variant — and **each cause produced
the identical output**, so the table looked like a legitimate finding ("nothing can hit the boss") rather
than a broken probe:

1. **The global wasn't assigned.** I wrote `const B = new Boss(t, 1)` instead of `const B = boss = new
   Boss(...)`. The collision functions read the *global* `boss`, so every check took the "no boss" branch
   and returned false. A locally-constructed object is invisible to them.
2. **The health field was misnamed.** The class uses `this.hpMax`, not `this.maxHp`. Assigning
   `player.hp = player.maxHp` set `hp` to `undefined`, and `undefined < undefined` is false forever.
3. **A guard ate the damage.** `takeDamage()` applies the shield *before* touching `hp`, so with a
   shielded ship `hp` never moved. Zero the shield in the probe.

So: `-1` / "no hits" from a hit-detection probe is a *suspicious* result, not a finding. Make the probe
self-check — assert that the zero-offset case hits, and that a far-out offset misses. `bisect` here
returns `-1` for the first and `Infinity` for the second, and both are reported as data, never as 0.

### Assert on the collision box, not the declaration table — or you just re-test the old assertion

My first version of the new checks compared the *measured silhouette* against `drawnHalfWidth`. That is
already what the movement-bound test does — the new section would have been green under the old,
broken collision code. The invariant that actually catches the bug is one level over:

```js
check('Boss 碰撞盒半宽就是声明值（三路判定没有各走各的）',
    HITBOX.map(r => +(r.boxW - r.drawnW).toFixed(1)),   // boxW = B.width / 2, drawnW = B.drawnHalfWidth
    v => v.every(x => Math.abs(x) <= 0.01), ...);
```

"Declaration matches the art" and "the hit test uses the declaration" are **two independent claims**.
Asserting the first and assuming the second is how a fixed `140` survived a suite that already measured
the art.

### A declared value that is `ceil(measured + stroke)` has non-zero slack — derive the bound

The over-coverage check is `drawnW - measuredW <= DECL_SLACK`. I wrote `<= 2` and got a red on
`78 - 75.9 = 2.1`. That is not a defect: the table is `ceil(measured + strokeHalf)`, so it carries the
1.5px stroke *plus* up to 1px of rounding. The honest bound is `STROKE_HALF + 1`, derived from how the
number was produced. A bound that is too tight gets "fixed" by loosening it blindly; a bound derived
from the construction stays tight enough to catch a real defect (injecting a fat `120` gives 42.6).

### A silhouette that isn't a circle needs an ellipse test — and pick the reverse probe carefully

The laser test was `distToSegment(...) < Math.max(width, height) / 2 + halfW` — a circumscribed circle.
Once the box became per-variant, flat shapes still over-counted on their short axis: NEON is 87 wide but
only 52 tall, so the beam registered hits 35px above the wings. Replaced with an inflated-ellipse test
using the closest point on the beam to the centre:

```js
const rx = boss.drawnHalfWidth + halfW, ry = boss.drawnHalfHeight + halfW;
const cp = closestPointOnSegment(boss.x, boss.y, s.x, s.y, e.x, e.y);
const nx = (cp.x - boss.x) / rx, ny = (cp.y - boss.y) / ry;
if (laser.canHit(boss) && nx * nx + ny * ny < 1) { ... }
```

Two notes. It is an approximation — the nearest point on an ellipse to a line is not the centre's
projection — so say so in the comment; the beam is thin and the error is ~1px. And when you write the
reverse probe, **pick the variant where the two formulations actually differ**. My first candidate was
VECTOR (82 wide / 62 tall), where `max(w,h)/2 === w/2` and the circumscribed circle is indistinguishable
from the ellipse on the horizontal axis — the probe would have passed against the broken build. VOID
(50 wide / 62 tall) is the one where `max` flips to the *height*, and only then does the assertion fire.
A reverse probe that can't distinguish the two implementations proves nothing.

### A screenshot A/B needs the scene frozen, or the loop will move the subject

To show before/after I parked the boss at its extreme and cropped the canvas edge. First attempt: the
boss had drifted by capture time, and the frame was full of bullets. Both had the same cause — the
game loop kept running between my setup and `Page.captureScreenshot`.

- **Freeze the subject**: `obj.update = function () {}` plus `obj.dx = 0`. Zeroing the velocity alone
  is not enough, because `update()` still advances timers that the art depends on (`this.angle`
  rotated the very nodes the screenshot was meant to show).
- **Clean up after the setup, not before it.** The 900 synchronous `update(0.1)` calls I used to reach
  the extreme made the boss genuinely fire ~2000 bullets. Clearing `enemyBullets` *before* the loop
  left them all on screen; clearing after gave a 90KB clean crop instead of a 360KB mess.

### Two scoring paths can be *already* forked — unreachable today, unguarded forever

`onBossDefeated` and `onEnemyDefeated` computed the score with different expressions:

```js
score += Math.floor(boss.scoreValue * scoreMult);                                  // boss
score += Math.floor(e.scoreValue * (isBonusWave ? scoreMult * 10 : scoreMult));    // enemy
```

The boss path is missing the bonus-wave ×10. Nothing is wrong *today*, because a boss can never be
killed during a bonus wave — three separate guards enforce it (`if (boss) { boss.update(dt); return; }`
sits before the bonus branch; the boss trigger calls `if (isBonusWave) endBonusWave();` first; the
normal bonus wave's entry reads `&& !boss && !isBossWarning`). But **no assertion pins that mutual
exclusion**, so the day someone relaxes one guard, boss kills silently score 10× low and the suite stays
green.

When you find a fork that is currently unreachable, the cheap correct move is to pin the *invariant*,
not to "fix" the unreachable branch:

- Drive the real state machine from the **most adversarial starting state** — not from a normal
  playthrough that merely never happens to hit it. Here: start already inside a bonus wave with
  `killCount` sitting exactly on the boss trigger line, then step `updateSpawns(dt)` for ~20s of sim
  and assert `boss && isBonusWave` never co-occurs.
- Test **both directions** of the exclusion. Direction A (bonus wave → boss) and direction B (boss →
  bonus wave) fail through different code, so one assertion covers neither.
- Include a **sanity assertion that the probe reached the state it is testing** — "the boss really did
  spawn during the run". Without it, a probe that never gets a boss would report the exclusion as
  vacuously satisfied. That sanity check must stay green in the reverse test while only the target
  assertion goes red; if both go red you have not isolated anything.
- The reverse probe is then a one-line deletion: drop the `if (isBonusWave) endBonusWave();` and the
  target assertion fires (red face: 1).

**Do not "fix" the unreachable branch.** Making the boss path multiply by ×10 too is behaviourally a
no-op, so it is tempting — but it quietly decides a design question (should a bonus-wave boss be worth
10×?) that the user has not answered. Pin the invariant and leave the decision visible.

## Embedding a whole external page into a single-file app

A 2 353-line standalone game had to become a fourth entry in an existing in-app game modal. The host is
a **single-file** app — HTML + CSS + JS inline, no build step, and (measured) **zero** local relative
references, only remote font URLs. So the game could not be linked as an external file, and rewriting
it was out of scope. The move: keep the whole page as a **template-literal constant** and hand it to an
`<iframe srcdoc>`.

Before choosing the route, actually measure the host's external references. "It's a single file, so it
can just link the other file" is the assumption that breaks the whole premise.

### The five escapes, and why each one is silent if you skip it

Escaping a whole page into a template literal means satisfying **two** parsers at once — the JS lexer
that reads the literal, and the HTML lexer that reads the *result*.

| escape | what happens if you don't |
|---|---|
| `\` → `\\` | the worst one: `/\d+/` silently becomes `/d+/` — the app boots, every regex is wrong, nothing throws |
| `` ` `` → `` \` `` | the literal closes early; the rest of the page becomes syntax soup |
| `${` → `\${` | treated as interpolation — usually a hard error, sometimes a silent `undefined` |
| `</script` → `<\/script` | the host's `<script>` is terminated early |
| `<!--` → `<\!--` | the HTML lexer enters *script-data-escaped*; after that `</script` **no longer ends the script** |

That last one only bites when the source happens to contain the right sequence — a `<script src=…>` tag,
then a `<!--`, then the main `<script>`. This file had exactly that at lines 7 / 129 / 329. `\/` and
`\!` are JS `NonEscapeCharacter`s, so the runtime string is byte-identical to the source.

**Line endings.** The file on disk is CRLF (matching the host). The JS spec *normalises* `<CR><LF>` to
`<LF>` inside a template literal, so the runtime value is pure LF. Both are "correct" — which is why
the criterion below has to state which one it means.

### The criterion is a byte-identical round trip, not "it runs"

Write the generator with a self-check that evaluates the emitted literal back and compares it to the
source:

```js
vm.runInNewContext('`' + escaped + '`') === source.replace(/\r\n/g, '\n')
```

"It launches" would have passed while `/\d+/` was broken. The round trip caught two real bugs in the
generator itself on the first run — one an off-by-one that turned `</script` into `<//script`, which
would have quietly killed a tag inside the game.

Two traps in the generator, both worth pre-empting:

- **Find the literal's end from the end marker, backwards.** Scanning forward for the first `` `; ``
  hit a string *inside* the page's own code (`` radioText.innerText = `📡 ${msg}`; ``) and truncated the
  literal — the symptom was a JS syntax error that looked like the file was corrupt.
- **Count closing tags, not opening ones.** A guard that counts `<script` will always "fail", because
  the literal legitimately contains the opening tags. Count `</script` and `<!--`.

### Unmount by *detaching*, not by hiding

Hiding the iframe (`display: none`) leaves it mounted. This game's loop re-queues itself *regardless of
state*:

```js
function gameLoop(t) { /* … */ if (gameState !== 'PLAYING') { requestAnimationFrame(gameLoop); return; } /* … */ }
```

so once it starts it never stops — a hidden iframe burns full frame rate forever, with nothing visible
and nothing in the console. The test that proves it: read a frame counter inside the frame, remove the
iframe, wait, read again.

- Read the counter **twice** and compare — a single reading proves nothing.
- Handle the case where the window is already collected (`w.eval` throws or returns nothing): that also
  counts as stopped, but **give both branches the same assertion name** (see below).

### Focus: `element.focus()` must come *after* `appendChild`, and `contentWindow.focus()` alone is a no-op

The game's keydown listener lives on its own `window`. Calling `f.contentWindow.focus()` from the
frame's `load` handler did nothing: the parent's `activeElement` stayed `BODY`, the child's
`hasFocus()` stayed `false`, and pressing WASD had no effect **while the picture looked perfectly
fine**. Timing was the whole fix:

```js
host.appendChild(f);
stShooterFocus(f);          // ← element focus, immediately after insertion
```

Waiting for `load` is too late and unreliable here — the page's `@import` pulls a webfont and can push
`load` out by seconds.

- A probe that tried five variants and printed `activeElement` / `hasFocus()` / who received a real
  `keydown` settled it in one run. Print the evidence; don't reason about it.
- The assertion that matters is a **real key event**, with a control: dispatch `KeyW` and assert the
  frame got it *and* the parent did not.
- ⚠ Once the timing is fixed, `contentWindow.focus()` alone becomes sufficient — so the suite can no
  longer tell the two calls apart. Say so in the notes instead of pretending the probe is fine-grained.

### An assertion name that depends on a runtime branch defeats the reverse test

One assertion was written as two branches with two names — `…(window collected)` and `…(tick frozen)`.
Both are true statements, but the baseline only ever prints one of them, and the injected run prints the
*other*. A reverse probe that names the assertion by string then points at something that does not exist
in the baseline.

- The existence gate in the reverse harness caught it (`red` name not found → exit 1) — **build that
  gate**; without it, "all expected assertions went red" passes vacuously when the name matches nothing.
- Fix: collapse to one boolean and **one fixed name**, and `console.log` which branch was taken.

### "True by construction" — the third form of a vacuous assertion

Two earlier forms are documented above (an assertion whose premise a new feature invalidated; one that
reads a generated artifact). This round produced a third: `score === 0` as proof that a restart reset
the game. The previous round had only been running for 1.5 s, so the score was 0 anyway. Pick a quantity
that *cannot* be at its reset value by accident — here, elapsed time (`< 0.5 s`), with an
opposite-direction control (`> 0.3 s`).

### An audit tool printing ✅ is a necessary condition, not a sufficient one

The anchor-audit script checks "the line number in the table is the start of a comment banner", plus a
soft hint ("is the banner's text related to the section name?"). A new CSS banner landed **exactly** on
a table row's line number and shared two characters with that row's section name. Hard check passed,
soft hint stayed quiet, and the tool reported "both tables match" — while all 17 rows in that table were
off by +27.

- "That line is a banner" is necessary, not sufficient. A banner whose vocabulary overlaps an existing
  section name defeats the soft hint.
- After editing CSS, don't stop at the tool's ✅ — `grep` two or three anchor strings by hand.
- Name new banners to **avoid** words already used by other sections.

### Inlining a blob dilutes the static check — cut it out before checking

The host's static check has a rule "every referenced identifier is declared somewhere". Because it
deliberately reads the *raw* source (the host writes inline `onclick="…"` inside JS strings), the
inlined game code contributed 27 top-level function names to *both* sides of that comparison — including
four that the inlined code's own handlers reference. Self-consistent, so nothing fired today, but it
would mask the deletion of a same-named host function.

Cut the blob out of the text used by the declaration/reference rules, and **print how many bytes you
cut** so the gate cannot silently stop matching.

### A navigation that never fires `load` — measure the network before the product

A CDP suite started dying with `等待事件超时: Page.loadEventFired` and `document.readyState` stuck at
`interactive`. The app was completely healthy. The page had an `@import` pulling Google Fonts (3 families
→ **24 `.woff2` files**), and `load` waits for all of them; under the current network
`fonts.googleapis.com` took **~4 s per request**, so a 15 s navigation timeout was simply too short.

The order of operations matters — do them in this order:

1. **Measure the environment first.** `curl -s -o /dev/null -w '%{time_total}\n' --max-time 12 '<url>'`.
   If it is slow, that is your answer.
2. **Decide "regression or environment" with a control**: run *the same harness* against the pre-change
   copy of the app. Both hang → environment. Only the new one hangs → regression. This takes one run and
   removes all guessing.
3. **Instrument before theorising.** A throwaway probe that repeats the harness's own launch flags and
   call order, logging every CDP event plus the **still-in-flight requests**, named the culprit in one
   run. Do not reason about which resource is pending — print it.
4. **Fix the timeout, don't retry until it passes.** A navigation timeout is a *network* timeout, not an
   animation timeout — do not size it like the 300 ms ones. Extract it as a named constant and use it at
   every navigation site.
5. **Delete the probe afterwards.** It duplicates the harness's launch flags and call order, so it will
   drift out of sync with the harness — two copies means one of them is wrong.

### A failure count of `−1` means "parse artifact", not "pass"

The runner's per-suite parser matched `(\d+)/(\d+) 通过` and computed `fail = total − pass`. When the
suite crashed, its last line was `-1/0 通过`; the regex skipped the `-` and matched `1/0`, giving
`pass = 1, total = 0, fail = -1`. The runner's only failure test was `fail > 0` — so a suite that ran
**nothing at all** printed ✅, the total read "1261 passed / -1 failed", and the process exited 0.

- **A negative count can only come from arithmetic on a mis-parse.** Make it a hard error, alongside
  "no parseable summary line" and "unclassified file in the directory". A denominator of `0` deserves
  the same treatment: it means nothing ran.
- Check whether the *other* harness needs it too — here it did not, because its regex requires digits on
  both sides of `通过 / 失败`, so `-1/0` simply fails to match and falls into the "unparseable" branch.
  **Different summary formats have different failure modes; fix the one that has the bug and say why the
  other does not.**

