# Email Intake for Zotero — Architectural Design

**Status**: adopted, 2026-08-13. This is the architecture of record for the plugin, and it is a LIVING document: when implementation planning or implementation itself changes a decision recorded here, this file is updated in the same commit as that change. A divergence between this document and the code is a defect in one of them, never an accepted state.

**How it was produced.** Two specialists — a Zotero-platform specialist and a software-engineering specialist — reviewed an initial draft across five adversarial rounds, arguing to concurrence. Every claim below about Zotero, ZotMoov, Better BibTeX, and Attachment Scanner behaviour was verified against those projects' source, or against a running Zotero 9.0.6 instance, rather than inferred. Both specialists reversed at least one position during review, each after locating an error in its own reasoning. The full argument record is retained outside this repo; this document is its settled output.

**Provenance convention**: each section carries a `[src: …]` marker naming the review spec it came from. `zot` = the Zotero-platform specialist, `SE` = the software-engineering specialist, `R1`–`R5` = review round. `merged` = reconciled from both reviews. `unchanged` = carried from the initial draft untouched by any spec. The markers are retained because they record which claims were independently cross-validated and which were authored once.

**Reading order for an implementer.** "Assertion" and "Why the plugin wins where a script cannot" carry the whole architectural argument. "Verified substrate facts" is the evidence base — do not re-derive it. The numbered design constraints are the invariants the code must hold. Everything from "Resolved questions" onward is decided rather than open, with the single exception explicitly marked open under "Known residuals".

---

## Assertion

[src: unchanged]

Build it as a **Notifier-observing promotion plugin**, not as a drag-drop interceptor and not as an external script. The plugin watches for standalone attachments whose file is an email, and *promotes* them: parses headers, mints a fully-populated `email` parent item, reparents the attachment. It then does nothing else — ZotMoov and Better BibTeX fire on their own because the item was born in the desktop client. That last clause is the entire architectural argument, and it is the reason the plugin is strictly better than the Python-script alternative.

## Why the plugin wins where a script cannot

[src: unchanged]

The knowledge doc `zotero plugin automation gates for api-created items.md` establishes that Web-API-created items are gated out of exactly the two automations wanted here:

- ZotMoov pushes every object arriving via `Zotero.Sync.Data.Local._saveObjectFromJSON` onto its automove ignore list (`process_synced_files` ships `false`), and independently forces `ignore_linked = true` in the automove path, which skips linked-file attachments outright. Two gates, each alone sufficient.
- BBT's assignment gate is `if (current && !replace) return null`, and the desktop client is where its `items-changed` observer runs.

An in-client plugin sidesteps both by construction. It creates a normal local item; ZotMoov's notifier observer sees a normal local add; BBT's observer sees a normal local add. **No integration code with either plugin is needed or wanted.** The design's central discipline is to touch neither plugin's API — coupling to `Zotero.ZotMoov.move()` or to BBT internals would import their version drift. Emit a correct item and let the ecosystem react.

**One environmental prerequisite is NOT satisfiable by this plugin's code, and it must be stated because "let the ecosystem react" otherwise reads as requiring nothing of the user.** ZotMoov filters automove candidates through `allowed_fileext`, whose shipped default is `["pdf","epub","docx","djvu"]`. An `.eml` is filtered out before any of the user's other ZotMoov settings are consulted, so with a stock ZotMoov the promoted attachment is renamed correctly and then simply stays in Zotero storage. Measured 2026-08-16 on Zotero 9.0.6: with the stock allowlist the file remained at `~/Zotero/storage/{key}`; with `eml` appended it filed to `{dst_dir}/E-mail/Public/` on the next drop. **The user must add `eml` to `extensions.zotmoov.allowed_fileext`**, and no amount of correctness on this side substitutes for it.

**Adding `eml` to that allowlist has a consequence worth stating in the same breath, because it is a hazard this design creates rather than one it inherits.** Once `.eml` is allowlisted, ZotMoov acts on *every* dropped `.eml` independently of this plugin. The observer-priority ordering is what keeps that benign: this plugin registers at priority 50 and ZotMoov at 100, so promotion and reparenting complete before ZotMoov's callback resolves `%T`, which then reads `E-mail`. If this plugin's observer is disabled or throws, ZotMoov still fires, resolves `%T` against a parentless attachment, and files the message under `{dst_dir}/Attachment/` — where it is neither lost nor findable. Verified by construction on 2026-08-16 by disabling the master pref and dropping a message: it filed to `Attachment/`, and the subsequent menu-command promotion could not relocate it, because `_doExecute` splices processed ids out of ZotMoov's queue and the promotion's `modify` event therefore had nothing left to act on. The priority-50 registration is load-bearing for file placement, not only for the notifier ordering it was chosen for.

## Verified substrate facts this design rests on

[src: unchanged, plus row 7 third-consequence paragraph]

Confirmed live against the running instance (Zotero 9.0.6, local API at `127.0.0.1:23119`) and against the cloned sources in this workspace:

| Fact | Value | Source |
|---|---|---|
| `email` item type fields | `subject`, `abstractNote`, `date`, `DOI`, `citationKey`, `url`, `accessDate`, `shortTitle`, `language`, `rights`, `extra` | `GET /api/itemTypeFields?itemType=email` |
| `email` creator types | `author`, `contributor`, `recipient`, `translator` | `GET /api/itemTypeCreatorTypes?itemType=email` |
| `email` localized type name | `E-mail` | `GET /api/itemTypes` |
| ZotMoov observer registration | `registerObserver(cb, ['item'], 'zotmoov', 100)` | `zotmoov/src/05-zotmoov-bindings.js:10` |
| ZotMoov automove debounce | `auto_process_delay` = 5000 ms | `zotmoov/prefs.js` |
| ZotMoov automove default | `enable_automove` = true, `file_behavior` = `move` | `zotmoov/prefs.js` |
| ZotMoov extension allowlist | `allowed_fileext` = `["pdf","epub","docx","djvu"]` — **`eml` absent by default** | `zotmoov/prefs.js` |
| User's ZotMoov template | `{%T}/{%j}/{%a}` into `~/Dropbox/zotero_base_directory` | live `prefs.js` |
| BBT autofill delay | `fillKeyAfter` = 2 s | knowledge doc § "Verified against the installed build" |
| Zotero's own email awareness | none — no `message/rfc822`, `.eml`, or `.msg` string anywhere in `chrome/` | grep over cloned `zotero` |
| SQLite pragmas | `locking_mode=EXCLUSIVE`, `journal_mode=WAL`, `synchronous=NORMAL` | `db.js:1409-1423` |

Two consequences fall straight out of the table. First, `%j` (publication) does not exist on `email`, so the bracketed group is dropped and the resulting path is `E-mail/{sender-lastname}/` — a clean two-segment result, no `//` artifact, no `undefined_str`. The user's existing template needs no change. Second, `citationKey` is a real field on the type, so BBT's default `auth.lower + shorttitle(3,3) + year` formula resolves normally once sender, subject, and date are set.

A third consequence, verified against the Zotero global schema (version 42): `email` declares `{"field": "subject", "baseField": "title"}` and marks `author` as `primary: true`. So `item.getField('title')` returns the subject and `Zotero.CreatorTypes.getPrimaryIDForType` returns `author` — which is why BBT's `shorttitle`/`auth` and ZotMoov's `%a` both work with no special handling. Nothing in the mapper needs to compensate for the type being unusual.

