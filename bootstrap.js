/* Zotero 7 bootstrap add-on entry points.
 * See: https://www.zotero.org/support/dev/zotero_7_for_developers
 */

var chromeHandle;

function install() {}

async function startup({ id, version, resourceURI, rootURI }, reason) {
  Zotero.PreferencePanes.register({
    pluginID: id,
    src: rootURI + "prefs.xhtml",
    label: "Email Intake",
  });

  const aomStartup = Components.classes[
    "@mozilla.org/addons/addon-manager-startup;1"
  ].getService(Components.interfaces.amIAddonManagerStartup);
  const manifestURI = Services.io.newURI(rootURI + "manifest.json");
  chromeHandle = aomStartup.registerChrome(manifestURI, [
    ["content", "emailintake", rootURI + "chrome/content/"],
  ]);

  Zotero.EmailIntake = Zotero.EmailIntake || {};
  await Zotero.EmailIntake.init({ id, version, rootURI });
}

async function onMainWindowLoad({ window }) {
  Zotero.EmailIntake?.addToWindow(window);
}

async function onMainWindowUnload({ window }) {
  Zotero.EmailIntake?.removeFromWindow(window);
}

function shutdown(data, reason) {
  if (reason === APP_SHUTDOWN) return;

  Zotero.EmailIntake?.shutdown();
  Zotero.EmailIntake = undefined;

  chromeHandle?.destruct();
  chromeHandle = null;
}

function uninstall() {}
