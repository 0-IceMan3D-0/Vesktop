/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "fs";
import { copyFile, rm, writeFile } from "fs/promises";
import { basename, join } from "path";

import { dialog, net, shell } from "electron";
import { IpcEvents } from "shared/IpcEvents";
import { STATIC_DIR } from "shared/paths";
import type { ThirdPartyPluginFile } from "shared/thirdPartyPlugins";

import { DATA_DIR } from "./constants";
import { mainWin } from "./mainWindow";
import { handle, handleSync } from "./utils/ipcWrappers";

export const THIRD_PARTY_PLUGINS_DIR = join(DATA_DIR, "plugins");
const BUNDLED_PLUGINS_DIR = join(STATIC_DIR, "plugins");
mkdirSync(THIRD_PARTY_PLUGINS_DIR, { recursive: true });

function pluginPath(fileName: string) {
    if (basename(fileName) !== fileName || !fileName.endsWith(".js"))
        throw new Error(`Invalid plugin file name: ${fileName}`);
    return join(THIRD_PARTY_PLUGINS_DIR, fileName);
}

/**
 * Vencord keeps the metadata of its plugins (folder name, whether it's a user plugin) in an object it doesn't export,
 * and its settings UI crashes for plugins missing from it. Expose it so the third-party plugin loader can add to it.
 */
export function exposeVencordPluginMeta(rendererScript: string) {
    const match = /\{\s*\[[\w$]+\.name\]\s*:\s*\{\s*folderName\s*:/.exec(rendererScript);
    if (!match) {
        console.warn(
            "[ThirdPartyPlugins] Couldn't find Vencord's PluginMeta, plugin settings of third-party plugins may not open"
        );
        return rendererScript;
    }

    return rendererScript.slice(0, match.index) + "globalThis.VencordPluginMeta=" + rendererScript.slice(match.index);
}

function readPlugins(dir: string, bundled: boolean): ThirdPartyPluginFile[] {
    if (!existsSync(dir)) return [];

    return readdirSync(dir)
        .filter(f => f.endsWith(".js"))
        .sort()
        .map(fileName => ({ fileName, code: readFileSync(join(dir, fileName), "utf-8"), bundled }));
}

handleSync(IpcEvents.THIRD_PARTY_PLUGINS_LIST, () => [
    ...readPlugins(BUNDLED_PLUGINS_DIR, true),
    ...readPlugins(THIRD_PARTY_PLUGINS_DIR, false)
]);

handle(IpcEvents.THIRD_PARTY_PLUGINS_INSTALL_FILE, async () => {
    const res = await dialog.showOpenDialog(mainWin, {
        properties: ["openFile"],
        title: "Select a plugin to install",
        filters: [{ name: "Vencord plugins", extensions: ["js"] }]
    });
    if (res.canceled || !res.filePaths.length) return null;

    const fileName = basename(res.filePaths[0]);
    await copyFile(res.filePaths[0], pluginPath(fileName));
    return fileName;
});

handle(IpcEvents.THIRD_PARTY_PLUGINS_INSTALL_URL, async (_, url: string) => {
    const { protocol, pathname } = new URL(url);
    if (protocol !== "https:") throw new Error("Only https:// links are allowed");

    const res = await net.fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);

    let fileName = decodeURIComponent(basename(pathname)).replace(/[^\w.-]/g, "_") || "plugin";
    if (!fileName.endsWith(".js")) fileName += ".js";

    await writeFile(pluginPath(fileName), await res.text());
    return fileName;
});

handle(IpcEvents.THIRD_PARTY_PLUGINS_REMOVE, (_, fileName: string) => rm(pluginPath(fileName), { force: true }));

handle(IpcEvents.THIRD_PARTY_PLUGINS_OPEN_FOLDER, () => shell.openPath(THIRD_PARTY_PLUGINS_DIR));
