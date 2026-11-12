#!/usr/bin/env node
/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Builds a Vencord user plugin into a single .js file that Vesktop and Vendroid can load as a third-party plugin.
//
//   node build-plugin.mjs --vencord <Vencord source checkout> <plugin folder or entry file> [-o out.js]
//
// Vencord's modules (@api, @utils, @webpack, ...) are not bundled. Imports of them read from the
// running Vencord instead (window.Vencord), so the plugin shares its state with the rest of Vencord.
// Modules Vencord doesn't expose on window.Vencord (like @utils/types) are bundled from the source checkout.
// npm dependencies are bundled from the plugin folder or the Vencord checkout's node_modules.

import { existsSync, readFileSync, statSync } from "fs";
import { createRequire } from "module";
import { basename, dirname, join, relative, resolve } from "path";
import { parseArgs } from "util";

const { values: args, positionals } = parseArgs({
    allowPositionals: true,
    options: {
        vencord: { type: "string" },
        out: { type: "string", short: "o" },
        minify: { type: "boolean", default: false }
    }
});

if (!args.vencord || positionals.length !== 1) {
    console.error(
        "Usage: node build-plugin.mjs --vencord <Vencord source checkout> <plugin folder or entry> [-o out.js] [--minify]"
    );
    process.exit(1);
}

const vencordDir = resolve(args.vencord);
const vencordSrc = join(vencordDir, "src");
if (!existsSync(join(vencordSrc, "Vencord.ts"))) throw new Error(`${vencordDir} is not a Vencord source checkout`);

const pluginPath = resolve(positionals[0]);
const entry = statSync(pluginPath).isDirectory()
    ? ["index.tsx", "index.ts", "index.jsx", "index.js"].map(f => join(pluginPath, f)).find(existsSync)
    : pluginPath;
if (!entry) throw new Error(`No index file in ${pluginPath}`);

const pluginDir = dirname(entry);
const outfile = resolve(args.out ?? `${basename(pluginDir)}.js`);

const esbuild = createRequire(join(vencordDir, "package.json"))("esbuild");

/** Names re-exported by an index file through `export * from "./X"` / `export * as Y from "./X"` / `export const Y = $X` */
function exportedModules(indexFile) {
    const code = readFileSync(indexFile, "utf-8");
    const modules = new Map();
    for (const [, name, path] of code.matchAll(/export \* as (\w+) from "\.\/([\w/]+)"/g)) modules.set(path, name);
    for (const [, path] of code.matchAll(/export (?:\*|\{[^}]*\}) from "\.\/([\w/]+)"/g)) modules.set(path, null);
    const imports = new Map(
        [...code.matchAll(/import \* as (\$\w+) from "\.\/([\w/]+)"/g)].map(([, v, path]) => [v, path])
    );
    for (const [, name, v] of code.matchAll(/export const (\w+) = (\$\w+)/g)) modules.set(imports.get(v), name);
    return modules;
}

const apiModules = exportedModules(join(vencordSrc, "api/index.ts"));
const utilModules = exportedModules(join(vencordSrc, "utils/index.ts"));
const componentModules = exportedModules(join(vencordSrc, "components/index.ts"));

/** @returns the window.Vencord expression a module maps to, or undefined to bundle it from source */
function vencordGlobal(path) {
    if (path === "react") return "Vencord.Webpack.Common.React";
    if (path === "react-dom") return "Vencord.Webpack.Common.ReactDOM";
    if (path === "@webpack") return "Vencord.Webpack";
    if (path === "@webpack/common" || path.startsWith("@webpack/common/")) return "Vencord.Webpack.Common";
    if (path === "@webpack/patcher") return "Vencord.WebpackPatcher";

    const [, scope, module] = path.match(/^@(api|utils|components)\/(.+)$/) ?? [];
    if (scope === "api" && apiModules.get(module)) return `Vencord.Api.${apiModules.get(module)}`;
    if (scope === "utils" && utilModules.has(module)) return "Vencord.Util";
    if (scope === "components" && componentModules.has(module)) return "Vencord.Components";
}

const tsconfigPaths = Object.entries(
    JSON.parse(readFileSync(join(vencordDir, "tsconfig.json"), "utf-8").replace(/^\s*\/\/.*$/gm, "")).compilerOptions
        .paths
);

function vencordSourcePath(path) {
    for (const [alias, [target]] of tsconfigPaths) {
        const prefix = alias.replace("*", "");
        if (alias.endsWith("*") ? path.startsWith(prefix) : path === alias)
            return join(vencordDir, target.replace("*", path.slice(prefix.length)));
    }
}

