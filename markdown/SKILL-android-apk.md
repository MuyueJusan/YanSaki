---
name: wrap-html-in-android-apk
description: >
  Wrap a self-contained HTML app (single-file or static folder) into an installable Android APK
  with a WebView shell — no Gradle, no Android Studio, no third-party dependency.
  Trigger when the user says "打包成 APK", "做个安卓版", "封装成 app", "wrap this page in an APK",
  or wants an installable Android build of a local HTML project.
  Covers the manual aapt2 → javac → d8 → zipalign → apksigner pipeline, the failure modes that
  cost the most time (opaque origin killing localStorage; javac version crashing d8; a WebView
  origin being blocked by CORS on third-party APIs), and how to verify the result without a device.
agent_created: true
---

# Wrapping an HTML app in an Android APK (no Gradle)

This is a **manual** build pipeline. It exists because it is genuinely better than Gradle for the
case "one Activity, a WebView, and a folder of assets":

- No ~130 MB Gradle distribution plus its dependency downloads.
- No coupling to the JDK window that Android Gradle Plugin demands.
- The whole build is ~10 commands you can read.

It is **worse** than Gradle the moment you need: more than one Activity, any AndroidX/Material
dependency, resource shrinking, Kotlin, or Play Store AABs. Don't force it there.

---

## 0. The four things that decide success

Get these wrong and you will spend hours on symptoms that point nowhere near the cause.

### 0.1 Never load the page from `file://` — give it a real origin

`file://` is an **opaque origin**. If the page touches `localStorage`, `sessionStorage`, or
`IndexedDB`, it throws `SecurityError` — and typically **without any visible error in the UI**. The
symptom is "my settings don't persist", which sounds like a bug in the page.

Serve the assets from a reserved hostname instead, via `shouldInterceptRequest`:

```java
private static final String HOST = "appassets.androidplatform.net";   // androidx uses this too
private static final String START_URL = "https://" + HOST + "/index.html";

web.setWebViewClient(new WebViewClient() {
    @Override
    public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (u == null || !HOST.equals(u.getHost())) return null;   // real network requests pass through
        String path = u.getPath();
        if (path == null || path.isEmpty() || "/".equals(path)) path = "/index.html";
        try {
            return new WebResourceResponse(mimeOf(path), "utf-8", getAssets().open(path.substring(1)));
        } catch (IOException e) {
            // ⚠ Do NOT return null here — null makes the WebView actually try to resolve this
            //   fake hostname, and you get a DNS error that has nothing to do with "file missing".
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }
    }
});
```

This is what `androidx.webkit`'s `WebViewAssetLoader` does — but written by hand it needs **zero
dependencies** (no Gradle, no AAR juggling).

Also required: `settings.setDomStorageEnabled(true)`.

**Before committing to this, count the page's storage usage**: `grep -c localStorage index.html`.
If it's zero you *could* use `file://`, but the intercept trick costs 15 lines and removes a whole
class of problem — just use it.

### 0.2 javac must come from JDK 11 or 17 — **not 21+**

| javac from | d8 (R8 8.2.2, build-tools 34) |
|---|---|
| JDK 11 | ✅ |
| JDK 21 | ❌ internal NPE |
| JDK 24 | ❌ internal NPE |

Modern javac, when targeting `-target 8`, emits something for classes that carry a **synthetic
`this$0` outer reference** (i.e. any anonymous class inside an *instance* method, or any
non-static nested class) that d8's class-file parser chokes on:

```
java.lang.NullPointerException: Cannot invoke "String.length()" because "<parameter1>" is null
    at com.android.tools.r8.graph.u2.<init>
Compilation failed with an internal error.
```

⚠ **The class file major version is 52 in both cases** and `-g:none` does not help. You cannot see
this by inspecting bytes — only by changing javac.

⚠ And you cannot dodge it by raising the target: **`-bootclasspath android.jar` is only allowed
with `-target 8`** (javac: `error: option --boot-class-path not allowed with target 11`). Targeting
`android.*` correctly *requires* the bootclasspath, so "just use target 11" is a dead end.

Minimal reproducer (drop-in, ~30 lines): see `android/tools/repro-d8-javac/` in this project, or
write one — an interface plus an anonymous implementation inside an **instance** method. A static
context does *not* reproduce it, which is exactly why the first minimal repro looks like it passes.