## Field and creator mapping contract

[src: zot R1-FQ4, row 7]

| Zotero field | Source header | Normalization |
|---|---|---|
| `subject` (base `title`) | `Subject:` | RFC 2047 decode, unfold whitespace. Do **not** strip `Re:`/`Fwd:` — that would change `shorttitle` and therefore the citekey, and a reply is a different message |
| creator `author` | `From:` | two-field mode by default, with a rule-governed fallback to single-field |
| creator `recipient` | `To:` | pref-capped count, default 0 (off) |
| `date` | `Date:` | parse RFC 5322, then write **ISO 8601** `YYYY-MM-DD`, not the RFC string |
| `extra` | `Message-ID:` | one line, `Message-ID: <local@domain>` — store the angle brackets exactly as the header carries them, and pass the same bracketed form to the tier-3 `addCondition('extra','contains', …)` lookup; a mismatch between the stored and searched forms makes the duplicate check silently never fire |
| `language` | `Content-Language:` if present | else empty |
| `abstractNote` | — | empty; populating it would require parsing the body, which the security posture forbids |
| `url`, `accessDate`, `DOI`, `rights`, `shortTitle` | — | empty |

Creator-mode fallback rule: `Last, First` → split on the comma; else 2–3 whitespace-separated tokens with no organisational keyword → last token is `lastName` and the remainder `firstName`; else (organisational keyword, ≥4 tokens, or no display name at all) → single-field mode carrying the display name, or the address local-part when there is no display name. Always two-field is wrong for `"Marketing Team" <…>` and `"Public, Jane Q." <…>`; always single-field is worse, because `_format_authors` reads `lastName`, which in single-field mode holds the whole string — producing a directory literally named `Jane Q. Public`. Enumerate these cases as parser fixtures; the Zotero-free parser/mapper seam is what makes them plain-object assertions.

**Zotero will not auto-rename the attachment file, and the design must do it explicitly.** `Zotero.Attachments.shouldAutoRenameAttachment` gates on `isRenameAllowedForType(contentType)`, which tests the `autoRenameFiles.fileTypes` pref, whose shipped default is `pref("extensions.zotero.autoRenameFiles.fileTypes", "application/pdf,application/epub+zip")`. An EML attachment is therefore never renamed, and ZotMoov will file whatever name the mail client exported — `RE_ Budget review.eml`, or a GUID. After reparenting, call the same three things `RecognizeDocument._processItem` calls — `Zotero.Attachments.getFileBaseNameFromItem(parentItem, { attachmentTitle })`, `attachment.renameAttachmentFile(newName, { overwrite: false, unique: true })`, and `attachment.setAutoAttachmentTitle()` — but call them **unconditionally**. Do not copy `_processItem`'s enclosing `if (Zotero.Attachments.shouldAutoRenameAttachment(attachment))` guard: it returns false for this content type, so carrying it over silently reproduces the unrenamed result this paragraph exists to prevent.

## Rejected: intercepting the drop

