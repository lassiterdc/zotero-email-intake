#!/usr/bin/env node
"use strict";

// check-manifest-bootstrap-agreement — pre-commit hook
//
// Asserts that manifest.json and bootstrap.js agree on the two identifiers
// they BOTH declare: the add-on id and the version string.
//
// Why this is a gate and not a test. The loader captures `pluginId` and
// `version` as module-scope constants and hands them to Zotero at startup,
// while the add-on manager reads the same two values out of manifest.json.
// Nothing cross-checks them. When they drift, the add-on manager and the
// loader disagree about which plugin is running: the manifest id is what
// names the profile pointer file and what the update channel keys on, so a
// drifted id yields a plugin that installs under one identity and registers
// under another. Neither half errors.
//
// This is a CROSS-FILE invariant, so the hook reads both files unconditionally
// rather than only the staged one — staging either file alone can break it.
//
// Promotes Phase 0's Validation Plan item 2 into a gate.

const fs = require("fs");
const path = require("path");

const repoRoot = path.resolve(__dirname, "..", "..");
const manifestPath = path.join(repoRoot, "manifest.json");
const bootstrapPath = path.join(repoRoot, "bootstrap.js");

const errors = [];

function readConst(source, name) {
    // Matches: const pluginId    = "value";
    const re = new RegExp(`^const\\s+${name}\\s*=\\s*["']([^"']*)["']\\s*;`, "m");
    const m = source.match(re);
    return m ? m[1] : null;
}

if (!fs.existsSync(manifestPath)) {
    errors.push(`manifest.json not found at ${manifestPath}`);
}
if (!fs.existsSync(bootstrapPath)) {
    errors.push(`bootstrap.js not found at ${bootstrapPath}`);
}

if (errors.length === 0) {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (e) {
        // check-json-valid owns the parse-error message; stay silent here so one
        // malformed manifest does not produce two near-identical failures.
        process.exit(0);
    }

    const bootstrap = fs.readFileSync(bootstrapPath, "utf8");

    const manifestId = manifest?.applications?.zotero?.id ?? null;
    const manifestVersion = manifest?.version ?? null;
    const bootstrapId = readConst(bootstrap, "pluginId");
    const bootstrapVersion = readConst(bootstrap, "version");

    if (manifestId === null) {
        errors.push("manifest.json is missing applications.zotero.id");
    }
    if (manifestVersion === null) {
        errors.push("manifest.json is missing version");
    }
    if (bootstrapId === null) {
        errors.push("bootstrap.js has no parseable `const pluginId = \"...\";`");
    }
    if (bootstrapVersion === null) {
        errors.push("bootstrap.js has no parseable `const version = \"...\";`");
    }

    if (manifestId !== null && bootstrapId !== null && manifestId !== bootstrapId) {
        errors.push(
            `id mismatch:\n` +
            `    manifest.json applications.zotero.id = ${JSON.stringify(manifestId)}\n` +
            `    bootstrap.js   const pluginId        = ${JSON.stringify(bootstrapId)}`
        );
    }
    if (manifestVersion !== null && bootstrapVersion !== null && manifestVersion !== bootstrapVersion) {
        errors.push(
            `version mismatch:\n` +
            `    manifest.json version        = ${JSON.stringify(manifestVersion)}\n` +
            `    bootstrap.js   const version = ${JSON.stringify(bootstrapVersion)}`
        );
    }
}

if (errors.length > 0) {
    console.error("");
    console.error("ERROR: manifest.json and bootstrap.js disagree.");
    console.error("");
    for (const e of errors) {
        console.error(`  ${e}`);
    }
    console.error("");
    console.error("Path to fix: make both files declare the same id and version.");
    console.error("The manifest is the source of truth for the add-on manager;");
    console.error("the bootstrap constants are what the running plugin reports.");
    console.error("");
    console.error("To bypass (only if the violation is a known false positive):");
    console.error("  SKIP=check-manifest-bootstrap-agreement git commit ...");
    process.exit(1);
}

process.exit(0);