### 0.3 Downloads from `blob:` URLs need a shim

If the page exports files via `URL.createObjectURL(blob)` + `<a download>` + `a.click()`, WebView's
`DownloadListener` receives the `blob:` URL but **cannot read its contents**. Inject a shim after
load that wraps the *browser API*, not the page's own function:

```js
var orig = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () {
  var href = this.getAttribute('href') || this.href || '';
  if (this.hasAttribute('download') && href.indexOf('blob:') === 0) {   // BOTH guards required
    var name = this.getAttribute('download') || 'download.bin';
    fetch(href).then(r => r.blob()).then(b => {
      var fr = new FileReader();
      fr.onload = function () {
        var s = String(fr.result), i = s.indexOf(',');
        window.MyAppNative.saveFile(name, i >= 0 ? s.slice(i + 1) : s);
      };
      fr.readAsDataURL(b);
    });
    return;
  }
  return orig.apply(this, arguments);
};
```

⚠ Intercepting the page's *own* download helper (whatever it is called) welds the wrapper to the
page's internals — rename it and the wrapper silently stops working. `a.click()` is a browser API
and every download path goes through it.

On the Java side, `@JavascriptInterface` + `MediaStore.Downloads` (API 29+) writes to the Downloads
folder with **no runtime permission**.

### 0.4 Cross-origin API calls need a `fetch` shim — and it must be desktop-testable

If the page calls a third-party API (Google Vertex / Gemini, OpenAI, …) the request leaves fine but
the response is **unreadable**: the service sends no `Access-Control-Allow-Origin` for a WebView
origin. Symptom: `TypeError: Failed to fetch`, with only a vague console message.

Two ways out. Prefer the second:

| | `shouldInterceptRequest` | injected `fetch` shim |
|---|---|---|
| page changes | none | none (wrap the browser API) |
| correctness depends on | three behaviours you cannot test off-device: whether your synthesized response needs CORS headers, whether preflight is also intercepted, whether streaming must return synchronously from the background thread | the browser's own `Response` / `ReadableStream` / `AbortSignal` |
| testable without a device | no | **yes** — run the real shim under Node |

The design rule that makes it testable:

> **Put the forwarding core in classes that import no `android.*`.**

Then the *same* source compiles and runs on a **desktop JVM**. A Node script replays the exact strings
the Java side would hand to `evaluateJavascript`, while a local fake server records what it actually
sent — so the assertion is a **round trip** (bytes out == bytes back), not a self-comparison.
Guard the property with a class count: if someone adds an `android.*` import, the desktop compile
fails and the assertion goes red.

⚠ Write the callback→`evaluateJavascript` string builder as its **own** class too. Otherwise the test
has to re-implement the escaping, and you end up testing the test.

⚠ Inject via `onPageFinished`. Safe only if the page never stores `fetch` in a variable — grep for
`window.fetch =`, `= fetch`, `const fetch`, `fetch.bind` before relying on it.

Things that silently break streaming — each worth an assertion:

- **`Accept-Encoding: identity`.** Otherwise `HttpURLConnection`'s transparent gzip buffers the whole
  SSE into one block and "streaming" quietly disappears (no error).
- **Non-2xx must not throw.** Read `getErrorStream()` and forward the body, or the page can only say
  `HTTP 400` instead of *why* it was rejected.
- **Emit the status line before the body**, so the page's `fetch` resolves immediately.

⚠ Allow-list the hosts the shim may take over, and keep that list in **one** place. If the JS copies
it, editing Java and forgetting JS shows up as "the shim took the request, then rejected it".

⚠ Leave one method as the **seam** for "route through a local gateway instead":

```java
public static String upstream(String url) { return url; }   // change this one line only
```

That is what lets "native in-process forwarding" and "bundle a local open-source gateway" be
fallbacks for each other — same seam, different downstream. Keep the loopback hosts in the allow-list.

---

## 1. Toolchain

```bash
# cmdline-tools (~150 MB), then:
sdkmanager --sdk_root="$SDK" "build-tools;34.0.0" "platforms;android-34"
```

You need, from `build-tools/34.0.0/`: `aapt2`, `d8`, `zipalign`, `apksigner`.
From `platforms/android-34/`: `android.jar` (~26 MB — this is the compile classpath).

