/*
 * Vesktop, a desktop app aiming to give you a snappier Discord Experience
 * Copyright (c) 2026 Vendicated and Vesktop contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Button, Card, ErrorCard, Heading, Paragraph } from "@vencord/types/components";
import { Margins } from "@vencord/types/utils";
import { Modal, openModal, showToast, TextInput, useState } from "@vencord/types/webpack/common";

import { loadedFiles, ThirdPartyPluginHost } from "./loader";

interface Row {
    fileName: string;
    status: string;
    error?: string;
    removed?: boolean;
}

const styles = {
    buttons: { display: "flex", flexWrap: "wrap", gap: 8 },
    row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 },
    error: { color: "var(--text-feedback-critical, var(--status-danger))" }
} satisfies Record<string, React.CSSProperties>;

const errorMessage = (e: any) => String(e?.message ?? e);

function InstallFromUrlModal({ host, onInstalled, ...props }: any) {
    const [url, setUrl] = useState("");
    const [error, setError] = useState<string>();
    const [loading, setLoading] = useState(false);

    async function install() {
        setLoading(true);
        try {
            onInstalled(await host.installFromUrl(url.trim()));
            props.onClose();
        } catch (e) {
            setError(errorMessage(e));
        } finally {
            setLoading(false);
        }
    }

    return (
        <Modal
            {...props}
            title="Install plugin from URL"
            subtitle="Direct https:// link to a built plugin .js file, for example a GitHub release asset."
            notice={error ? { message: error, type: "critical" } : undefined}
            actions={[
                { text: "Cancel", variant: "secondary", onClick: props.onClose },
                { text: "Install", variant: "primary", onClick: install, loading, disabled: !url.trim() }
            ]}
        >
            <TextInput value={url} onChange={setUrl} placeholder="https://example.com/myPlugin.js" />
        </Modal>
    );
}

export function ThirdPartyPluginsTab({ host }: { host: ThirdPartyPluginHost }) {
    const [rows, setRows] = useState<Row[]>(() =>
        loadedFiles.map(f => ({
            fileName: f.fileName,
            status: f.pluginName ? `Plugin: ${f.pluginName}` : "Not loaded",
            error: f.error
        }))
    );
    const [needsRestart, setNeedsRestart] = useState(false);

    function onInstalled(fileName: string | null) {
        if (!fileName) return;

        setRows(rows => [
            ...rows.filter(r => r.fileName !== fileName),
            { fileName, status: "Installed, restart to load it" }
        ]);
        setNeedsRestart(true);
        showToast({ text: `Installed ${fileName}`, variant: "success" });
    }

    async function remove(fileName: string) {
        try {
            await host.remove(fileName);
            setRows(rows => rows.map(r => (r.fileName === fileName ? { ...r, removed: true } : r)));
            setNeedsRestart(true);
        } catch (e) {
            showToast({ text: `Couldn't remove ${fileName}: ${errorMessage(e)}`, variant: "critical" });
        }
    }

    return (
        <>
            <ErrorCard className={Margins.bottom16}>
                <Heading tag="h4">Only install plugins you trust</Heading>
                <Paragraph>
                    Third-party plugins aren't reviewed by anyone. They run with full access to your Discord account and
                    can read your messages and steal your token.
                </Paragraph>
            </ErrorCard>

            <Paragraph className={Margins.bottom8}>
                Plugins are built .js files (see the README for how to build a Vencord user plugin into one). After
                installing, restart, then enable the plugin in the Plugins tab like any other.
            </Paragraph>

            <div style={styles.buttons}>
                <Button
                    onClick={() =>
                        host
                            .installFromFile()
                            .then(onInstalled, e =>
                                showToast({ text: `Install failed: ${errorMessage(e)}`, variant: "critical" })
                            )
                    }
                >
                    Install from file
                </Button>
                <Button
                    variant="secondary"
                    onClick={() =>
                        openModal(props => <InstallFromUrlModal {...props} host={host} onInstalled={onInstalled} />)
                    }
                >
                    Install from URL
                </Button>
                {host.openFolder && (
                    <Button variant="secondary" onClick={() => host.openFolder!()}>
                        Open plugins folder
                    </Button>
                )}
                {needsRestart && (
                    <Button variant="positive" onClick={() => host.restart()}>
                        Restart to apply
                    </Button>
                )}
            </div>

            <Heading tag="h4" className={Margins.top16}>
                Installed
            </Heading>
            {rows.length === 0 && <Paragraph>No third-party plugins installed.</Paragraph>}
            {rows.map(row => (
                <Card key={row.fileName} style={styles.row}>
                    <div>
                        <Paragraph weight="semibold">{row.fileName}</Paragraph>
                        <Paragraph style={row.error ? styles.error : undefined}>
                            {row.removed ? "Removed, restart to unload it" : (row.error ?? row.status)}
                        </Paragraph>
                    </div>
                    {!row.removed && (
                        <Button size="small" variant="dangerPrimary" onClick={() => remove(row.fileName)}>
                            Remove
                        </Button>
                    )}
                </Card>
            ))}
        </>
    );
}