[src: zot R5 re-issue, row 1 — supersedes zot R1-FQ1; SE's amend-before-apply Note A is discharged by this re-issue]

The drop-to-import path is `collectionViewItemTree.jsx` (and its twins in `collectionTree.jsx` / `zoteroPane.js`), which call `Zotero.Attachments.importFromFile` / `linkFromFile` from inside a React component method. There is no plugin hook there — Zotero 9's entire plugin API surface is `chrome/content/zotero/xpcom/pluginAPI/{itemPaneManager,itemTreeManager,menuManager}.js` plus `pluginAPIBase.mjs`, and none of them claims a file drop or a content type. The three ways in are all bad:

1. Monkey-patch `Zotero.Attachments.importFromFile` — fires for *every* attachment in the application, PDFs included. Enormous blast radius for a narrow feature, and per both BBT and ZotMoov, monkey-patches do not un-apply on disable.
2. Patch the tree component — worse than "no stability contract". `onDrop` is declared as an instance arrow-property (`onDrop = async (event, row) => {`), not a prototype method, so it is installed per instance at construction and cannot be patched on the prototype at all.
3. Author an import translator — disqualified twice over: `translators/CLAUDE.md` forbids hand-authoring translators, UUIDs, or test cases outside Scaffold, and the drag-drop path never consults translators, so a translator would only serve `File → Import…`, not the requested UX.

The Notifier path gets the same user-visible behavior (drag a file, get a citable item) with zero patching. Attachment Scanner is the in-substrate proof that a non-trivial plugin can be built on Notifier + ItemTreeManager + pref observers alone.

**Add a second, user-initiated entry point to the same promoter.** Register a `Zotero.MenuManager` item-context command ("Promote to E-mail item") that runs the identical promotion on the selected standalone attachments. It costs nothing beyond the menu registration once the promoter exists, and it buys three things: a deterministic recovery path when auto-promotion is disabled or a parse failed, a way to exercise the promoter without performing a drag during development, and the same belt-and-suspenders shape Attachment Scanner uses. It is also the command the duplicate-resolution flow extends.

Two mechanical constraints govern the observer registration — priority and the `async`/`await` contract. Both are stated with their justification in constraint 2 below, because both exist to protect the sequencing guarantee rather than the interception choice.

## Component architecture

[src: SE R1-FQ1, row 4, with amend-before-apply Note B applied — four files reduced to three]

Three files at EML-only — `bootstrap.js`, `intake.js`, `message.js` — and four with MSG, adding `cfb.js` as the one genuinely separable unit. One seam, no cycles. The seam is Zotero-coupled versus Zotero-free, and it is the only boundary in this plugin that a mechanical check can enforce or that buys anything at test time. `loadSubScript` evaluates every file into one shared global scope — there is no module system, no import graph, and no visibility — so any finer split is a naming convention the runtime will not defend. The boundary below is therefore paired with a CI assertion (see the security section): neither `message.js` nor `cfb.js` may contain the string `Zotero.`. The rule is over the Zotero-free half by definition, not over a fixed filename list: any file added on that side of the seam is added to the grep in the same commit.

```text
bootstrap.js   Mozilla lifecycle: install/startup/shutdown/uninstall, onMainWindowLoad/Unload.
               Adopted from Attachment Scanner's reusable loader. Registers and unregisters.
   |
   +-- intake.js    All Zotero coupling. The Notifier observer (priority 50, async, awaits),
   |                the promoter, the in-flight guard, the failure contract, the menu commands.
   |                Observer and promoter live together because they share the guard and the
   |                failure contract; splitting them puts one invariant across two files.
   |
   +-- message.js   Zotero-free. Detection (extension + magic bytes), the ParsedMessage
   |                vocabulary, parseHeaders(text) -> ParsedMessage, and the mapper to a
   |                Zotero field/creator payload. Detection and mapping are functions, not
   |                modules: each has one caller and an interface as wide as its body.
   |
   +-- cfb.js       (MSG only) Read-only Compound File Binary reader. bytes -> {stream: bytes}.
                    The one genuinely separable unit — a self-contained binary-format reader
                    with a narrow interface, which is the deep-module shape.
```

[src: SE R1-FQ2, row 5, plus main-agent fold of the R4 test-loading resolution]

The Zotero-free half being Zotero-free is deliberate and load-bearing: it is what makes this testable without launching Zotero, which is the single biggest practical obstacle to plugin development. The obstacle usually assumed to block that — "a bootstrap plugin has no test runner, and adding one means adding a build step" — does not apply. `node --test` ships with Node, and a `loadSubScript`-style file is a plain script: a ~10-line shim loads it into a Node context with zero dependencies and no bundler.

The deliverable of that decision is the fixture corpus, not a test count. `test/fixtures/eml/` holds **synthesised** `.eml` files, deliberately including the ugly ones — non-ASCII display names, a folded 400-character subject, `Reply-To` differing from `From`, a missing `Date`, a Base64 encoded-word split across a fold — each paired with an expected-payload JSON. One test asserts `map(parse(bytes))` deep-equals the expected payload. That corpus is also what lets the MSG reader be developed later against a known-good contract behind the same interface.

**The fixtures are synthesised rather than collected, and that is a release-blocking constraint rather than a preference.** Drawing them from the user's own mail — the original instruction here — would publish third-party personal data from a repo whose stated end state is public, contradicting the log-hygiene rule in the security section, which is the same argument one layer down. A real message may be read as a shape reference and is then rewritten with fabricated participants on **RFC 2606 reserved domains** (`example.com`, `example.org`, `example.net`), preserving every structural property under test; the reserved-domain rule is what makes the constraint checkable by reading the `From`, `To` and `Reply-To` lines rather than by trusting the author. Real correspondence used as a shape reference lives in `test/fixtures/local/`, which is gitignored and never committed. This closes D3.

The primary loading mechanism is a trailing `if (typeof module !== 'undefined') module.exports = {…}` guard, which Node honours and the sandbox ignores. It is correct by construction. Authoring the pure modules as ES modules and loading them via `ChromeUtils.importESModule` is the alternative; it is unverified from a plugin root URI and is a Phase-1 spike. If the spike succeeds, prefer ESM then, when preferring it costs nothing.

Because a second execution environment can diverge from the real one, keep one in-app affordance for the half that cannot be tested outside Zotero, following ZotMoov's `wildcard._test(item)` precedent: `Zotero.EmailIntake._test(path)` runs detect → parse → map on a file and returns the payload without writing anything.

## The design constraints that actually shape the code

### 1. Save the parent item exactly once, fully populated, in one transaction with the reparent

[src: zot R1-FQ3, row 2, with SE R3's regenerate-key menu action appended]

BBT computes the key from whatever metadata is present at the moment its observer fires, then never recomputes (the gate is `const current = item.getField('citationKey'); if (current && !replace) return null`, with `resetKeyOnChange` defaulting false). Create-then-fill produces a permanently wrong key that looks correct in the field pane. So the promoter builds the complete item in memory and writes it once.

Use a single `Zotero.DB.executeTransaction` covering both the parent save and the reparent — the pattern Zotero core itself uses in `RecognizeDocument._processItem` (`await parentItem.save()` then `attachment.parentID = parentItem.id; await attachment.save()`). This produces one notifier commit whose `eventOrder` is `['add','modify',…]`, so BBT and ZotMoov each see the parent `add` before the attachment `modify` in a defined order. Nesting this transaction inside the notifier callback is safe because `commitTransaction` clears `this._transactionID` before running commit callbacks; comment that in the code, because it is not obvious.

Two corollaries. (a) **Never write `citationKey` in the create payload.** It is a live writable field on the `email` type, so pinning looks available — but pinning disables BBT's postfix collision-disambiguation and hands uniqueness to this plugin, and one sender in one year is a high-collision population. (b) **Clearing `citationKey` to `''` to force regeneration is a repair lever for an already-wrong batch, not a creation contract.** On the creation path it buys a second save, a second `items-changed`, and a keyless window in exchange for nothing, and it couples to a `changed?.[item.id]?.includes("citationKey")` branch that did not exist in BBT 9.0.23. Ship it as a `Re-promote / regenerate key` item-menu action so every failure path is user-correctable and the promoter does not have to be infallible.

### 2. Ordering against ZotMoov is a sequencing guarantee, not a race

[src: merged spec 1, row 3 — supersedes SE R1-FQ4 and zot R1-FQ2]

The only way to lose it is to hand control back before the work is done. `Zotero.Notifier.trigger` builds an observer order sorted ascending on priority and iterates it, awaiting each handler in turn — `await Promise.resolve(ref.notify(event, type, ids, extraData))` (`notifier.js`, §`this.trigger`). ZotMoov registers at exactly 100 (`registerObserver(this._callback, ['item'], 'zotmoov', 100)`, `src/05-zotmoov-bindings.js:10`). So an observer registered below 100 whose `notify` is `async` and awaits promotion has fully completed before `ZotMoovNotifyCallback.notify` is entered at all. There is no window and no detection-and-repair machinery is needed.

Two mechanical constraints on the registration:

- **Register at 50 — never at 0.** `registerObserver` stores `priority: priority || false`, and `_getObserverOrder`'s `order.push` then writes `priority: _observers[i].priority || 100`, coercing that `false` back to the default before the comparator runs — which is why the comparator's **three** `priority === false` branches are unreachable dead code. So `0` — the natural way to write "absolutely first" — silently registers at **average (100)**, tying with ZotMoov and with every observer that omitted a priority; `Array.prototype.sort` is stable, so the tie resolves by registration order, i.e. plugin load order. The failure is intermittent rather than consistent, which is harder to diagnose than a clean demotion would be. Valid values are 1-99.
- **`notify` must be `async` and must await the promotion**, because the guarantee comes from `trigger` awaiting the promise the observer returns. A handler that starts promotion and returns reverts to the race this design no longer has.

Three corroborating facts. (a) A nested transaction inside the observer does not deadlock: `commitTransaction` sets `this._transactionID = null` *before* running commit callbacks, and `Zotero.Notifier.commit` is registered as one (`Zotero.DB.addCallback('commit', …)`, `zotero.js:541`), so the `while (this._transactionID)` gate in `executeTransaction` is already clear. (b) ZotMoov's timer is a *trailing* debounce that resets on every item event application-wide — `addCallback` and `modifyCallback` both `clearTimeout` and re-arm, and `_execute` re-arms again while a lock is held or a sync is running — so it measures quiescence rather than elapsed time since the drop, and the promoter's own saves push it further out. Comfort margin, not the guarantee. (c) ZotMoov acts on the right item regardless: `move()` opens with `if (!item.isFileAttachment()) continue;`, so the new parent regular item is skipped and only the attachment moves, by which point `ZotMoovWildcard.process_string` swaps it for its parent.

**No compensation path.** A recovery routine for "ZotMoov moved the file before we promoted" would be unreachable in normal operation, and an unexercised recovery path is a liability rather than insurance — written once, never run, wrong the one time it fires. What is retained is a *detector*: on entry, if the candidate attachment is already a linked file under ZotMoov's destination directory, log one structured warning through `logSafe` and skip.

**Take no dependency on ZotMoov's API** — neither `addKeysToIgnore` nor a direct `Zotero.ZotMoov.move()`. Neither is reachable through a public surface in any case: both live on `ZotMoovBindings`, which ZotMoov's bootstrap holds in a module-scope variable and never attaches to `Zotero.ZotMoov`, so reaching them means two private-field hops through the menu helper. And the failure mode when a field is renamed is a `TypeError` inside a notifier callback, which the dispatcher swallows into `Zotero.logError` — silent loss of sequencing. A direct `move()` call would additionally move filing policy into this plugin, overriding whatever `file_behavior` the user configured.

The only insurance the design needs is the idempotency guard in constraint 3: skip any attachment that already has a `parentItemID`. That makes the promoter safe to re-enter from the menu command, from a re-drop, and from any future change in observer scheduling.

### 3. Idempotency, in three layers

[src: SE R1-FQ3, row 6, with amend-before-apply Note C applied — the withdrawn promote-and-tag clause removed]

One layer answers only one of the three failure scenarios. Reparenting saves the attachment, which re-fires the Notifier `add`/`modify` path.

*Re-entrancy* is handled by convergence, not by a flag: skip any attachment that already has a parent. This is the strongest guard available because a convergence guard cannot be leaked — Attachment Scanner terminates its own `saveTx()`-triggered `modify` recursion on convergence alone, with no sentinel anywhere in the plugin. An in-memory in-flight key set is kept as an optimisation on top, never as the correctness argument, and it is released in a `finally` — "clear on completion" leaves a poisoned entry for the rest of the session whenever a promotion throws. Key that set on `Message-ID`, never on the attachment key or id, because a ZotMoov move reissues attachment keys.

*Crash-mid-promotion* is handled by making it unreachable. Parse and map first; then wrap parent-create and reparent in a single `Zotero.DB.executeTransaction`, per constraint 1. Two `saveTx()` calls are two transactions and admit exactly the orphan-parent-with-a-cite-key state this design most wants to avoid.

*The same file dropped twice* is handled by neither of the above — two drops are two distinct attachment items with two distinct keys, and every guard above passes. Duplicate handling is resolved at open question 1; this constraint covers only re-entrancy, atomicity, and the failure path.

### 4. Never destroy user data on a parse failure

[src: unchanged]

If parsing fails or a header is missing, the correct behavior is to *leave the standalone attachment exactly as it is* and log via the single `logSafe` routine. This inherits Attachment Scanner's stated principle directly. A half-promoted item with a garbage citekey is worse than no promotion, because the citekey is the thing Obsidian will pin to.

## Format support

[src: zot R1-FQ6, row 8]

`.eml` is RFC 5322 — plain text headers, `=?UTF-8?B?…?=` RFC 2047 encoded-words, folded continuation lines. Hand-writing a header-only parser is a genuinely small job **and every primitive it needs is already injected into the plugin's sandbox**: `Zotero.Plugins._loadScope` builds the bootstrap scope with `wantGlobalProperties: ["atob","btoa","Blob","crypto","CSS","ChromeUtils","DOMParser","fetch","File","FileReader","TextDecoder","TextEncoder","URL","URLSearchParams","XMLHttpRequest"]` and then assigns `Zotero, ChromeWorker, IOUtils, Localization, PathUtils, Services, Worker, XMLSerializer` plus the timer functions. So `atob` covers `=?…?B?…?=`, `TextDecoder(charset)` covers the WHATWG encoding set (every charset real encoded-words use), and `IOUtils.read(path, { maxBytes })` covers the capped byte access (keep the `Uint8Array`; `Zotero.File.getContentsAsync(path, charset, maxLength)` is the supported decoded-string equivalent, but is not byte-transparent). Do **not** bundle a MIME library: full MIME parsers parse bodies, which the security posture forbids, and bundling forces a build step for a function you must never call.

There is nothing to delegate to. `nsIMimeConverter` and `nsIMsgHeaderParser` are Thunderbird (comm-central) interfaces, not Firefox ones, and grepping the Zotero tree for `rfc822`, `.eml`, and `vnd.ms-outlook` returns zero hits.

`.msg` is an OLE2 / Compound File Binary container with Outlook MAPI property streams — but it is cheaper than it looks. Most `.msg` files that traversed SMTP carry the **entire original RFC 5322 header block verbatim** in a single MAPI property, `PR_TRANSPORT_MESSAGE_HEADERS` (tag `0x007D`). Where present, the MSG path reduces to: read the CFB container, extract that one string stream, hand it to the EML header parser. Only Exchange-internal messages that never traversed SMTP need the per-property fallback map (`PR_SUBJECT` 0x0037, `PR_SENDER_NAME` 0x0C1A, `PR_SENDER_EMAIL_ADDRESS` 0x0C1F, `PR_CLIENT_SUBMIT_TIME` 0x0039 as a FILETIME, `PR_INTERNET_MESSAGE_ID` 0x1035). The irreducible work is therefore a read-only CFB reader (header, sector chains, directory entries, mini-stream), not a MAPI implementation.

Shape the parser interface accordingly: `parseHeaders(text) -> ParsedMessage` is the single implementation, `eml` supplies `text` by decoding the file, and `msg` supplies `text` by extracting `0x007D`. That is a cleaner seam than two parallel dialect parsers, and it means the MSG path inherits all of the EML path's fixtures.

`.mbox` is explicitly out of scope — it is a multi-message archive, so it is an import-many operation with a completely different UX, not a promotion.

## Repo layout and tooling

[src: merged spec 2, row 10 — supersedes SE R1-FQ5 and zot R1-FQ7]

**Option 1 (recommended) — vanilla JS, Attachment Scanner loader adopted rather than hand-rolled.** Flat: `bootstrap.js`, `manifest.json`, `prefs.js`, `preferences.xhtml`, `locale/en-US/*.ftl`, `skin/`, plus `src/` for the modules. No bundler; a `package.json` stub only so `node --test` can run the pure core.

The decisive fact is that Attachment Scanner's `bootstrap.js` is explicitly a reusable loader — its own header reads "This is a loader for general use. Only a few changes (mostly the object/plugin names) are needed to create a loader for another plugin" — and it supplies lifecycle, Fluent wiring, menu creation and teardown, preference-pane registration, and notifier registration by convention in ~340 debugged lines. The vanilla option is therefore not "hand-roll the plumbing"; it is "rename four constants", which removes most of what the TypeScript template would have been bought for. The remaining case for the template is a build step between source and shipped bytes, which is the wrong trade for a repo whose stated end state is public and auditable.

The Z9-fitness worry about this layout is unfounded: `strict_min_version: "6.999"` is a floor paired with `strict_max_version: "*"`, and grepping Attachment Scanner's two source files for `Components.utils.import`, `Cu.import`, `XPCOMUtils`, `Zotero.Promise`, `OS.File`, `Services.jsm`, and `nsIScriptableUnicodeConverter` returns zero hits — the shape is already ESM/Bluebird-clean.

**Keep `strict_min_version: "6.999"` and `strict_max_version: "*"`.** This plugin uses no Zotero-8-only API, so the Zotero 7 floor is correct and maximally compatible; narrowing to a Zotero 8 floor would cost compatibility for no gain. If a Z8-only API is later adopted, read the floor string off the Zotero 8 dev page rather than guessing it. The open ceiling is deliberate: a bounded ceiling buys nothing here and guarantees a future break that presents to the user as the plugin disappearing after a Zotero update. Both literals are established behaviourally, since `strict_min_version` appears nowhere in Zotero's own source — the check lives in the embedded Mozilla add-on manager. On a Zotero 9.0.6 profile, Attachment Scanner ships `"6.999"`/`"*"`, ZotMoov `"6.999"`/`"9.*"`, and Better BibTeX 9.0.55 `"8.0.1"`/`"10.*"`, all installed and enabled.

Three corrections applied at adoption, before any feature code:

1. `"use strict";` as the first line of every file. The donor is non-strict and leaks implicit globals — `let hasFile = hasBroken = hasDuplicates = … = false` declares only the first name, and the `for (attachmentID of …)` loop variables are undeclared. In an async function re-entered from a notifier loop that is shared mutable state across await points. One line eliminates the class.
2. Symmetric teardown. The donor's `init()` registers two item-tree columns and three `Services.prefs` observers and its `shutdown()` unregisters only the notifier observers, so disable-then-reenable in one session duplicates both and strands bound callbacks over a dead plugin object. Every `register*`/`addObserver` gets its matching removal, with observer references stored by name so removal is possible at all.
3. Drop what is not needed (progress window aside, item-tree columns) rather than carrying it dormant.

Release plumbing is borrowed from the TypeScript template's practice regardless of language — none of it requires a bundler — and extended by one line: the GitHub Actions workflow emits `update.json` carrying an `update_hash` (`sha256:…`) alongside `update_link`, which is the integrity control an auto-update channel owes its users.

Universal requirements either way: Fluent `.ftl` for all user-facing strings with `data-l10n-id` in markup, `IOUtils`/`PathUtils` for all file access, and no `Components.utils.import` or `XPCOMUtils.defineLazyGetter`.

## Security posture for a repo intended to go public

[src: SE R1-FQ6, row 11, with amend-before-apply Note D applied — two rows added to the table]

Stated as enforced invariants rather than preferences, because an invariant that lives only in a README erodes at the first convenient exception. Each item below is a forbidden token in a scoped file set, so the whole suite is ~30 lines of shell in CI — and the same mechanism enforces the architectural seam from the component section, so one check carries two arguments.

**Enforced invariants**

**Scan universes.** The rows below say "grep tree" and "grep tree-wide"; from Phase 3 those phrases are made precise, because taken literally they are unsatisfiable — the rows that DEFINE the banned tokens are themselves matches, and so is any scanner containing the patterns. Two universes, stated positively as the artifact each rule makes a claim about rather than as a blocklist of directories to skip:

- **`SHIPPED`** — what the XPI contains: `manifest.json`, `bootstrap.js`, `src/**`, `prefs.js`, `prefs.xhtml`, `locale/**`. The DOM, logging and chrome-registration rows scan this.
- **`REPO-MINUS-DOCS`** — everything git tracks or would ship, except the documentation surface (`docs/**`, `sidecars/**`) and except `test/fixtures/**`. Only the debug-bridge row scans this.

**The asymmetry between those two is the finding, and it must not be tidied away.** A DOM built from message content, a second logging call site and a chrome registration can only go wrong inside the shipped plugin, so `SHIPPED` preserves those rules whole — the realistic DOM risk the paragraph below names, a future item-pane preview, is shipped code. A dependence on the BBT debug bridge is not like them: the bridge is a **separately installed plugin** whose documented purpose is remote code execution, POSTing arbitrary JavaScript into a running Zotero from an editor or a test harness. Depending on it is therefore a `test/`, `scripts/`, CI or README fact and can never appear in the XPI. Scoping that row to `SHIPPED` would leave it scanning paths on which its risk cannot occur — a rule matching nothing while reading as protective, which is the failure mode the whole executable-check idea exists to prevent. A later reader harmonising the four universes into one would reintroduce exactly that.

`test/fixtures/**` is carved out of `REPO-MINUS-DOCS` on two grounds. Fixtures are message content rather than code, and a debug-bridge dependence cannot live in an `.eml`. And the suite prints the matched text of every finding, while `test/fixtures/local/` is gitignored real correspondence — so a fixture-scanning rule would echo lines of real email into CI output on a false positive.

Consequence for the negative control: each seeded violation must land inside its own rule's universe. A seed outside it produces no finding, and the missing finding reads as an inert pattern — the control's true-positive signal, fired by a misplaced seed. The debug-bridge seed belongs in `test/` (outside `test/fixtures/`), where a real dependence would live; the others belong in the code surface.

A related precisification in the strict-mode row: the glob is `src/*.js` and `bootstrap.js` deliberately. `src/probe.sys.mjs` is an ES module, ESM is strict by default, and a `"use strict";` directive in one is redundant rather than required — so that file's absence from the rule is correct by statement rather than by accident of the glob.

| Invariant | Enforcement |
|---|---|
| No network egress of any kind | grep tree for `fetch(`, `XMLHttpRequest`, `Zotero.HTTP`, `newChannel`, `WebSocket`, `import(`; `manifest.json` declares no host permissions |
| No DOM constructed from message content | grep tree-wide for `DOMParser`, `innerHTML`, `outerHTML`, `createElement` |
| Pure core stays Zotero-free | grep `src/message.js` and `src/cfb.js` for `Zotero.` — the pure set is enumerated, not globbed, so adding a pure file forces a deliberate edit here rather than silently escaping the check |
| No dependence on the BBT debug bridge | grep tree for `debug-bridge` |
| One logging routine, no message content in logs | grep for `Zotero.logError(` outside the file defining `logSafe()` |
| No synchronous file reads | `grep -nE '\.(getBinaryContents\|getContents)\('` — matches the two synchronous readers (`file.js:135`, `file.js:158`) and not their `…Async` siblings; a bare `getBinaryContents` pattern is a prefix of `getBinaryContentsAsync` and would flag the supported call |
| Linear-time parsing | unfold and split with index scans and `slice`, never repeated concatenation or nested-quantifier regexes; a pathological fixture (one 200 KB single header value alternating whitespace and non-whitespace, one with 10,000 folded continuation lines) asserted to parse under a wall-clock bound |
| Bounded reads | unit test: a 256 MB fixture is declined, not parsed |
| Signed update channel | workflow emits `update_hash` (`sha256:…`) beside `update_link` |
| Strict mode everywhere | grep: every `src/*.js` begins `"use strict";` |

The no-DOM grep is deliberately **tree-wide** rather than scoped to the pure files. The pure files are already forbidden from touching anything Zotero, and the realistic place a DOM would be constructed from message content is the *coupled* side — a future item-pane section rendering a preview, or the progress summary interpolating a subject.

**Why "headers-only" is not itself the security control.** The durable property is *no HTML is rendered and no remote resource is fetched*, which follows from the no-network and no-DOM rows above. Headers-only is a scope decision with a security consequence. Stating it as the invariant means that the first reasonable feature request — a body snippet into `abstractNote` — silently removes the security claim along with the scope. State the property; let the scope move.

Note that the no-network invariant is genuinely a discipline rather than a capability boundary: `Zotero.Plugins._loadScope` grants the plugin sandbox both `fetch` and `XMLHttpRequest`. That is exactly the condition under which an executable check earns its keep rather than restating a platform guarantee.

**Header content is untrusted input that gets decoded before it is used.** RFC 2047 encoded-words mean the parser decodes attacker-controlled bytes and then uses the result, which is the canonicalisation ordering hazard: validate *after* decoding, not before. Three checks a general routine misses and that are all live here, because a decoded subject reaches `shorttitle`, then the cite-key, then `%b`, then a directory name: NUL bytes, CR/LF (header injection), and `../` traversal. One centralised `sanitizeHeaderValue()` at the mapper's output strips control characters, collapses folded whitespace, and caps length. Zotero and ZotMoov do sanitise in the normal path, but that is not a reason to emit un-canonicalised text across the boundary.

**How the pure parser signals an abort: it throws, and the message IS the code.** `parseHeaders` raises `new Error('E_TOO_LARGE')` when the header block has no terminator, and `new Error('E_HEADER_MALFORMED')` past the header-count cap. The coupled side's per-item `try/catch` maps a recognised code to `logSafe` and anything else to `E_UNEXPECTED`. A throw rather than a sentinel return is forced, not preferred: the pure-core rule forbids naming the host object in `src/message.js`, so that file cannot log for itself, and the existing signature returns a `ParsedMessage` unconditionally with no spare value to overload. The two caps are **998 characters** for a single sanitised header value and **1024 logical header lines** for a block — both stated here because this section previously named the operations with no numbers, and a cap with no value is not implementable.

**Bounded reads are not optional.** Take one capped read per message — `IOUtils.read(path, { maxBytes: 262144 })` — and keep the returned `Uint8Array`. Decode the structural header region from it with `TextDecoder('utf-8')` (RFC 5322 header structure is ASCII by construction; non-ASCII must arrive as encoded-words) and slice the array directly for Base64 and quoted-printable encoded-word payloads, which need exact bytes. Cap header count and abort on a missing header terminator.

Do **not** read via `Zotero.File.getBinaryContentsAsync`. Its own doc comment reads "This is quite slow and should only be used in tests" (`file.js:305-307`), and the reason is that it ends `return [...buf].map(x => String.fromCharCode(x)).join("")` — at a 256 KB cap that is ~262k spread iterations plus a 262k-element array plus a join, synchronously on the main thread, per message, before the parser starts. `Zotero.File.getContentsAsync(source, charset, maxLength)` is the supported chrome-side equivalent (`IOUtils.read` then one `TextDecoder` decode) and is correct wherever a decoded string is all that is wanted; it cannot be used for byte-exact work, because the Encoding Standard maps the `latin1` and `iso-8859-1` labels onto windows-1252, which is not byte-transparent at 0x80-0x9F.

**Content sniffing is the decision; the extension is only a filter.** Checking type by extension alone is insufficient — a PDF misnamed `.eml` must be declined, not parsed. Note separately that `attachmentContentType` is unusable as a detection key: `Zotero.MIME`'s sniffer table contains `["From", 'text/plain', 0]`, so an `.eml` beginning `From:` is typed `text/plain` while one beginning `Received:` falls through to the OS MIME registry.

**Log hygiene is release-blocking.** `Zotero.logError` on a parse failure is the natural place to dump the header block, and the debug log is what a user attaches to a public GitHub issue. Headers carry correspondent addresses and usually the subject. Exactly one `logSafe(attachmentKey, errorCode)` function exists; nothing else calls `Zotero.logError`.

**The CFB reader for the MSG phase is the single largest supply-chain surface in this plan** and the only place a dependency is likely to enter. It gets an explicit decision — vendor a reviewed implementation at a pinned commit, or write the minimal reader — not a default install.

**Preference surface stays near five** (enable/disable, claimed extensions, behaviour on parse failure, `Message-ID` handling, debug logging). The discipline that keeps it small: no preference may disable any row in the table above.

## Resolved questions

### 1. Dedup on `Message-ID` — RESOLVED

[src: zot R5 open-question-1 spec, row 12 — supersedes SE merged spec 3 and all four earlier duplicate specs from both reviews. **User decision 2026-08-13: withhold on the differ branch.**]

Yes, ON by default, with the disposition split on whether the two files are the same file. Write `Message-ID` to `extra` unconditionally. The lookup is a first-class `Zotero.Search` condition, not a quicksearch approximation: `searchConditions.js` generates the `field` template condition's `aliases` at runtime from `SELECT fieldName FROM fieldsCombined WHERE fieldName NOT IN ('accessDate','date','pages','section','seriesNumber','issue')`, and `extra` is in that set, so `s.addCondition('extra','contains', messageId)` hits `itemData.value` directly. Three tiers, cheapest first: `if (attachment.parentItemID) skip`; an in-memory `Set` of Message-IDs promoted during the current `notify`; then the search, scoped to `libraryID`.

On a hit, gated on a **present and syntactically valid** `Message-ID`, compare the dropped file against the matched item's `.eml` children. **Identical file** → reparent onto the existing item, tag the attachment `#auto-attached-duplicate`, count it in the batch summary; nothing is being decided, so there is no judgment for a confirmation to protect. **Differing file** → withhold: create no item, tag the standalone attachment `#duplicate-message`, count it, and leave it for the "Resolve duplicate…" command, which re-runs the lookup, names the matched item, and offers both "Attach to the existing item" and "Promote as a separate item anyway". Log through the single `logSafe(attachmentKey, errorCode)` routine — never header content. Do not record the match with `addRelatedItem`: Zotero relations are bidirectional and would write to the existing item; re-derive at command time.

The reparent branch gets the mirror command, **"Review auto-attached duplicate…"**, on an attachment carrying `#auto-attached-duplicate`: name the parent it was attached to, show the distinguishing headers of both copies, and offer **"Keep attached"** or **"Detach and promote as a separate item"**. Its payload is the same identification work — the user can see that a file was filed somewhere, and cannot see where or against what evidence, which is precisely what the command supplies. Both commands must offer both outcomes; a one-outcome resolution would decide, one layer later, the question its branch exists to leave open. One fixed tag per branch and never one tag per message — that is what separates these from a `msgid:`-per-message scheme, which would make the tag selector unusable.

**Mechanics of the same-file gate.** There is no cheap identity signal in the database, and the reason is structural. Under `file_behavior: move` every `.eml` child is a LINKED file, and Zotero never uploads linked files — `storageUtilities.js`'s `createUploadFile` throws `"Upload file must be an imported snapshot or file"` for `LINK_MODE_LINKED_FILE` — so `attachmentSyncedHash` and `storageModTime` are permanently null on exactly the items being compared. `item.attachmentHash` is not a cached value either; its own doc comment says it is "the hash of the file itself, not the last-known hash of the file on the storage server", and it calls `getFilePathAsync()` then `md5Async()`. The only free signal is `IOUtils.stat(path).size`.

**Resolve paths with `getFilePathAsync()`, never the synchronous `getFilePath()`.** The async form gates on `await OS.File.exists(path)` and returns `false` for a missing file; the sync form skips that check and returns a plausible path for a file that is not there. One call covers both link modes, which matters because the two sides differ: the newly dropped attachment is a STORED file at this moment (`importFromFile` copied it into `storage/`, and ZotMoov has not run yet), while the existing child is a LINKED file resolved through `Zotero.Attachments.resolveRelativePath` against `baseAttachmentPath`. Both variants call `_updateAttachmentStates`, which only touches in-memory caches — no DB write, no notifier event — so this is safe to call inside the observer.

**Comparison order, which is what keeps N children cheap.** (a) `existing.getAttachments()` with no argument — the signature is `getAttachments(includeTrashed)` and the default already filters trashed rows, which is what we want. (b) Filter by **filename extension, not `attachmentContentType`** — the `Zotero.MIME` sniffer table contains `["From", 'text/plain', 0]`, so an `.eml` beginning `From:` is typed `text/plain` while one beginning `Received:` falls through to the OS MIME registry; filtering on content type would silently skip half the set. (c) `IOUtils.stat` both sides and compare **size** first — differing size means not the same file, with no read. (d) Only on a size match, hash, and short-circuit on the first match.

**Hash the whole file; do not hash a capped prefix.** Two `.eml` files can share a size and a 256 KB prefix and differ afterwards — the very differences that motivate the gate (`Received:` chains, `List-*` headers, a footer) can fall on either side of any cap. A prefix hash is a sound negative test and a weak positive one, and here it would authorise an automatic write. Since the size check already eliminates almost everything for free, use `Zotero.Utilities.Internal.md5Async(path)` on the rare same-size branch: it streams through `nsICryptoHash` in chrome code. **Do not use `Zotero.File.getBinaryContentsAsync`** for this — it ends with `[...buf].map(x => String.fromCharCode(x)).join("")`, a full spread, per-byte map and join on the main thread, which at a 256 KB cap is ~262k iterations per comparison and is the single largest synchronous term the gate could add. If raw bytes are ever needed, `IOUtils.read(path, { maxBytes })` returns a `Uint8Array` directly.

**When the comparison cannot be made, withhold.** An unset or changed base path, a stale link, a missing file, or an empty `.eml` child set all yield no positive finding of sameness, and reparenting on an unread comparison is auto-attaching on a `Message-ID` alone — the disposition the split gate exists to avoid, reached by accident. The failure is also correlated with the case where reparenting is worst: a missing existing file usually means the library is already degraded, and adding a second child to a record whose first child is broken produces an item with one working and one broken attachment and no signal between them.

**Wrap each item's processing in its own try/catch inside the loop.** `Zotero.Notifier.trigger` calls each observer as `try { await Promise.resolve(ref.notify(…)) } catch (e) { Zotero.logError(e) }`, so an exception raised anywhere in our handler aborts the rest of the batch and is swallowed into the debug log — the user gets a partial drop with no explanation. The gate makes this reachable: `md5Async` returns `false` only on `NotFoundError` and re-throws every other error, and `IOUtils.read` throws unconditionally. Catch per item, route the failure to withhold, count it, and continue.

**Two consequences to record rather than fix.** (a) With Attachment Scanner installed and `scan_duplicates` on, the reparent branch causes a third-party plugin to write to the existing record: `checkAttachements` decides duplicates by content-type equality, and on a match runs `item.addTag(this.tagDuplicate)` followed by `item.saveTx()` on the **parent**, and its notifier path's `skipSomeActions` flag does not suppress that write. Whether it fires is nondeterministic for the reason in (b) above — two `.eml` copies carry equal content types only if both sniffed the same way — so the tag will appear on some auto-attached pairs and not others with no visible cause. (b) Byte identity is narrower than message identity: a copy re-encoded by an MTA or line-ending-normalised by an export path will never byte-match and will withhold on every future drop. That is correct under this rule, but for archive-exported or list-delivered corpora withhold may be the common branch rather than the exceptional one.

### 2. Recipients as creators?

[src: unchanged from draft; row 7 sets the default]

`recipient` is a valid creator type. Populating it from `To:` is faithful but noisy on large distribution lists, and it changes `firstCreator` display. Resolved in the mapping contract above as a pref-capped count defaulting to 0 (off).

### 3. What is the `url` field for on an email item?

[src: unchanged from draft; row 12 records the rejection]

Leave empty. An RFC 2392 `mid:` URI is the semantically correct home for a Message-ID and is deliberately rejected: BBT maps `url` into BibLaTeX `url`, so every exported bibliography entry would carry a URI that resolves nowhere for a reader — a worse leak than `extra`'s, which BBT emits only into `note`.

### 4. Promotion trigger scope

[src: unchanged — still open]

Every standalone attachment anywhere, or only within a designated collection? The former is what "just drag it in" means; the latter is safer during development. **Not resolved by either review.** Carry into planning.

### 5. Batch behaviour on a 50-message drop — RESOLVED

[src: merged spec 4, row 13 — supersedes three earlier SE batch specs and one withdrawn zot spec]

It is the safe case rather than the dangerous one. `collectionViewItemTree.jsx` constructs one `Zotero.Notifier.Queue` per drop, passes it to every `importFromFile` call, and commits it once — so a 50-file drop delivers ONE `add` event carrying 50 ids, not 50 events. The observer iterates the id array and promotes serially inside that single awaited `notify`, so the whole batch completes before ZotMoov's observer is entered.

**The cost is drop-completion latency, not UI responsiveness.** Every layer is `await`: `queryAsync` runs through `await conn.executeCached(…)` on the `Sqlite.sys.mjs` async API, file access is `IOUtils.read(path, { maxBytes: 262144 })`, and `trigger` awaits the observer. These are cross-thread I/O completions rather than already-resolved promises, so each is delivered as a task and the main thread genuinely returns to the event loop, where a paint can intervene. Comment that in the code: the reasoning holds only while each iteration contains at least one real cross-thread await, and a future refactor that replaced a read with a cached in-memory hit would silently invert it.

Measured floor for the storage term, on the same filesystem as the Zotero data directory, under Zotero's own pragmas — WAL with `synchronous=NORMAL`, so a commit appends to the log without an fsync: 11 statements per transaction modelling one promotion, 50-transaction batches, 10 trials — **median 0.064 ms per transaction, 3.2 ms for a 50-message batch.** A floor on one term; a save layer adds statements and object work.

**Do NOT add a between-message yield, in any form.** It is a no-op in the wrong place. The per-message path already yields two or more times, so where the yield fires the main thread is already free; and the one span that does occupy the main thread — the synchronous header parse — is *inside* an iteration, where a between-message yield never reaches it. Gating it on elapsed time changes when it fires, not where.

**Escalation, in order, if a per-message main-thread term ever exceeds ~100 ms.** First **chunk the parse** — yield inside the header loop rather than between messages. That is the only placement that can interrupt a long single-message parse, and it is a small change to a loop that already exists. Only then **move the parse to a `ChromeWorker`**: both `ChromeWorker` and `Worker` are injected into the plugin sandbox by `Zotero.Plugins._loadScope`, Better BibTeX already runs its translator work this way so it is an in-substrate pattern rather than an invention, and the Zotero-free parser seam is precisely what makes the parser worker-portable — a second dividend from that seam beyond `node --test`. Price it honestly: a worker adds a round trip per message and the bytes must cross as a structured clone or a transferred `ArrayBuffer`, and a transfer neuters the buffer on the sending side.

**But treat a firing trigger as a bug report first.** A few kilobytes of headers parse in microseconds, and volume alone cannot reach 100 ms inside a 256 KB cap; getting there requires superlinear behaviour — repeated string concatenation while unfolding, or a backtracking-prone regex over folded whitespace or a long unstructured value. A worker moves a quadratic parse off the main thread and leaves it quadratic. That is also a security requirement — see the linear-time-parsing row in the invariant table.

**Two disciplines, owed regardless of the above.** (a) Resolve each id to an item immediately before promoting it, never all of them up front — every promotion awaits a file read and a transaction, so a handle taken at the top of the loop is stale-able by the time later items are reached. (b) Check a `_shuttingDown` flag after every await — teardown can land across any suspension, and the donor loader sets its plugin global to `undefined` on shutdown.

**Keep a `Zotero.ProgressWindow` above a batch threshold.** Main-thread availability and user feedback are different problems; a responsive but silent interface still leaves the user wondering whether anything is happening. It is also the channel that reports duplicates and parse failures, both otherwise silent by design: "Email intake: 48 promoted, 2 attached to existing items, 1 could not be parsed".

## Phasing

[src: SE R2 phasing spec, row 9]

Ordered to retire the highest-uncertainty item first. The largest unknown is not "can we parse RFC 5322 headers" — that is known, bounded, tedious work — but "does Better BibTeX mint a sane key and does ZotMoov file to the expected path when the item is born this way".

0. **Phase 0 — substrate (parallel, non-blocking).** Clone `windingwind/zotero-plugin-template` as reference material for the release plumbing; adopt and fix the Attachment Scanner loader. Not a gate on Phase 1.
1. **Phase 1 — walking skeleton.** Observer at priority 50, promoter, single transaction, and a *stub* parser returning a fixed `ParsedMessage`. Roughly 80 lines. This phase exists to retire the only genuinely open question in the plan — whether the ecosystem reacts correctly to an item born this way — before any parser exists.

   Definition of Done, stated as observations rather than as work completed:
   - a parent `email` item exists with the stub's subject, sender and date;
   - Better BibTeX has minted a plausible cite-key on it;
   - the attachment is a child of that item;
   - **the file is at `{dst_dir}/E-mail/{sender-surname}/{renamed}.eml`, and `{renamed}` is the Zotero-derived name, not the mail client's export name.** The filename half is load-bearing: `shouldAutoRenameAttachment` gates on `autoRenameFiles.fileTypes`, whose shipped default is `application/pdf,application/epub+zip`, so an EML attachment is NEVER auto-renamed and a DoD that checks only the directory will pass on a half-working result. The skeleton therefore includes the three calls `RecognizeDocument._processItem` makes after reparenting.

   One spike rides this phase, a one-liner against code being written anyway: whether `ChromeUtils.importESModule` resolves from a plugin root URI, which selects between the two test-loading mechanisms. The timer-clamp measurement proposed in earlier rounds is deliberately NOT carried — no yield ships in any form and the escalation path is chunking or a worker, neither of which is a `setTimeout`, so it would answer a question no decision depends on. Outcome, recorded at Phase 1 close: `ChromeUtils.importESModule(rootURI + 'src/probe.sys.mjs')` FAILED from an unpacked install (`rootURI` an `nsIFileURL`) and FAILED from an installed `.xpi` (`rootURI` an `nsIJARURI`), both throwing `Error` with the message `System modules must be loaded from a trusted scheme`, where PASS is a returned module whose `probe` export strictly equals `"ok"` and FAIL is any throw or a missing export; on FAIL the thrown error's `name` and `message` are recorded here verbatim. The `jar:` result is the governing one, because it is the packaging a release ships. Phase 2 elects the `module.exports` guard unless BOTH results are PASS; chrome registration remains unshipped either way until Phase 2 actually elects ESM. Both runs were measured on Zotero 9.0.6 with exactly one `emailintake ESM spike:` line each, and the packaged run was confirmed genuinely packaged rather than a repeat of the unpacked one by the loader's own `useLog` discriminator, which routes its startup line to `Zotero.debug` only when `Components.stack.filename` begins with `jar:`. The identical failure under both schemes means the decision does not rest on the weaker `file:` measurement: a bare plugin `rootURI` is not a trusted scheme under either packaging, so ESM is unavailable to this plugin without chrome registration, and Phase 2 therefore elects `module.exports` by rule rather than by preference.
2. **Phase 2 — the parser, both formats, one implementation.** `parseHeaders(text) -> ParsedMessage` is the single parser; `eml` supplies `text` by decoding bytes with the declared charset, and `msg` supplies `text` by extracting `PR_TRANSPORT_MESSAGE_HEADERS` from the CFB container.

   Ordered within the phase: `parseHeaders` + EML reader + fixture corpus first — that alone meets the Definition of Done. The read-only CFB reader is a **stretch item** inside the same phase, and the per-property MAPI fallback map is optional even within the stretch — a message lacking `0x007D` never traversed SMTP, and declining it visibly is an acceptable v1 behaviour. If the CFB walk overruns, the phase closes on EML and the binary work moves out.
3. **Phase 3 — hardening**, with both formats' failure modes in view: batch behaviour and its progress affordance, the 256 KB read cap, `sanitizeHeaderValue`, the ReDoS controls and their pathological fixtures, the error taxonomy, prefs, Fluent strings, and the CI invariant suite.
4. **Phase 4 — publish.** Release plumbing, README, `update.json` with `update_hash`, flip visibility.

From Phase 1 onward the detector recognises a format it cannot yet handle and **declines it visibly** — one user-facing message — rather than silently ignoring it. Explicit non-support is a feature; a silent no-op reads as a broken plugin.

## Known residuals

[src: main-agent synthesis — flagged for QC as the one section no specialist authored]

1. ~~**Open question 4 (promotion trigger scope) is unresolved.**~~ **CLOSED in Phase 3 by D1.** Promotion scope is EVERYWHERE, with no collection filter: any standalone attachment whose file is an email is promoted, wherever in the library it lands. There is no allow-list of collections and no "only in this collection" setting, and no preference may reintroduce one.
2. ~~**The `ProgressWindow` batch threshold is unspecified.**~~ **CLOSED in Phase 3 by D2.** One summary window per `notify`, shown when `ids.length > 1` **or** any item's outcome is not a plain promotion; it carries no progress bar and no per-item update, and is populated once at the end of the batch with the counts. The second disjunct is expressed generically — outcome is not the plain-promotion sentinel — never as an enumeration of the error codes, because a later phase adding outcomes to the taxonomy would otherwise have every one of them silently classified as plain, and a single withheld file would show no window at all.
3. **Withhold is the COMMON branch for several named cases, not the rare one, and half of that is settled deductively rather than empirically.** The paradigm case for the whole gate — a Sent copy versus an Inbox copy — differs in its `Received:` chain *by construction*: a Sent copy has no delivery hops, an Inbox copy has them. Those two can never byte-match, so that case takes the withhold branch with certainty. The same holds for direct-versus-list copies and for two deliveries to one account. What remains genuinely empirical is the frequency of the MTA-re-encoding and line-ending-normalisation cases in this user's own corpus, observable at Phase 2 once the fixture corpus exists. The user chose withhold-on-differ partly on a framing that this branch is rare; that framing was too weak, and the asymmetric-cost argument that actually carried the decision does not depend on frequency.
4. **Three substrate gaps stand**: no `zotero-plugin-template` clone; no RFC 5322 / 2047 / 2231 / 2392 reference; no `[MS-CFB]` / `[MS-OXMSG]` extraction before the CFB work is planned in detail.