⚠ `sdkmanager` needs a JDK; JDK 21 is fine for the *tools*. Only **javac** needs 11/17.
Set `JAVA_HOME` (the `.bat` wrappers read it) but point javac at the older JDK explicitly.

⚠ Disk: a minimal SDK is ~250 MB. Check free space first — this is easy to forget on a full drive.

## 2. The pipeline

```bash
SDK=.../android-sdk ; BT=$SDK/build-tools/34.0.0 ; AJ=$SDK/platforms/android-34/android.jar

# 1) resources
aapt2 compile --dir res -o build/res.zip

# 2) link → APK skeleton (resources + manifest + assets) and generate R.java
aapt2 link -o build/apk/base.apk -I "$AJ" \
    --manifest AndroidManifest.xml -R build/res.zip -A assets --java build/gen \
    --min-sdk-version 29 --target-sdk-version 34 --auto-add-overlay

# 3) compile  (⚠ JDK 11/17 — see §0.2)
javac -source 8 -target 8 -nowarn -encoding UTF-8 \
      -bootclasspath "$AJ" -d build/classes $(find src build/gen -name '*.java')

# 4) dex  (jar first: Windows command lines have a length limit)
(cd build/classes && jar cf ../classes.jar .)
d8 --lib "$AJ" --min-api 29 --output build/dex build/classes.jar

# 5) put classes.dex into the APK  (see §3 for why not `zip`)
python tools/add-dex.py build/apk/base.apk build/dex/classes.dex

# 6) align + sign
zipalign -p -f 4 build/apk/base.apk build/aligned.apk
apksigner sign --ks keystore/debug.jks --ks-pass pass:android --key-pass pass:android \
    --ks-key-alias androiddebugkey --v1-signing-enabled true --v2-signing-enabled true \
    --out build/App.apk build/aligned.apk
```

Manifest notes:
- `android:exported="true"` is **mandatory** on the launcher activity from targetSdk 31.
- `configChanges="orientation|screenSize|screenLayout|smallestScreenSize|keyboardHidden|uiMode|density|fontScale|locale"` — without these, rotating recreates the Activity and the WebView reloads from scratch (losing in-page state).
- `minSdk 29` buys you `MediaStore.Downloads` with no runtime permissions. Going lower means
  `WRITE_EXTERNAL_STORAGE` + a permission-request flow — two extra failure paths.
- Use **framework** themes (`@android:style/Theme.Material.Light.NoActionBar`). Pulling in
  AppCompat/Material means hand-assembling an AAR classpath, which is where this approach stops
  being worth it.

## 3. Why `add-dex.py` instead of `zip`

- Git Bash ships `unzip` but often **not** `zip`.
- More importantly: you must not disturb `resources.arsc`. targetSdk 30+ requires it **uncompressed
  and 4-byte aligned**. Rewriting the archive risks recompressing it.
- `zipfile.ZipFile(apk, 'a')` opens `r+b` and appends — **existing entry bytes are untouched**.

Then **assert** it, in the same script: `resources.arsc` must be `ZIP_STORED`, and `classes.dex`
must appear exactly once. Fail loudly if not.

## 4. Verify — and the three readings that look like failures but aren't

```bash
aapt2 dump badging App.apk            # package / version / launchable-activity / icon
apksigner verify --verbose --min-sdk-version 23 App.apk   # ⚠ see below
zipalign -c -v 4 App.apk              # ⚠ judge by EXIT CODE
```

⚠ **`apksigner verify --verbose` reports v1/v2 as `false` when it didn't check them.** It only
verifies the schemes the APK's `minSdkVersion` *requires*. With minSdk 29 that's v3 alone, so v1/v2
print `false` — that is **"not checked", not "not signed"**. Pass `--min-sdk-version 23` to audit
all schemes. (Symptom of being fooled: you conclude the signing flags didn't work and start
changing them.)

⚠ **`zipalign` misspells its own success message** — `Verification succesful` (one `s`). Never grep
that string; use the exit code.

