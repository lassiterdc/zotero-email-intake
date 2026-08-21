"use strict";

// This is a loader for general use.
// Only a few changes (mostly the object/plugin names) are needed to create a loader for another plugin.
// To implement the preference, add "onload='Zotero.EmailIntake.initPreference(document);'" to the root element in prefXHTML
// Implement these functions if needed:
//      init({ id, version, rootURI }), main(), addToWindow(window), removeFromWindow(window),
//      onPreferenceWindowFocus(doc), onPreferenceWindowLoseFocus(doc),
//      onPreferenceWindowClose(doc), onPreferenceWindowOpen(doc),
//      onItemChange(event, type, ids, extraData)

const pluginName  = "Email Intake for Zotero";
const pluginId    = "emailintake@lassiterdc.github.io";
const version     = "0.1.0";
// cfb.js BEFORE message.js: it is message.js's dependency, and a list that runs
// dependency-before-dependent stays correct if the no-evaluation-time-calls rule in
// src/intake.js's header is ever relaxed. Order is NOT load-bearing today -- getStreamReader
// resolves readStream at call time, on the drop path, long after every subscript has been
// evaluated -- so this is legibility, not correctness. What IS correctness is that cfb.js
// appears here at all: omitted, readStream is never defined in the sandbox global,
// getStreamReader falls through to a require that the sandbox does not grant, and every
// MAPI property read returns null. Every .msg then fails as E_HEADER_MALFORMED while
// node --test passes, because the test harness reaches cfb.js through require.
const pureJS      = ["src/cfb.js", "src/message.js"];   // Zotero-free modules; evaluated before mainJS
const mainJS      = "src/intake.js";                    // This is the actual plugin code
const mainFTL     = "emailintake.ftl";                  // Localization file
const prefXHTML   = "prefs.xhtml";                      // Document for the pref window
const prefJS      = "";                                 // .js file for prefXHTML -- a PANE SCRIPT, not the defaults file; this pane needs none
const prefNameFTD = "emailintake-pref-pane-title";      // Localized title shown in Zotero's pref window
const prefDefName = "Email Intake";                     // Incase if no localized title is provided, use this or pluginName
const prefHelpURL = '';                                 // Url of external help shown in Zotero's pref window
const prefScope   = "emailintake";                      // Prefix of all entries in Zotero's global prefs.ini

function onStartup() {
    // Store a reference in the global Zotero object, so that it can be used by prefXHTML, prefJS, and other objects
    return Zotero.EmailIntake = EmailIntake;
}

function onShutdown() {
    Zotero.EmailIntake = undefined;
}

