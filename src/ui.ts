// src/ui.ts
import { Menu, showMessage } from "siyuan";
import KarakeepSyncPlugin from "./index"; // Importar la clase principal para el tipo 'this'
import iconSvg from "./assets/icon.svg";
import { runSyncCycle } from "./sync_logic"; // Importar para el comando
import { saveSettings } from "./settings"; // Importar para guardar al salir de ajustes

/**
 * Adds the plugin commands.
 */
export function addCommands(plugin: KarakeepSyncPlugin): void {
    plugin.addCommand({
        langKey: "syncKarakeepBookmarks",
        hotkey: "",
        callback: async () => {
            if (plugin.isSyncing) {
                showMessage(plugin.i18n.syncInProgress || "Sync is already in progress.", 3000, "info");
                return;
            }

            let syncStartedByThisCallback = false;
            try {
                showMessage(plugin.i18n.manualSyncStarting || "Starting manual Karakeep sync...");
                plugin.setSyncingState(true);
                syncStartedByThisCallback = true;
                plugin.logInfo("COMMAND CALLBACK: Attempting to run sync cycle...");

                const result = await runSyncCycle(plugin); // Pasar la instancia del plugin

                plugin.logInfo("COMMAND CALLBACK: Sync cycle finished. Result:", result);
                showMessage(result.message, result.success ? 4000 : 6000, result.success ? "info" : "error");

                // Guardar settings *después* de un ciclo exitoso para actualizar el timestamp
                if(result.success) {
                    plugin.logInfo("COMMAND CALLBACK: Sync successful, saving settings (timestamp)...");
                    await saveSettings(plugin);
                }


            } catch (error) {
                plugin.logError("COMMAND CALLBACK: CRITICAL ERROR awaiting runSyncCycle!", error);
                showMessage(`Sync failed critically: ${error instanceof Error ? error.message : String(error)}`, 6000, "error");
            } finally {
                if (syncStartedByThisCallback) {
                    plugin.logInfo("COMMAND CALLBACK: Resetting sync state.");
                    plugin.setSyncingState(false);
                    plugin.updateSyncStatusDisplay(); // Asegura que el estado del botón/texto se actualice
                } else {
                     plugin.logInfo("COMMAND CALLBACK: Sync was not started by this specific callback instance. Not resetting state.");
                }
            }
        },
        // Puedes añadir langText aquí si lo necesitas para diferentes idiomas
        // langText: {
        //     "default": "Sync Karakeep Bookmarks Now",
        //     "zh_CN": "立即同步 Karakeep 书签"
        // },
    });
}

/**
 * Adds the top bar button with its menu.
 */
export function addToolbarButton(plugin: KarakeepSyncPlugin): void {
    const pluginName = plugin.i18n.pluginName || "Karakeep Sync";
    plugin.topBarButtonElement = plugin.addTopBar({
        icon: iconSvg,
        title: pluginName,
        position: "right",
        callback: (event: MouseEvent) => {
            plugin.logInfo("Toolbar button clicked");
            if (!event.target) return;

            const rect = (event.target as Element).getBoundingClientRect();
            const menu = new Menu("karakeep-sync-menu");

            // Sync Now Option
            const syncCommand = plugin.commands.find(cmd => cmd.langKey === "syncKarakeepBookmarks");
            if (syncCommand) {
                menu.addItem({
                    icon: plugin.isSyncing ? "iconClock" : "iconRefresh",
                    label: plugin.isSyncing ? (plugin.i18n.syncing || "Syncing...") : (plugin.i18n.syncNow || "Sync Now"),
                    disabled: plugin.isSyncing,
                    click: () => {
                        if (syncCommand.callback) {
                            syncCommand.callback();
                        } else {
                            plugin.logError("Sync command callback is undefined!");
                        }
                    }
                });
            } else {
                plugin.logWarn("Could not find 'syncKarakeepBookmarks' command for menu.");
            }

            menu.addSeparator();

            // Settings Option
            menu.addItem({
                icon: "iconSettings",
                label: plugin.i18n.settings || "Settings",
                click: () => {
                    if (plugin.setting) {
                        plugin.setting.open(pluginName);
                    } else {
                        plugin.logError("Settings dialog instance not found.");
                        showMessage("Could not open settings.", 3000, "error");
                    }
                }
            });

            menu.open({ x: rect.left, y: rect.bottom + 4, h: rect.height, w: rect.width });
        }
    });
}

/**
 * Sets the syncing state and updates UI elements (buttons).
 */
export function setSyncingState(plugin: KarakeepSyncPlugin, syncing: boolean): void {
    plugin.logInfo(`UI UPDATE: setSyncingState called with: ${syncing}. Current this.isSyncing: ${plugin.isSyncing}`);
    if (plugin.isSyncing === syncing) {
        // plugin.logWarn(`UI UPDATE: Attempted to set isSyncing to ${syncing}, but it was already ${syncing}.`);
        // Permitir re-setear por si acaso la UI se desincronizó
    }
    plugin.isSyncing = syncing;

    // Update Settings Dialog Button (if it exists)
    if (plugin.syncButton) {
        try {
            plugin.syncButton.disabled = syncing;
            const newText = syncing ? (plugin.i18n.syncing || "Syncing...") : (plugin.i18n.syncNow || "Sync Now");
            plugin.syncButton.textContent = newText;
            plugin.logInfo(`UI UPDATE: Settings sync button updated. Disabled: ${syncing}, Text: "${newText}"`);
        } catch (e: any) {
            plugin.logError("UI UPDATE: ERROR updating settings sync button UI:", e);
        }
    } else {
       // plugin.logWarn("UI UPDATE: Cannot update settings sync button because 'this.syncButton' is null.");
    }

    // Update Toolbar Button (Icon/Label might need dynamic update if menu is open, less common)
    // This is harder as the menu item is created on the fly.
    // We might need to force-close and reopen the menu, or just rely on the disabled state.
    // For simplicity, we only update the Settings Dialog button state directly.

    plugin.logInfo(`UI UPDATE: setSyncingState finished. this.isSyncing is now: ${plugin.isSyncing}`);
}

/**
 * Updates the text displaying the last sync time in the settings UI.
 */
export function updateSyncStatusDisplay(plugin: KarakeepSyncPlugin): void {
    if (plugin.syncStatusElement) {
        const lastSyncText = plugin.i18n.lastSync || "Last synced";
        const neverSyncedText = plugin.i18n.neverSynced || "Never synced.";
        if (plugin.settings && plugin.settings.lastSyncTimestamp > 0) { // Check settings exist
            try {
                 plugin.syncStatusElement.textContent = `${lastSyncText}: ${new Date(plugin.settings.lastSyncTimestamp).toLocaleString()}`;
             } catch (e) {
                 plugin.syncStatusElement.textContent = `${lastSyncText}: ${new Date(plugin.settings.lastSyncTimestamp).toISOString()}`;
             }
        } else {
            plugin.syncStatusElement.textContent = neverSyncedText;
        }
    }
}