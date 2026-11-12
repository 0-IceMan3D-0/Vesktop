/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { addPatch, isPluginEnabled, plugins, startPlugin } from "@vencord/types/api/PluginManager";
import { Settings, SettingsStore } from "@vencord/types/api/Settings";
import { Logger } from "@vencord/types/utils";
import type { Plugin, StartAt } from "@vencord/types/utils/types";
import type { ThirdPartyPluginFile } from "shared/thirdPartyPlugins";

/**
 * Where third-party plugins come from. Vesktop and Vendroid each implement this.
 */
export interface ThirdPartyPluginHost {
    /** Must be synchronous: plugins have to be registered before Discord's code loads, so their patches apply */
    list(): ThirdPartyPluginFile[];
    /** Resolves to the installed file name, or null if the user cancelled */
    installFromFile(): Promise<string | null>;
    installFromUrl(url: string): Promise<string>;
    remove(fileName: string): Promise<void>;
    openFolder?(): void;
    restart(): void;
}

export interface LoadedFile {
    fileName: string;
    pluginName?: string;
    error?: string;
}

declare global {
    // Exposed by patching Vencord's renderer script, see exposeVencordPluginMeta
    var VencordPluginMeta: Record<string, { folderName: string; userPlugin: boolean }> | undefined;
}

export const logger = new Logger("ThirdPartyPlugins", "#e78284");

export const loadedFiles: LoadedFile[] = [];

// The keys that make Vencord implicitly enable an API plugin, mirroring initPluginManager
const API_PLUGINS: [keyof Plugin, string][] = [
    ["commands", "CommandsAPI"],
    ["onBeforeMessageEdit", "MessageEventsAPI"],
    ["onBeforeMessageSend", "MessageEventsAPI"],
    ["onMessageClick", "MessageEventsAPI"],
    ["chatBarButton", "ChatInputButtonAPI"],
    ["renderMemberListDecorator", "MemberListDecoratorsAPI"],
    ["renderMessageAccessory", "MessageAccessoriesAPI"],
    ["renderMessageDecoration", "MessageDecorationsAPI"],
    ["messagePopoverButton", "MessagePopoverAPI"],
    ["userProfileBadge", "BadgeAPI"]
];

const BOUND_KEYS = [
    "onBeforeMessageEdit",
    "onBeforeMessageSend",
    "onMessageClick",
    "renderMemberListDecorator",
    "renderMessageAccessory",
    "renderMessageDecoration"
] as const;

const START_AT_INIT = "Init" as StartAt;

function evaluate({ fileName, code }: ThirdPartyPluginFile): Plugin {
    const module = { exports: {} as any };
    Function("module", "exports", `${code}\n//# sourceURL=ThirdPartyPlugins/${fileName}`)(module, module.exports);

    const plugin = module.exports.default ?? module.exports;
    if (typeof plugin?.name !== "string" || !plugin.name) throw new Error("This file doesn't export a Vencord plugin");

    return plugin;
}

function enableDependency(name: string) {
    const dep = plugins[name];
    if (!dep) throw new Error(`Depends on ${name}, which doesn't exist`);
    if (isPluginEnabled(name)) return;

    Settings.plugins[name].enabled = true;
    dep.isDependency = true;

    // Vencord only registered the patches of plugins that were enabled when it started
    for (const patch of dep.patches ?? []) addPatch(patch, name);
    if (dep.startAt === START_AT_INIT) startPlugin(dep);
}

function register(plugin: Plugin, fileName: string) {
    if (plugin.name in plugins) throw new Error(`A plugin named ${plugin.name} already exists`);

    plugins[plugin.name] = plugin;
    const meta = globalThis.VencordPluginMeta;
    if (meta) meta[plugin.name] = { folderName: `thirdparty/${fileName}`, userPlugin: true };

    if (plugin.settings) {
        plugin.settings.pluginName = plugin.name;
        for (const [key, def] of Object.entries(plugin.settings.def)) {
            if (def.onChange) SettingsStore.addChangeListener(`plugins.${plugin.name}.${key}`, def.onChange);
        }
    }

    if (!isPluginEnabled(plugin.name)) return;

    plugin.dependencies?.forEach(enableDependency);
    for (const [key, api] of API_PLUGINS) if (plugin[key]) enableDependency(api);
    for (const key of BOUND_KEYS) (plugin as any)[key] &&= plugin[key]!.bind(plugin);
    for (const patch of plugin.patches ?? []) addPatch(patch, plugin.name);

    // Vencord already started its Init plugins. The later stages pick ours up from the plugins object.
    if (plugin.startAt === START_AT_INIT) startPlugin(plugin);
}

export function loadThirdPartyPlugins(host: ThirdPartyPluginHost) {
    if (!globalThis.VencordPluginMeta)
        logger.warn("VencordPluginMeta is missing, plugin settings of third-party plugins may not open");

    for (const file of host.list()) {
        const loaded: LoadedFile = { fileName: file.fileName };
        loadedFiles.push(loaded);

        try {
            const plugin = evaluate(file);
            loaded.pluginName = plugin.name;
            register(plugin, file.fileName);
            logger.info(`Loaded ${plugin.name} from ${file.fileName}`);
        } catch (e) {
            loaded.error = String((e as Error)?.message ?? e);
            logger.error(`Failed to load ${file.fileName}\n`, e);
        }
    }
}