var EmailIntake = {
// Any changes below this point is unncessary and not recommended.

    id: null,
    version: null,
    rootURI: null,

    // IDs of created elements; removeFromWindow() will remove all elements with one of the IDs even if those not created by this plugin
    addedElementIDs: [],
    // preferenceDocument is set if the preference window is opened
    preferenceDocument: undefined,

    // =====  Preference I/O and string localization =====
    getPref(pref) {
        return Zotero.Prefs.get(`extensions.${prefScope}.${pref}`, true);
    },

    // The donor loader's getPrefDefault(pref, defaultValue) was deleted here. It was
    // called from nowhere and was type-wrong for this plugin's pref set: its
    // Zotero.Prefs.get(...)?.trim() guards only null and undefined, so the boolean
    // returned for `enabled` reached .trim() and threw TypeError, and its falsy test
    // would have overwritten a deliberate recipientCap of 0 with the default on every
    // read. Defaults come from the platform instead -- Zotero evaluates the plugin-root
    // prefs.js onto the default branch before startup() runs. Establishing them here
    // would write the USER branch, which is strictly worse: indistinguishable from a
    // deliberate user choice and immune to "restore default".

    setPref(pref, value) {
        return Zotero.Prefs.set(`extensions.${prefScope}.${pref}`, value, true);
    },

    // `args` is optional and carries Fluent variables: formatValueSync(id, { count: n })
    // is Zotero's own idiom for this. Without it a string declaring `{ $count }` renders
    // the placeholder literally, which is what shipped -- the summary window showed a
    // raw `{$count}` to the user.
    getLocalizedString(l10nID, args) {
        return (this.localization) ? this.localization.formatValueSync(l10nID, args) : l10nID;
    },

    getLocalizedStringDefault(l10nID, defaultValue) {
        return (this.localization) ? this.localization.formatValueSync(l10nID) : defaultValue;
    },

    // ===== Handling created elemetns/menuitem =====
    storeCreatedElement(elm) {
        if (elm.id || !this.addedElementIDs.includes(elm.id))
            this.addedElementIDs.push(elm.id);
    },

    freeCreatedElements(doc) {
        for (let id of this.addedElementIDs)
            doc.getElementById(id)?.remove();
    },

    // menuID: DOM ID of the parent, like "menu_ToolsPopup", "zotero-itemmenu", "menu_FilePopup", "menu_NewItemPopup", "menu_EditPopup", etc
    // menuItemId: DOM ID of the created menu item
    // l10nID: ID for localization
    // icon: Url to the icon file, like: `${this.rootURI}skin/scan.png`;
    // options: {hidden: Boolean; disabled: Boolean}
    // command: function to execute when selected
    async addMenuItem(window, menuID, menuItemId, l10nID, icon, options, command) {
        let doc = window.document;
        let menuitem = doc.createXULElement("menuitem");
        menuitem.id = menuItemId;
        // Not using menuitem.setAttribute because of it has bugs handling localization (at least on Macs)
        // Popup menu mostly use 'en' and main menu randomly use 'en' or others
        // menuitem.setAttribute("data-l10n-id", l10nID);
        let s = this.getLocalizedString(l10nID);
        menuitem.setAttribute("label", s);
        if (command) menuitem.addEventListener("command", command);
        // Another Zotero's bug: Icon is not shown correctly on Windows....
        if (icon) menuitem.style.listStyleImage = `url(${icon})`;
        if (options.hidden) menuitem.hidden = true;
        if (options.disabled) menuitem.disabled = true;
        doc.getElementById(menuID).appendChild(menuitem);
        // so that it can be freed
        this.storeCreatedElement(menuitem);
    },

    async setItemStateAllWin(id, disabled, hidden) {
        let windows = Zotero.getMainWindows();
        for (let win of windows)
            this.setItemState(win, id, disabled, hidden);
    },

    async setItemState(win, id, disabled, hidden) {
        let item = win?.document?.getElementById(id);
        if (item) {
            // log(`${id}: (${item.disabled}, ${item.hidden}) --> (${disabled}, ${hidden})`);
            if (hidden !== undefined) item.hidden = hidden;
            if (disabled !== undefined) item.disabled = disabled;
        }
    },

    // `closeAfterMs` is optional. When omitted the window NEVER dismisses itself, which
    // is what shipped: the donor constructs with closeOnClick:false and never calls
    // startCloseTimer, so the summary persisted until the user removed it by hand with
    // right-click -> hide. Three independent reasons it stuck, all now addressed here:
    // no timer, no click-to-close, and closeProgressWindow called from nowhere.
    //
    // startCloseTimer(ms) is Zotero's own dismissal idiom (progressWindow.js:245). Its
    // default when passed a non-number is 2500 ms; Zotero itself passes 8000 for a
    // message the user is meant to READ, which is what a batch summary is -- so callers
    // that want a readable summary should pass a value rather than take the default.
    // The timer requires the window to be loading or loaded, which holds after show().
    //
    // closeOnClick is TRUE by user ruling: clicking the toast dismisses it. The cost was
    // put to the user and accepted rather than assumed away -- a misplaced click can
    // destroy counts before they are read, and that is the price of immediacy. The
    // original report asked for both routes ("did not go away automatically or on
    // click"), so click was expected behaviour from the start.
    //
    // This RESTORES the platform default rather than departing from it: progressWindow.js
    // defaults _closeOnClick to true when the option is absent, so the donor loader's
    // explicit false was the override. The key is kept explicit anyway, so the decision
    // is visible at the call site instead of resting on a default that could change.
    //
    // The two dismissal routes do not interact: _onMouseUp calls self.close() directly
    // and touches neither the timeout id nor the close timer. Click also RESCUES the
    // hover case -- hovering cancels the timer, so before this a cursor resting on the
    // toast left no dismissal path short of leaving the Zotero window, which is exactly
    // where the pointer sits after a drag-and-drop.
    createProgressWindow(title, desc, closeAfterMs) {
        this.progressWindow = new Zotero.ProgressWindow({closeOnClick: true});
        this.progressWindow.changeHeadline("", "headline", title); // the second is the CSS key
        this.progressWindow.show();
        if (desc !== undefined)
            this.progressWindow.addDescription(desc);
        if (typeof closeAfterMs === 'number')
            this.progressWindow.startCloseTimer(closeAfterMs);
    },

    // Guarded: the previous form threw a TypeError when no window was open, which is why
    // it could not safely be called from a teardown path.
    closeProgressWindow() {
        if (this.progressWindow) this.progressWindow.close();
        this.progressWindow = undefined;
    },

    // =====  Initialization and finalization =====
    _init({ id, version, rootURI } = {}) {
        this.id = id;
        this.version = version;
        this.rootURI = rootURI;

        if (mainFTL)
            this.localization = new Localization([mainFTL], true);
        if (this.init) this.init({ id, version, rootURI });

        // "collection", "search", "share", "share-items", "item", "file", "collection-item", "item-tag", "tag",
        // "setting", "group", "trash", "bucket", "relation", "feed", "feedItem", "sync", "api-key", "tab";
        if (this.onItemChange && !this.itemNotifierID)
            this.itemNotifierID = Zotero.Notifier.registerObserver(this.onItemChange, ['item'], 'emailintake', 50);
    },

    _addToWindow(window) {
        log("Add to a window");
        if (mainFTL)
            window.MozXULElement.insertFTLIfNeeded(mainFTL);
        if (this.addToWindow) this.addToWindow(window);
    },

    _removeFromWindow(window) {
        log("Remove from a window");
        if (this.removeFromWindow) this.removeFromWindow(window);
        var doc = window.document;
        this.freeCreatedElements(doc);
        if (mainFTL)
            doc.querySelector(`[href='${mainFTL}']`)?.remove();
    },

    addToAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (win.ZoteroPane) this._addToWindow(win);
        }
    },

    removeFromAllWindows() {
        var windows = Zotero.getMainWindows();
        for (let win of windows) {
            if (win.ZoteroPane) this._removeFromWindow(win);
        }
        this.addedElementIDs = [];
    },

    // ==== This is called by prefXHTML to set up event notifications
    initPreference(doc) {
        log("Open the preference window");
        this.preferenceDocument = doc;

        // This is called after onPreferenceWindowOpen AND after the first mouse click on the window
        // And each time the window is activated
        // Clicking alternatively on the left/right panels fires multiple focusin/focusout
        if (this.onPreferenceWindowFocus)
            doc.addEventListener("focusin", (event) => {
                this.onPreferenceWindowFocus(doc);
            });

        // This is called before the FIRST onPreferenceWindowLoseFocus call
        // And each time the window is deactivated
        // Clicking alternatively on the left/right panels fires multiple focusin/focusout
        if (this.onPreferenceWindowLoseFocus)
            doc.addEventListener("focusout", (event) => {
                this.onPreferenceWindowLoseFocus(doc);
            });

        // This is called when the window is closed, after focusout
        if (this.onPreferenceWindowClose)
            doc.addEventListener('visibilitychange', () => {
                if (doc.visibilityState == 'hidden') this.onPreferenceWindowClose(doc);
                this.preferenceDocument = undefined;
            });

        // This is called before each time the window is open, not immediately though
        if (this.onPreferenceWindowOpen)
            this.onPreferenceWindowOpen(doc);
    },
}

