// src/settings.ts
import { Setting, showMessage, fetchPost } from "siyuan";
import { KarakeepSyncSettings } from "./types";
import { STORAGE_SETTINGS_KEY, DEFAULT_KARAKEEP_API_ENDPOINT, API_LS_NOTEBOOKS } from "./constants";
import KarakeepSyncPlugin from "./index"; // Importar el tipo de la clase principal

// --- Settings Defaults ---
export const DEFAULT_SETTINGS: KarakeepSyncSettings = {
    apiKey: "",
    apiEndpoint: DEFAULT_KARAKEEP_API_ENDPOINT,
    syncNotebookId: null,
    syncIntervalMinutes: 60,
    lastSyncTimestamp: 0,
    updateExistingFiles: false,
    excludeArchived: true,
    onlyFavorites: false,
    excludedTags: [],
    downloadAssets: true,
};

// --- Settings Management Logic ---
export async function loadSettings(plugin: KarakeepSyncPlugin): Promise<void> {
    const loadedData = await plugin.loadData(STORAGE_SETTINGS_KEY);
    const validSettings: Partial<KarakeepSyncSettings> = {};
    if (loadedData) {
        for (const key in DEFAULT_SETTINGS) {
            if (loadedData.hasOwnProperty(key)) {
                (validSettings as any)[key] = loadedData[key];
            }
        }
    }
    plugin.settings = { ...DEFAULT_SETTINGS, ...validSettings };
    plugin.logInfo("Settings loaded:", plugin.settings);
}

export async function saveSettings(plugin: KarakeepSyncPlugin): Promise<void> {
    const settingsToSave: Partial<KarakeepSyncSettings> = {};
    for (const key in DEFAULT_SETTINGS) {
        if (plugin.settings.hasOwnProperty(key)) {
            (settingsToSave as any)[key] = (plugin.settings as any)[key];
        }
    }
    await plugin.saveData(STORAGE_SETTINGS_KEY, settingsToSave);
    plugin.logInfo("Settings saved.");
    plugin.updateSyncStatusDisplay(); // Actualizar UI si está visible
    plugin.startPeriodicSync(); // Reiniciar el temporizador con la nueva configuración
}


