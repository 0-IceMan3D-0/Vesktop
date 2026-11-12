/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Entry point of the third-party plugin loader for Vendroid, built with `pnpm buildVendroidLoader`.
// Vendroid injects the output right after Vencord, and implements the VencordMobileNative methods used here.

import { initThirdPartyPlugins } from ".";

declare const VencordMobileNative: {
    thirdPartyPluginsList(): string;
    thirdPartyPluginsInstallFromFile(callbackId: string): void;
    thirdPartyPluginsInstallFromUrl(callbackId: string, url: string): void;
    /** Returns an error message, or an empty string on success */
    thirdPartyPluginsRemove(fileName: string): string;
};

const pending = new Map<string, { resolve(fileName: string | null): void; reject(error: Error): void }>();
let nextCallbackId = 0;

// Called from Java once an install finishes
(window as any).VendroidThirdPartyPlugins = {
    resolve(callbackId: string, error: string | null, fileName: string | null) {
        const callbacks = pending.get(callbackId);
        pending.delete(callbackId);
        if (error) callbacks?.reject(new Error(error));
        else callbacks?.resolve(fileName);
    }
};

function callNative<T>(start: (callbackId: string) => void) {
    return new Promise<T>((resolve, reject) => {
        const callbackId = String(nextCallbackId++);
        pending.set(callbackId, { resolve: resolve as any, reject });
        start(callbackId);
    });
}

initThirdPartyPlugins({
    list: () => JSON.parse(VencordMobileNative.thirdPartyPluginsList()),
    installFromFile: () => callNative(id => VencordMobileNative.thirdPartyPluginsInstallFromFile(id)),
    installFromUrl: url => callNative(id => VencordMobileNative.thirdPartyPluginsInstallFromUrl(id, url)),
    async remove(fileName) {
        const error = VencordMobileNative.thirdPartyPluginsRemove(fileName);
        if (error) throw new Error(error);
    },
    restart: () => location.reload()
});