⚠ **`zipalign WARNING: header mismatch`, one line per nested asset, is a false alarm — and its exit
code is still 0.** Root cause: on Windows, `aapt2` writes the *Local File Header* name for an asset
that lives in a subdirectory using the platform separator `\`, while the *Central Directory* entry
uses `/`. `zipalign`'s `ZipEntry::compareHeaders()` ends with `strcmp(CD name, LFH name)`, hence one
warning each. An asset at the archive root (`assets/index.html`) has no separator, so you see
**zero** warnings until you add a subdirectory.

Why it is harmless — and why the assertion must be on the **shipped** file, not on "were there
warnings":

| stage | entries with LFH name != CD name | zipalign warnings |
|---|---|---|
| `aapt2 link` output (`base.apk`) | N (the nested assets) | **N** |
| after `zipalign` (`aligned.apk`) | 0 | **0** |
| shipped (signed) APK | 0 | **0** |

`zipalign` rebuilds the local headers **from the central directory**, so it normalises the
backslashes on the way through — its own output is clean. And `apksigner` **hard-refuses** such an
APK (`com.android.apksig.zip.ZipFormatException: Name mismatch between Local File Header and
Central Directory`, rc=1), so the defect is structurally unable to ship.

⇒ Assert it yourself, by parsing the EOCD + central directory and comparing each entry's LFH name to
its CD name byte-for-byte. Do **not** assert "the build printed no warnings" — `zipalign` exits 0
either way, and the warning scrolls past in a long build log.

How to localise it if you hit a variant: pull `ZipEntry.cpp` / `ZipFile.cpp` / `ZipAlign.cpp` from
`aosp-mirror/platform_build`, then rebuild each entry into a standalone zip **preserving its raw
LFH+CD bytes** (rewriting only the 4-byte local-header offset) and feed each to `zipalign`. The hits
name the culprits; a raw byte dump of LFH vs CD then shows the actual difference.

Plus these content assertions, which are the ones that actually catch a bad build:

- `assets/index.html` inside the APK is **byte-identical** to the source page (sha1), and its line
  endings survived (`\r\n` count unchanged if the source is CRLF).
- `classes.dex` starts with `dex\n`, and contains the expected class name **and** the strings the
  wrapper depends on (the reserved hostname, the JS bridge name).
- `AndroidManifest.xml` is present; `classes.dex` appears exactly once.

⚠ **Assert symbol names as whole strings, not substrings.** `b'aiAbort' in dex` stays green when the
method is renamed to `aiAbortZZZ` — and since the shim calls `native.aiAbort(...)` directly, **nothing
in the chain reports the rename** until the feature silently no-ops on a device. Parse the dex
`string_ids` table and require exact equality:

```
header: string_ids_size @56, string_ids_off @60
each id: 4-byte offset -> string_data_item = uleb128 utf16_size + MUTF-8 bytes + 0x00
         (MUTF-8 encodes U+0000 as C0 80, so no embedded NUL)