// --- Settings UI Setup ---
export function setupSettingsDialog(plugin: KarakeepSyncPlugin): void {
    plugin.setting = new Setting({
        height: "75vh",
        width: "600px",
        title: plugin.i18n.settingsTitle || "Karakeep Sync Settings (One-Way)",
        confirmCallback: async () => {
            // Validation before saving
            if (!plugin.settings.apiKey) {
                showMessage(plugin.i18n.apiKeyMissing || "Karakeep API Key is required.", 3000, "error"); return;
            }
            if (!plugin.settings.apiEndpoint || !plugin.settings.apiEndpoint.startsWith("http")) {
                showMessage(plugin.i18n.invalidApiEndpoint || "A valid Karakeep API Endpoint (starting with http/https) is required.", 4000, "error"); return;
            }
            if (!plugin.settings.syncNotebookId) {
                showMessage(plugin.i18n.notebookMissing || "Please select a Target SiYuan Notebook.", 3000, "error"); return;
            }
            await saveSettings(plugin); // Usar la función exportada
            showMessage(plugin.i18n.settingsSaved || "Karakeep-siyuan settings saved.");
        }
    });

    // --- UI Element Creation Helpers ---
    const createTextInput = (key: keyof KarakeepSyncSettings, placeholder: string, type: "text" | "password" | "url" = "text"): HTMLInputElement => {
        const input = document.createElement("input");
        input.type = type;
        input.className = "b3-text-field fn__block";
        input.placeholder = placeholder;
        input.value = plugin.settings[key] as string ?? ""; // Assume string
        input.addEventListener("input", () => {
            (plugin.settings as any)[key] = input.value;
        });
        return input;
    };

    const createNumberInput = (key: keyof KarakeepSyncSettings, placeholder: string, min: number = 0): HTMLInputElement => {
        const input = document.createElement("input");
        input.type = "number";
        input.className = "b3-text-field fn__block";
        input.placeholder = placeholder;
        input.min = String(min);
        input.value = String(plugin.settings[key] ?? DEFAULT_SETTINGS[key]); // Assume number
        input.addEventListener("input", () => {
            const numValue = parseInt(input.value, 10);
            plugin.settings[key] = (!isNaN(numValue) && numValue >= min) ? numValue : (DEFAULT_SETTINGS[key] as any);
            input.value = String(plugin.settings[key]); // Update input value in case it was corrected
        });
        return input;
    };

    const createToggleInput = (key: keyof KarakeepSyncSettings): HTMLInputElement => {
        const switchElement = document.createElement("input");
        switchElement.type = "checkbox";
        switchElement.className = "b3-switch fn__flex-center";
        switchElement.checked = !!plugin.settings[key]; // Assume boolean
        switchElement.addEventListener("change", () => {
            plugin.settings[key] = switchElement.checked as any;
        });
        return switchElement;
    };

    const createTextareaInput = (key: keyof KarakeepSyncSettings, placeholder: string, rows = 2): HTMLTextAreaElement => {
        const textarea = document.createElement("textarea");
        textarea.className = "b3-text-field fn__block";
        textarea.rows = rows;
        textarea.placeholder = placeholder;
        if (Array.isArray(plugin.settings[key])) {
            textarea.value = (plugin.settings[key] as string[]).join(", ");
        } else {
            textarea.value = "";
        }
        textarea.addEventListener("input", () => {
            (plugin.settings as any)[key] = textarea.value.split(",")
                .map(tag => tag.trim())
                .filter(tag => tag.length > 0);
        });
        return textarea;
    };

    // --- Adding Settings Items ---
    plugin.setting.addItem({
        title: plugin.i18n.apiKey || "Karakeep API Key",
        description: plugin.i18n.apiKeyDesc || "Your API key from Karakeep settings.",
        createActionElement: () => createTextInput("apiKey", plugin.i18n.apiKeyPlaceholder || "Enter your Karakeep API key", "password"),
    });

    plugin.setting.addItem({
        title: plugin.i18n.apiEndpoint || "Karakeep API Endpoint",
        description: plugin.i18n.apiEndpointDesc || `Usually ${DEFAULT_SETTINGS.apiEndpoint} or your self-hosted URL.`,
        createActionElement: () => createTextInput("apiEndpoint", DEFAULT_SETTINGS.apiEndpoint, "url"),
    });

    // Notebook Selector
    const notebookSelect = document.createElement("select");
    notebookSelect.className = "b3-select fn__block";
    notebookSelect.innerHTML = `<option value="">${plugin.i18n.loadingNotebooks || "Loading notebooks..."}</option>`;
    notebookSelect.disabled = true;
    fetchPost(API_LS_NOTEBOOKS, {}, (res) => {
        notebookSelect.innerHTML = ""; // Clear
        if (res.code === 0 && res.data?.notebooks) {
            const placeholderOption = document.createElement("option");
            placeholderOption.value = "";
            placeholderOption.textContent = `-- ${plugin.i18n.selectNotebook || "Select a Notebook"} --`;
            notebookSelect.appendChild(placeholderOption);

            res.data.notebooks.forEach((notebook: { id: string; name: string }) => {
                const option = document.createElement("option");
                option.value = notebook.id;
                option.textContent = notebook.name;
                if (notebook.id === plugin.settings.syncNotebookId) {
                    option.selected = true;
                }
                notebookSelect.appendChild(option);
            });
            notebookSelect.disabled = false;
            if (plugin.settings.syncNotebookId && !res.data.notebooks.some((nb: {id: string}) => nb.id === plugin.settings.syncNotebookId)) {
                plugin.logWarn(`Previously selected notebook (${plugin.settings.syncNotebookId}) not found. Resetting selection.`);
                plugin.settings.syncNotebookId = null;
                placeholderOption.selected = true;
            } else if (!plugin.settings.syncNotebookId) {
                placeholderOption.selected = true;
            }
        } else {
             const errorOption = document.createElement("option");
             errorOption.value = "";
             errorOption.textContent = plugin.i18n.errorLoadingNotebooks || "Error loading notebooks";
             notebookSelect.appendChild(errorOption);
             plugin.logError("Failed to load notebooks:", res?.code, res?.msg);
             showMessage(`${plugin.i18n.errorLoadingNotebooks || "Error loading notebooks"}: ${res?.msg || "Unknown error"}`, 5000, "error");
        }
    });
    notebookSelect.addEventListener("change", () => {
        plugin.settings.syncNotebookId = notebookSelect.value || null;
    });
    plugin.setting.addItem({
        title: plugin.i18n.targetNotebook || "Target SiYuan Notebook",
        description: plugin.i18n.targetNotebookDesc || "The notebook where Karakeep bookmarks will be saved.",
        createActionElement: () => notebookSelect,
    });

    // Other settings items...
    plugin.setting.addItem({
        title: plugin.i18n.syncInterval || "Sync Interval (minutes)",
        description: plugin.i18n.syncIntervalDesc || "How often to automatically sync (0 to disable). Default: 60.",
        createActionElement: () => createNumberInput("syncIntervalMinutes", "60"),
    });

    plugin.setting.addItem({
        title: plugin.i18n.excludedTags || "Excluded Tags",
        description: plugin.i18n.excludedTagsDesc || "Comma-separated. Bookmarks with ANY of these tags won't sync (unless favorited).",
        createActionElement: () => createTextareaInput("excludedTags", plugin.i18n.excludedTagsPlaceholder || "e.g., read-later, temp, project-x"),
    });

    plugin.setting.addItem({
        title: plugin.i18n.updateExisting || "Update Existing Documents",
        description: plugin.i18n.updateExistingDesc || "Overwrite if the Karakeep bookmark is newer (based on modifiedAt).",
        createActionElement: () => createToggleInput("updateExistingFiles")
    });

     plugin.setting.addItem({
        title: plugin.i18n.excludeArchived || "Exclude Archived Bookmarks",
        description: plugin.i18n.excludeArchivedDesc || "Don't sync bookmarks marked as archived in Karakeep.",
        createActionElement: () => createToggleInput("excludeArchived")
    });

     plugin.setting.addItem({
        title: plugin.i18n.onlyFavorites || "Only Sync Favorites",
        description: plugin.i18n.onlyFavoritesDesc || "Only sync favorites. Excluded tags ignored for favorites.",
        createActionElement: () => createToggleInput("onlyFavorites")
    });

     plugin.setting.addItem({
        title: plugin.i18n.downloadAssets || "Download Assets Locally",
        description: plugin.i18n.downloadAssetsDesc || "Download images/assets into SiYuan. Requires Karakeep server access.",
        createActionElement: () => createToggleInput("downloadAssets")
    });

    // Manual Sync Button and Status
    const syncContainer = document.createElement("div");
    syncContainer.className = "fn__flex fn__flex-center";

    // Store the button reference on the plugin instance
    plugin.syncButton = document.createElement("button");
    plugin.syncButton.className = "b3-button b3-button--outline fn__flex-center";
    plugin.syncButton.textContent = plugin.isSyncing ? (plugin.i18n.syncing || "Syncing...") : (plugin.i18n.syncNow || "Sync Now");
    plugin.syncButton.disabled = plugin.isSyncing;
    plugin.syncButton.addEventListener("click", () => {
        const syncCommand = plugin.commands.find(cmd => cmd.langKey === "syncKarakeepBookmarks");
        if (syncCommand?.callback) {
            syncCommand.callback(); // Llama al callback del comando asociado
        } else {
            plugin.logError("Manual sync button: Could not find 'syncKarakeepBookmarks' command.");
            showMessage("Error triggering sync.", 3000, "error");
        }
    });

    // Store the status element reference on the plugin instance
    plugin.syncStatusElement = document.createElement("div");
    plugin.syncStatusElement.className = "ft__smaller ft__on-surface fn__flex-center fn__margin-left";
    plugin.updateSyncStatusDisplay(); // Initial status

    syncContainer.appendChild(plugin.syncButton);
    syncContainer.appendChild(plugin.syncStatusElement);

    plugin.setting.addItem({
        title: plugin.i18n.manualSync || "Manual Sync",
        description: plugin.i18n.manualSyncDesc || "Trigger synchronization immediately.",
        actionElement: syncContainer,
    });
}
