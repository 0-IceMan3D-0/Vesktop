# Third-party plugins

This fork of Vesktop, and the matching [Vendroid fork](https://github.com/0-IceMan3D-0/Vendroid/tree/third-party-plugins), load Vencord plugins at runtime from single `.js` files. You don't need to build Vencord yourself. The plugins are added to the official Vencord that Vesktop and Vendroid already use.

> [!WARNING]
> A plugin runs with full access to your Discord account. Nobody reviews third-party plugins, so only install plugins whose source you trust.

## Installing a plugin

1. Open Settings → **Third-Party Plugins**.
2. Click **Install from file** or **Install from URL** (a direct `https://` link to the `.js` file, such as a GitHub release asset).
3. Click **Restart to apply**.
4. Enable the plugin in Vencord's **Plugins** tab. Its settings open from there like any other plugin's.

Vesktop keeps plugin files in a `plugins` folder in its data directory (`~/.config/vesktop/plugins` on Linux). **Open plugins folder** takes you there. You can also drop files in that folder by hand.

## Building a plugin

Plugins are written exactly like [Vencord user plugins](https://docs.vencord.dev/installing/custom-plugins/). The build script bundles one into a single file:

```sh
git clone https://github.com/Vendicated/Vencord
cd Vencord && pnpm install && cd ..

# from this repository
pnpm buildPlugin --vencord ../Vencord path/to/myPlugin -o myPlugin.js --minify
```

If your plugin uses npm packages, install them in the Vencord checkout (`pnpm add -w <package>`) or in the plugin's folder.

How imports are handled:

| Import                                                                        | In the built file                                                                    |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `@api/*`, `@utils/*`, `@components/*`, `@webpack`, `@webpack/common`, `react` | Read from the running Vencord (`window.Vencord`), so the plugin shares state with it |
| Vencord modules not exposed on `window.Vencord`, like `@utils/types`          | Bundled from the Vencord checkout                                                    |
| npm packages                                                                  | Bundled                                                                              |
| `import "./style.css"`                                                        | Added to the page when the plugin loads                                              |
| `import style from "./style.css?managed"`                                     | Registered for `enableStyle`/`disableStyle`, as in Vencord                           |

### Limitations

- **No native code.** `native.ts` files and `VencordNative.pluginHelpers` don't work. Vendroid has no Node.js, and on Vesktop native code would need Vencord's main process.
- **Restart after installing or removing a plugin.** Patches have to be registered before Discord's code loads. Enabling or disabling an installed plugin works like it does for built-in plugins.
- **Plugin names must be unique.** A plugin with the same name as a built-in Vencord plugin is rejected.
- **Built against a Vencord version.** As with any Vencord user plugin, a big Vencord update can break a plugin until it's rebuilt.

## How it works

1. **Vencord loads.** Vesktop and Vendroid inject Vencord as usual. Before injecting, they mark Vencord's internal plugin metadata object so it can be found (`globalThis.VencordPluginMeta`). Without an entry in it, Vencord's plugin settings modal crashes for plugins it didn't build.
2. **The loader runs.** Right after Vencord, and still before Discord's own code, the loader (`src/renderer/thirdPartyPlugins`) reads every plugin file and evaluates it.
3. **Plugins are registered.** Each plugin is added to `Vencord.Plugins.plugins`. The loader repeats what Vencord does at startup: wiring up settings, enabling the API plugins it depends on, and registering its patches. Vencord then starts it with everything else.

On Vendroid the same loader runs from `app/src/main/res/raw/third_party_plugins.js`, which is built by this repository's `pnpm build` (`dist/vendroid/third_party_plugins.js`).