```

Method names and type descriptors (`Lpkg/Class;`) live in that table as whole strings, so exact
matching works for them. Things that only exist as a *fragment* of a longer literal (e.g. a JS
expression built at runtime) can only be matched as substrings — write those assertions separately
and say in the message that they are the weak tier.

⚠ **Always pair a "this is present" assertion with a "this is absent" control** (a type descriptor
that does not exist must not be found), or the assertion may be **vacuously true**.

## 5. The false-greens that cost the most

**javac exits 0 even when it fails to compile anything, and d8 "succeeds" on an empty jar.**

If you write an experiment loop like:

```bash
javac ... -d out $SRCS >/dev/null 2>&1
d8 --output out2 out.jar     # reports success!
```

...you will see a row of ✅ and conclude "this configuration works". It does not — nothing was
compiled. This is how a wrong root-cause conclusion gets locked in.

Guard every experiment with a count:

```bash
N=$(find out -name '*.class' | wc -l)
[ "$N" -eq 0 ] && { echo "compile failed — this row proves nothing"; continue; }
```

And put the same guard in the real build script (`NCLASS >= <expected>`), because the same trap is
waiting there.

**A harness that dies mid-run makes "0 red" indistinguishable from "all green".**

Inject a deliberate defect to prove your assertions are not vacuous — then note that if the injection
breaks the harness itself (a bad indent inside an embedded script is enough), it prints **no
failures at all**. Counting red lines yields `0`, which is exactly what a clean run yields.

⇒ Before comparing a red-line set, assert the harness **reached its summary line**:

```python
check('== PASS ==' in out or '== FAIL ==' in out, 'harness ran to completion')
```

Same family as "a driver bug disguised as a product bug" — but this one disguises itself as
**success**, which is worse, because you never go looking.

**A `rm`/cleanup failure can be silent, and the residue becomes next run's ground truth.**

In a script using `set -uo pipefail` (**no `-e`**), a failing `rm -rf` does not stop anything. The
same line under `set -e` aborts loudly — so the identical code is loud in one script and mute in
another. Two things to know:

- The failure can be a **race**, not a broken delete: if the directory was just written by a child
  process you only `kill`ed (whose `EXIT` trap has not run yet), the file is still open and Windows
  refuses the delete. It succeeds seconds later. Don't go spelunking in the delete tooling — **check
  ordering first.**
- What makes it worth fixing is the consequence: the residue is the previous run's recorded
  fixtures, and the test compares against them **as ground truth**. A run that fails to produce one
  will happily compare against last run's copy and pass.

⇒ Stop the child (and `wait` for it to actually exit) → delete → **read back and confirm** → refuse
to continue if it is still there. And reverse-test that gate: hold a file open from another process
and check the gate really refuses.

⚠ Any file a probe creates should be deleted unconditionally — register the cleanup with `atexit`
(or equivalent) so it covers the normal exit, an assertion-failure `sys.exit`, **and** an exception.
A single `rmtree` at the end of the script only covers the first.

## 6. Icons from an avatar image

GitHub avatars: `https://avatars.githubusercontent.com/u/<id>?s=512`. ⚠ GitHub does **not upscale**
— if the original is 460×460 you get 460, so don't hardcode 512.

An adaptive icon is a 108dp canvas of which only the central 72dp (2/3) is guaranteed visible.
Either full-bleed the image (launcher crops the edges) or scale the subject into the safe zone.
**Always render a preview** with the outer sixth dimmed and look at it — the crop constants are a
visual judgement, not a computation.

If `pip install Pillow` is unavailable (proxy blocks PyPI), you do not need it: PNG is
`IHDR + zlib(IDAT) + IEND`, so a ~120-line stdlib `zlib` decoder/encoder plus area-average
downscaling covers icon generation completely. Pure stdlib also keeps the tool reproducible.

## 7. Shipping it

Source goes in the repo (a branch is fine — a branch that only *adds* files keeps the page as the
single source of truth; copy it in at build time rather than committing a second copy).

The APK is a build artifact: `.gitignore` it and attach it to a **GitHub Release** instead, so the
phone gets a download URL. Upload via `POST https://uploads.github.com/repos/{o}/{r}/releases/{id}/assets?name=...`.

⚠ A **debug** keystore (password `android`, same as Android Studio's) is worth committing: it makes
rebuilds produce the same signature, so updates install over the old version instead of demanding
an uninstall. Label it clearly as debug — it can never go to the Play Store.

⚠⚠ **Re-check the release after every rebuild.** The release asset is a *second copy* of the APK, and
it does not update itself. A release that still holds the pre-font / pre-feature build is the worst
kind of stale: the user downloads from the URL you gave them and silently gets the old app. Compare
`size`/`created_at` of the asset against the local file before you call anything done — and if the
in-app `versionName` did not change either, say so, because two different builds then carry the same
version label.

## 8. State the limits honestly

Without a device or emulator you have **not** verified that the app installs and runs. Say so.
Static verification (manifest, signature, alignment, dex contents, byte-identical assets) is strong
evidence, but it is not the same claim. Don't let a green checklist imply "it works on a phone".

Name the specific gaps rather than one vague disclaimer. For a wrapper with a JS bridge and an API
forwarder, the honest list is:

1. **The actual delivery timing of `evaluateJavascript`.** A desktop test hands the strings to the
   shim directly; in a real WebView they are posted asynchronously to the JS thread. It should be
   order-preserving (same thread, FIFO), but that was **not measured**.
2. **Actually reaching the remote service.** If the build machine cannot resolve or connect to it
   (a blocked proxy, for instance), the end-to-end path is unverified no matter how many local
   assertions pass.
3. **No device / emulator run at all** — so "installs, launches, and streams" is still an open
   question, not a verified fact.