var pluginObj = undefined;      // The is only to store the object so that the below code doesn't need to change for another plugin
// log(Message) log a message using different methods.
//   0: Hide the message;
//   1: Use Zotero.debug (won't show in the Error Console unless "Debug output logging" is enabled);
//   2: Use Zotero.log (Show as Warning in the Error Console)
var useLog = (Components.stack.filename.startsWith("jar:")) ? 1 : 2;  // use Zotero.log when it is not in a .xpi (jar:file:///XXX.xpi!/bootstrap.js)

function log(msg) {
    if (useLog == 2)
        Zotero.log(pluginName + ": " + msg);
    else if (useLog == 1)
        Zotero.debug(pluginName + ": " + msg);
}

// These are required for bootstrap.js
function install() {
    log("Installed version " + version);
}

function uninstall() {
    log("Uninstalled version " + version);
}

async function startup({ id, version, rootURI }) {
    log("Starting up...");
    pluginObj = onStartup();
    // Pure modules first, mainJS last -- the order is in the expression, not in a comment.
    // The catch is load-bearing: Zotero.Plugins._callMethod swallows a throw from startup()
    // into a log line that names the plugin and the method but never the file that failed.
    for (let path of pureJS.concat(mainJS)) {
        try {
            Services.scriptloader.loadSubScript(rootURI + path);
        }
        catch (e) {
            log("failed to load " + path + ": " + e);
            throw e;
        }
    }
    pluginObj._init({ id, version, rootURI });

    if (prefXHTML) {
        let args = {pluginID: pluginId, src: rootURI + prefXHTML};
        if (prefJS) Object.assign(args, {scripts: [rootURI + prefJS]});
        if (prefNameFTD) Object.assign(args, {label: pluginObj.getLocalizedStringDefault(prefNameFTD, prefDefName || pluginName)});
        if (prefHelpURL) Object.assign(args, {helpURL: prefHelpURL});
        Zotero.PreferencePanes.register(args);
    }
    pluginObj.addToAllWindows();
    if (pluginObj.main)
      await pluginObj.main();
}

function onMainWindowLoad({ window }) {
    pluginObj._addToWindow(window);
}

function onMainWindowUnload({ window }) {
    pluginObj._removeFromWindow(window);
}

function shutdown() {
    log("Shutting down...");
    pluginObj.removeFromAllWindows();
    if (pluginObj.itemNotifierID) {
        Zotero.Notifier.unregisterObserver(pluginObj.itemNotifierID);
        pluginObj.itemNotifierID = undefined;
    }
    // The donor dispatches every other plugin callback through this optional-hook idiom
    // but has no shutdown member to dispatch. Without this line the observer's
    // _shuttingDown flag has no reachable setter: removeFromWindow is the only plugin
    // callback this path already reaches, and it is shared with onMainWindowUnload, so
    // setting the flag there would latch on an ordinary window close.
    if (pluginObj.shutdown) pluginObj.shutdown();
    onShutdown();
}