/** @type {import("esbuild").Plugin} */
const vencordModules = {
    name: "vencord-modules",
    setup(build) {
        build.onResolve({ filter: /^(@main|@plugins|~)/ }, ({ path }) => ({
            errors: [{ text: `${path} can't be used in third-party plugins` }]
        }));

        build.onResolve({ filter: /^(@(api|utils|components|webpack|shared|debug)|react(-dom)?$)/ }, async args => {
            const global = vencordGlobal(args.path);
            if (global) return { path: args.path, namespace: "vencord-global", pluginData: global };

            const source = vencordSourcePath(args.path);
            if (!source) return;
            return build.resolve(source, { kind: args.kind, resolveDir: args.resolveDir });
        });

        // Getters, so values Vencord assigns later (like stores that load with Discord) are read when used, not now.
        // `default` points at the export named like the module, for `import ErrorBoundary from "@components/ErrorBoundary"`
        build.onLoad({ filter: /.*/, namespace: "vencord-global" }, ({ path, pluginData }) => ({
            contents: `
                const ns = ${pluginData};
                for (const key of Object.keys(ns)) Object.defineProperty(exports, key, { get: () => ns[key], enumerable: true });
                Object.defineProperty(exports, "default", { get: () => ns[${JSON.stringify(basename(path))}] ?? ns, enumerable: true });
                Object.defineProperty(exports, "__esModule", { value: true });
            `,
            loader: "js"
        }));
    }
};

/** @type {import("esbuild").Plugin} */
const styles = {
    name: "styles",
    setup(build) {
        build.onResolve({ filter: /\.css(\?managed)?$/ }, ({ path, resolveDir }) => ({
            path: join(resolveDir, path.replace("?managed", "")),
            namespace: path.endsWith("?managed") ? "managed-style" : "style"
        }));

        // Same as Vencord's own managed styles: registered here, enabled by the plugin with enableStyle()
        build.onLoad({ filter: /.*/, namespace: "managed-style" }, ({ path }) => {
            const name = JSON.stringify(`thirdparty/${relative(pluginDir, path).replaceAll("\\", "/")}`);
            return {
                contents: `
                    (window.VencordStyles ??= new Map()).set(${name}, { name: ${name}, source: ${JSON.stringify(readFileSync(path, "utf-8"))}, classNames: {}, dom: null });
                    export default ${name};
                `,
                loader: "js"
            };
        });

        // Plain css imports are always active, like in Vencord
        build.onLoad({ filter: /.*/, namespace: "style" }, ({ path }) => ({
            contents: `
                const style = Object.assign(document.createElement("style"), { textContent: ${JSON.stringify(readFileSync(path, "utf-8"))} });
                const append = () => document.head.append(style);
                if (document.head) append(); else document.addEventListener("DOMContentLoaded", append, { once: true });
            `,
            loader: "js"
        }));
    }
};

await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: "cjs",
    platform: "browser",
    target: "es2022",
    minify: args.minify,
    legalComments: "none",
    jsx: "transform",
    jsxFactory: "Vencord.Webpack.Common.React.createElement",
    jsxFragment: "Vencord.Webpack.Common.React.Fragment",
    nodePaths: [join(pluginDir, "node_modules"), join(vencordDir, "node_modules")],
    plugins: [vencordModules, styles],
    // define only takes literals, so the platform is detected once at load time
    banner: {
        js: `var __vcPlatform = { IS_VESKTOP: typeof VesktopNative !== "undefined", IS_DISCORD_DESKTOP: typeof VesktopNative === "undefined" && typeof DiscordNative !== "undefined" };
__vcPlatform.IS_WEB = !__vcPlatform.IS_VESKTOP && !__vcPlatform.IS_DISCORD_DESKTOP;`
    },
    define: {
        IS_VESKTOP: "__vcPlatform.IS_VESKTOP",
        IS_DISCORD_DESKTOP: "__vcPlatform.IS_DISCORD_DESKTOP",
        IS_WEB: "__vcPlatform.IS_WEB",
        IS_EXTENSION: "false",
        IS_USERSCRIPT: "false",
        IS_STANDALONE: "true",
        IS_UPDATER_DISABLED: "true",
        IS_DEV: "false",
        IS_REPORTER: "false",
        IS_ANTI_CRASH_TEST: "false",
        VERSION: JSON.stringify("thirdparty"),
        BUILD_TIMESTAMP: String(Date.now())
    },
    logLevel: "info"
});
