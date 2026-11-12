/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { IconProps } from "@vencord/types/utils/types";

import { loadThirdPartyPlugins, ThirdPartyPluginHost } from "./loader";
import { ThirdPartyPluginsTab } from "./ThirdPartyPluginsTab";

export function PuzzleIcon({ height = 24, width = 24, className }: IconProps) {
    return (
        <svg viewBox="0 0 24 24" height={height} width={width} className={className}>
            <path
                fill="currentColor"
                d="M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5Z"
            />
        </svg>
    );
}

/** Loads the host's plugins into Vencord and adds the "Third-Party Plugins" settings page */
export function initThirdPartyPlugins(host: ThirdPartyPluginHost) {
    loadThirdPartyPlugins(host);

    const SettingsPlugin = Vencord.Plugins.plugins
        .Settings as typeof import("@vencord/types/plugins/_core/settings").default;

    SettingsPlugin.customEntries.push({
        key: "third_party_plugins",
        title: "Third-Party Plugins",
        Component: () => <ThirdPartyPluginsTab host={host} />,
        Icon: PuzzleIcon
    });
}
