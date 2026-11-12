/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface ThirdPartyPluginFile {
    fileName: string;
    code: string;
    /** Shipped with the app instead of installed by the user, so it can't be removed */
    bundled?: boolean;
}
