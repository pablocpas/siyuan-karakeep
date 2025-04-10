// index.ts (Versión Unidireccional Revisada según API Docs)

import {
    Plugin,
    showMessage,
    Setting,
    fetchPost,
    fetchSyncPost, // Usar sync para operaciones críticas como buscar si existe
    IObject,
    // Otros imports no usados explícitamente aquí pero disponibles:
    // confirm, Dialog, Menu,
} from "siyuan";
import "./index.scss"; // Si tienes estilos

// --- Interfaces de Hoarder (Sin cambios) ---
interface HoarderTag { id: string; name: string; attachedBy: "ai" | "human"; }
interface HoarderBookmarkContent { type: "link" | "text" | "asset" | "unknown"; url?: string; title?: string; description?: string; imageUrl?: string; imageAssetId?: string; screenshotAssetId?: string; fullPageArchiveAssetId?: string; videoAssetId?: string; favicon?: string; htmlContent?: string; crawledAt?: string; text?: string; sourceUrl?: string; assetType?: "image" | "pdf"; assetId?: string; fileName?: string; }
interface HoarderBookmark { id: string; createdAt: string; modifiedAt?: string; title: string | null; archived: boolean; favourited: boolean; taggingStatus: "success" | "failure" | "pending" | null; note: string | null; summary: string | null; tags: HoarderTag[]; content: HoarderBookmarkContent; }
interface HoarderResponse { bookmarks: HoarderBookmark[]; total: number; nextCursor?: string; }

// --- Settings Interface & Defaults (Sin cambios respecto a la versión unidireccional anterior) ---
interface HoarderSyncSettings {
    apiKey: string;
    apiEndpoint: string;
    syncNotebookId: string | null;
    syncIntervalMinutes: number;
    lastSyncTimestamp: number;
    updateExistingFiles: boolean;
    excludeArchived: boolean;
    onlyFavorites: boolean;
    excludedTags: string[];
    downloadAssets: boolean;
}

const DEFAULT_SETTINGS: HoarderSyncSettings = {
    apiKey: "",
    apiEndpoint: "https://api.hoarder.app/api/v1",
    syncNotebookId: null,
    syncIntervalMinutes: 60,
    lastSyncTimestamp: 0,
    updateExistingFiles: false,
    excludeArchived: true,
    onlyFavorites: false,
    excludedTags: [],
    downloadAssets: true,
};

const STORAGE_SETTINGS_KEY = "hoarder-sync-settings";
const ATTR_PREFIX = "custom-hoarder-";
const ATTR_HOARDER_ID = `${ATTR_PREFIX}id`;
const ATTR_MODIFIED = `${ATTR_PREFIX}modified`;

export default class HoarderSyncPlugin extends Plugin {
    public settings: HoarderSyncSettings;
    private isSyncing: boolean = false;
    private syncIntervalId: number | null = null;
    private syncStatusElement: HTMLElement | null = null;
    private syncButton: HTMLButtonElement | null = null;

    async onload() {
        console.log("Hoarder Sync Plugin (Unidirectional, API Reviewed) loading...");
        await this.loadSettings();
        this.setupSettingsUI();
        this.addCommand({
            langKey: "syncKarakeepBookmarks",
            hotkey: "",
            callback: async () => {
                if (this.isSyncing) {
                    showMessage("Sync is already in progress.", 3000, "info");
                    return;
                }
                showMessage("Starting manual Hoarder sync...");
                const result = await this.syncBookmarks();
                showMessage(result.message, result.success ? 4000 : 6000, result.success ? "info" : "error");
            },
            langText: {
                "en_US": "Sync Hoarder Bookmarks (One-Way)",
                "es_ES": "Sincronizar Marcadores Hoarder (Unidireccional)"
            }
        });
        this.startPeriodicSync();
        console.log("Hoarder Sync Plugin (Unidirectional, API Reviewed) loaded.");
    }

    onunload() {
        console.log("Hoarder Sync Plugin unloading...");
        if (this.syncIntervalId) {
            window.clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
        }
        console.log("Hoarder Sync Plugin unloaded.");
    }

    private async loadSettings() {
        const loadedData = await this.loadData(STORAGE_SETTINGS_KEY);
        const validSettings: Partial<HoarderSyncSettings> = {};
        for (const key in DEFAULT_SETTINGS) {
            if (loadedData && loadedData.hasOwnProperty(key)) {
                (validSettings as any)[key] = loadedData[key];
            }
        }
        this.settings = Object.assign({}, DEFAULT_SETTINGS, validSettings);
        console.log("Settings loaded:", this.settings);
    }

    private async saveSettings() {
        const settingsToSave: Partial<HoarderSyncSettings> = {};
         for (const key in DEFAULT_SETTINGS) {
            if (this.settings.hasOwnProperty(key)) { (settingsToSave as any)[key] = (this.settings as any)[key]; }
        }
        await this.saveData(STORAGE_SETTINGS_KEY, settingsToSave);
        console.log("Settings saved:", settingsToSave);
        if (this.syncStatusElement) { this.updateSyncStatusDisplay(); }
        this.startPeriodicSync(); // Reiniciar con nuevos ajustes de intervalo
    }

    // --- Lógica de Sincronización ---

    startPeriodicSync() {
        if (this.syncIntervalId) { window.clearInterval(this.syncIntervalId); this.syncIntervalId = null; }
        if (!this.settings.syncIntervalMinutes || this.settings.syncIntervalMinutes <= 0) { console.log("Periodic sync disabled (interval <= 0)."); return; }
        const intervalMillis = this.settings.syncIntervalMinutes * 60 * 1000;
        console.log(`Starting periodic sync every ${this.settings.syncIntervalMinutes} minutes.`);
        this.syncIntervalId = window.setInterval(async () => {
            if (this.isSyncing) {
                 console.log("Skipping scheduled sync: previous sync still running.");
                 return;
            }
            console.log("Performing scheduled Hoarder sync...");
            const result = await this.syncBookmarks();
            console.log("Scheduled sync result:", result.message);
        }, intervalMillis);
    }

    // fetchBookmarks: Sin cambios
    async fetchBookmarks(cursor?: string, limit: number = 50): Promise<HoarderResponse> {
        const endpoint = this.settings.apiEndpoint.replace(/\/$/, "");
        const apiUrl = `${endpoint}/bookmarks`;
        const queryParams = new URLSearchParams({ limit: limit.toString(), sort: 'createdAt', order: 'asc' }); // Ordenar ayuda a procesar en orden
        if (cursor) { queryParams.append("cursor", cursor); }
        console.log(`Fetching Hoarder bookmarks: ${apiUrl}?${queryParams.toString()}`);
        try {
            const response = await fetch(`${apiUrl}?${queryParams.toString()}`, { headers: { Authorization: `Bearer ${this.settings.apiKey}`, "Content-Type": "application/json" } });
            if (!response.ok) { const errorText = await response.text(); console.error("Hoarder API Error:", response.status, errorText); throw new Error(`Hoarder API request failed: ${response.status} ${errorText}`); }
            return response.json() as Promise<HoarderResponse>;
        } catch (error) { console.error("Error fetching bookmarks from Hoarder:", error); throw error; }
    }

    // getBookmarkTitle: Sin cambios
    getBookmarkTitle(bookmark: HoarderBookmark): string {
        if (bookmark.title) return bookmark.title;
        if (bookmark.content.type === "link") { if (bookmark.content.title) return bookmark.content.title; if (bookmark.content.url) { try { const url = new URL(bookmark.content.url); const pathTitle = url.pathname.split("/").pop()?.replace(/\.[^/.]+$/, "")?.replace(/[-_]/g, " "); if (pathTitle && pathTitle.trim()) return pathTitle.trim(); return url.hostname.replace(/^www\./, ""); } catch { return bookmark.content.url; } } }
        else if (bookmark.content.type === "text") { if (bookmark.content.text) { const firstLine = bookmark.content.text.split("\n")[0]; return firstLine.length <= 100 ? firstLine : firstLine.substring(0, 97) + "..."; } }
        else if (bookmark.content.type === "asset") { if (bookmark.content.fileName) return bookmark.content.fileName.replace(/\.[^/.]+$/, ""); if (bookmark.content.sourceUrl) { try { const url = new URL(bookmark.content.sourceUrl); return url.pathname.split("/").pop() || url.hostname; } catch { return bookmark.content.sourceUrl; } } }
        return `Bookmark-${bookmark.id}-${new Date(bookmark.createdAt).toISOString().split("T")[0]}`;
    }

    // --- Función Principal de Sincronización (Revisada API SiYuan) ---
    async syncBookmarks(): Promise<{ success: boolean; message: string }> {
        if (this.isSyncing) return { success: false, message: "Sync already in progress." };
        if (!this.settings.apiKey) return { success: false, message: "Hoarder API key not configured." };
        if (!this.settings.syncNotebookId) return { success: false, message: "Target SiYuan notebook not configured." };

        this.setSyncingState(true);
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let excludedByTags = 0;
        let errorOccurred = false;
        let errorMessage = "";
        const notebookId = this.settings.syncNotebookId; // Guardar en variable local

        try {
            console.log("Starting bookmark sync process (unidirectional)...");
            let cursor: string | undefined;
            const processedBookmarkIds = new Set<string>();

            do {
                const result: HoarderResponse = await this.fetchBookmarks(cursor);
                const bookmarks = result.bookmarks || [];
                cursor = result.nextCursor;
                console.log(`Fetched ${bookmarks.length} bookmarks. Next cursor: ${cursor}`);

                for (const bookmark of bookmarks) {
                    if (processedBookmarkIds.has(bookmark.id)) continue;
                    processedBookmarkIds.add(bookmark.id);

                    // --- Filtrado local ---
                    if (this.settings.excludeArchived && bookmark.archived) continue;
                    if (this.settings.onlyFavorites && !bookmark.favourited) continue;
                    if (!bookmark.favourited && this.settings.excludedTags.length > 0) {
                        const bookmarkTagsLower = bookmark.tags.map((tag) => tag.name.toLowerCase());
                        const excludedTagsLower = this.settings.excludedTags.map(t => t.toLowerCase());
                        if (excludedTagsLower.some((excludedTag) => bookmarkTagsLower.includes(excludedTag))) { excludedByTags++; continue; }
                    }

                    const title = this.getBookmarkTitle(bookmark);
                    // Asegurarse que el path empieza con /
                    const safeDocPath = `/${this.sanitizeSiYuanPath(title, bookmark.createdAt)}`.replace(/^\/+/, "/");

                    // --- Buscar documento existente ---
                    const querySql = `SELECT id FROM blocks WHERE type = 'd' AND attr_name = '${ATTR_HOARDER_ID}' AND attr_value = '${bookmark.id}' LIMIT 1`;
                    let existingDocId: string | null = null;
                    try {
                        const queryResult = await fetchSyncPost('/api/query/sql', { stmt: querySql });
                        if (queryResult.code === 0 && queryResult.data?.length > 0) { // Verificar data no sea null
                            existingDocId = queryResult.data[0].id;
                        } else if (queryResult.code !== 0) {
                            console.error(`SiYuan SQL query failed [${queryResult.code}]: ${queryResult.msg}`);
                            // Decide how to handle: skip this bookmark or stop the sync? Let's skip.
                            errorMessage = `SQL query failed: ${queryResult.msg}. Some items might be skipped.`;
                            errorOccurred = true; // Marcar que hubo un error leve
                            continue; // Saltar este bookmark
                        }
                    } catch (e) {
                         console.error(`Network error during SiYuan SQL query (bookmark ${bookmark.id}):`, e);
                         errorMessage = `Network error during SQL query. Some items might be skipped.`;
                         errorOccurred = true;
                         continue; // Saltar este bookmark
                    }

                    if (existingDocId) {
                        // --- Documento Existe: Decidir si actualizar o saltar ---
                        let updateThisDoc = false;
                        if (this.settings.updateExistingFiles) {
                            try {
                                const attrsResult = await fetchPost('/api/attr/getBlockAttrs', { id: existingDocId });
                                if (attrsResult.code === 0 && attrsResult.data) { // Verificar data no sea null
                                    const attrs = attrsResult.data;
                                    const storedModifiedTime = attrs[ATTR_MODIFIED] ? new Date(attrs[ATTR_MODIFIED]).getTime() : 0;
                                    const bookmarkModifiedTime = bookmark.modifiedAt ? new Date(bookmark.modifiedAt).getTime() : new Date(bookmark.createdAt).getTime();
                                    if (!storedModifiedTime || bookmarkModifiedTime > storedModifiedTime) {
                                        updateThisDoc = true;
                                        console.log(`Marking doc ${existingDocId} for update (bookmark ${bookmark.id} is newer).`);
                                    }
                                } else {
                                    console.warn(`Could not get attributes for existing doc ${existingDocId} [${attrsResult.code}]: ${attrsResult.msg}. Assuming update needed.`);
                                    updateThisDoc = true; // Asumir update si no podemos leer atributos
                                }
                            } catch (e) {
                                console.error(`Network error checking modification time for doc ${existingDocId}:`, e);
                                updateThisDoc = true; // Asumir update en caso de error
                            }
                        }

                        if (updateThisDoc) {
                            // --- Actualizar (Borrar y Recrear) ---
                            console.log(`Updating document ${existingDocId} for bookmark ${bookmark.id}`);
                                                            // 2. Crear el nuevo documento (usando fetchSyncPost)
                                                                // 2. Crear el nuevo documento (usando fetchSyncPost)
                            try {
                                const markdownContent = await this.formatBookmarkAsMarkdown(bookmark, title);
                                const createParams = {
                                    notebook: notebookId,
                                    path: safeDocPath,
                                    markdown: markdownContent,
                                };
                                console.log("Recreating doc with params (using fetchSyncPost):", JSON.stringify(createParams));

                                // *** USA fetchSyncPost ***
                                const createResult = await fetchSyncPost('/api/filetree/createDocWithMd', createParams);
                                console.log(`[Debug] fetchSyncPost completed for RECREATION of ${bookmark.id}. Raw result:`, createResult);

                                // La verificación ahora debería funcionar directamente
                                if (createResult?.code === 0 && createResult.data) {
                                    const newDocId = createResult.data as string; // La API devuelve string aquí
                                    console.log(`Document recreated via API for bookmark ${bookmark.id}, received ID directly: ${newDocId}.`);
                                    await this.setSiYuanAttributes(newDocId, bookmark, title);
                                    updatedCount++;
                                    console.log(`Successfully processed and attributed (via fetchSyncPost) UPDATED bookmark ${bookmark.id} as new doc ${newDocId}`);
                                } else {
                                        // fetchSyncPost falló o devolvió un código de error
                                    const errorCode = createResult?.code ?? 'N/A';
                                    const errorMsg = createResult?.msg ?? 'fetchSyncPost failed or returned unexpected result during recreation';
                                    console.error(`Failed to recreate document using fetchSyncPost for bookmark ${bookmark.id} [${errorCode}]: ${errorMsg}`);
                                    skippedCount++;
                                }
                            } catch (e: any) { // Catch para errores en formatBookmarkAsMarkdown o fetchSyncPost
                                console.error(`Error during document recreation process (using fetchSyncPost) for bookmark ${bookmark.id}:`, e.message || e);
                                skippedCount++;
                            }
                        } else {
                            // --- Saltar documento existente ---
                             console.log(`Skipping existing document ${existingDocId} (up-to-date or update disabled).`);
                             skippedCount++;
                        }
                    } else {
                        // --- Documento No Existe: Crear Nuevo ---
                        console.log(`Creating new document for bookmark ${bookmark.id} at path ${notebookId}:${safeDocPath}`);
                        try {
                            const markdownContent = await this.formatBookmarkAsMarkdown(bookmark, title);
                            const createParams = {
                                notebook: notebookId,
                                path: safeDocPath,
                                markdown: markdownContent,
                            };
                            console.log("Creating doc with params (using fetchSyncPost):", JSON.stringify(createParams));

                            // *** USA fetchSyncPost ***
                            const createResult = await fetchSyncPost('/api/filetree/createDocWithMd', createParams);
                            console.log(`[Debug] fetchSyncPost completed for CREATION of ${bookmark.id}. Raw result:`, createResult);

                            // La verificación ahora debería funcionar directamente
                            if (createResult?.code === 0 && createResult.data) {
                                const newDocId = createResult.data as string; // La API devuelve string aquí
                                console.log(`Document created via API for bookmark ${bookmark.id}, received ID directly: ${newDocId}.`);
                                await this.setSiYuanAttributes(newDocId, bookmark, title);
                                createdCount++;
                                console.log(`Successfully processed and attributed (via fetchSyncPost) bookmark ${bookmark.id} as new doc ${newDocId}`);
                            } else {
                                // fetchSyncPost falló o devolvió un código de error
                                const errorCode = createResult?.code ?? 'N/A';
                                const errorMsg = createResult?.msg ?? 'fetchSyncPost failed or returned unexpected result';
                                console.error(`Failed to create document using fetchSyncPost for bookmark ${bookmark.id} [${errorCode}]: ${errorMsg}. Path: ${safeDocPath}`);
                                skippedCount++;
                            }
                        } catch (e: any) { // Catch para errores en formatBookmarkAsMarkdown o fetchSyncPost
                            console.error(`Error during document creation process (using fetchSyncPost) for bookmark ${bookmark.id}:`, e.message || e);
                            skippedCount++;
                        }
                    }
                } // Fin for bookmarks
            } while (cursor); // Fin do...while

            console.log("Bookmark sync process finished.");
            this.settings.lastSyncTimestamp = Date.now();
            await this.saveSettings();

        } catch (error) {
            console.error("Critical error during bookmark sync:", error);
            errorOccurred = true; // Marcar error crítico
            errorMessage = `Sync failed critically: ${error.message || "Unknown error"}`;
        } finally {
            this.setSyncingState(false);
        }

        // Construir mensaje final
        let finalMessage = errorMessage; // Empezar con mensaje de error si lo hubo
        if (!finalMessage || !errorOccurred) { // Si no hubo error crítico, construir mensaje normal
            finalMessage = `Sync complete: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped`;
            if (excludedByTags > 0) { finalMessage += `, ${excludedByTags} excluded by tags`; }
            if (errorOccurred) { // Añadir aviso de errores leves si los hubo
                finalMessage += `. Note: Some non-critical errors occurred (check console log).`;
            }
        }

        return { success: !errorOccurred, message: finalMessage }; // Éxito si no hubo errores críticos
    }

    // --- Funciones Auxiliares ---

    // setSyncingState: Sin cambios
    private setSyncingState(syncing: boolean) { this.isSyncing = syncing; if (this.syncButton) { this.syncButton.disabled = syncing; this.syncButton.textContent = syncing ? "Syncing..." : "Sync Now"; } console.log(`Syncing state set to: ${syncing}`); }

    // sanitizeSiYuanPath: Sin cambios
    sanitizeSiYuanPath(title: string, createdAt: string): string { const dateStr = new Date(createdAt).toISOString().split("T")[0]; let sanitizedTitle = title.replace(/[\\\/:\*\?"<>\|#%\^\&\{\}\[\]]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").replace(/^\.+|\.+$/g, ""); const maxTitleLength = 50; if (sanitizedTitle.length > maxTitleLength) { sanitizedTitle = sanitizedTitle.substring(0, maxTitleLength).replace(/-+$/, ""); } if (!sanitizedTitle) { sanitizedTitle = `bookmark-${dateStr}`; } return `${dateStr}-${sanitizedTitle}`; }

    // downloadAsset: Revisado para usar 'assets[]', mantenemos 'notebook'
    async downloadAsset(assetUrl: string, assetId: string, title: string): Promise<string | null> {
        console.log(`Attempting to download and upload asset: ${assetUrl}`);
        try {
            const headers: Record<string, string> = {}; const apiDomain = new URL(this.settings.apiEndpoint).origin; if (assetUrl.startsWith(apiDomain)) { headers["Authorization"] = `Bearer ${this.settings.apiKey}`; }
            const response = await fetch(assetUrl, { headers }); if (!response.ok) { throw new Error(`Failed to download asset (${response.status}): ${assetUrl}`); }
            const buffer = await response.arrayBuffer(); let fileName = assetUrl.substring(assetUrl.lastIndexOf('/') + 1).split('?')[0]; if (!fileName || fileName.length > 50) { const extension = fileName.split('.').pop() || 'asset'; const safeTitle = title.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 20); fileName = `${assetId}-${safeTitle}.${extension}`; } fileName = fileName.replace(/[\\\/:\*\?"<>\|]/g, "-");
            const formData = new FormData();
            // Usar 'assets[]' como en el ejemplo del plugin
            formData.append('assets[]', new File([buffer], fileName));
            // El parámetro 'notebook' no está en la doc de /api/asset/upload, pero lo mantenemos por si acaso
            if (this.settings.syncNotebookId) { formData.append('notebook', this.settings.syncNotebookId); }
            // 'assetsDirPath' tampoco está en el ejemplo, asumimos que SiYuan lo gestiona por defecto en /data/assets/
            // formData.append('assetsDirPath', '/assets/'); // Podría añadirse si fuera necesario

            console.log(`Uploading asset '${fileName}' to SiYuan...`);
            const uploadResult = await fetchPost('/api/asset/upload', formData);

            if (uploadResult.code === 0 && uploadResult.data?.succMap && uploadResult.data.succMap[fileName]) {
                const siyuanAssetPath = uploadResult.data.succMap[fileName];
                console.log(`Asset uploaded successfully to SiYuan: ${siyuanAssetPath}`);
                return siyuanAssetPath; // e.g., "assets/nombre-archivo-1234.ext"
            } else {
                 console.error("Failed to upload asset to SiYuan:", uploadResult?.msg || "Unknown upload error", uploadResult);
                 return null;
            }
        } catch (error) { console.error("Error downloading/uploading asset:", error); return null; }
    }

    // formatBookmarkAsMarkdown: Sin cambios respecto a la versión unidireccional anterior
    async formatBookmarkAsMarkdown(bookmark: HoarderBookmark, title: string): Promise<string> { const url = bookmark.content.type === "link" ? bookmark.content.url : bookmark.content.sourceUrl; const description = bookmark.content.type === "link" ? bookmark.content.description : bookmark.content.text; const getHoarderAssetUrl = (assetId: string): string => { const baseUrl = this.settings.apiEndpoint.replace(/\/api\/v1\/?$/, ""); return `${baseUrl}/assets/${assetId}`; }; let content = `# ${title}\n\n`; let assetMarkdown = ""; if (this.settings.downloadAssets) { let assetToDownloadUrl: string | undefined; let assetIdToUse: string | undefined; if (bookmark.content.type === "asset" && bookmark.content.assetType === "image" && bookmark.content.assetId) { assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.assetId); assetIdToUse = bookmark.content.assetId; } else if (bookmark.content.type === "link" && bookmark.content.imageAssetId) { assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.imageAssetId); assetIdToUse = bookmark.content.imageAssetId; } if (assetToDownloadUrl && assetIdToUse) { const siyuanAssetPath = await this.downloadAsset(assetToDownloadUrl, assetIdToUse, title); if (siyuanAssetPath) { assetMarkdown = `![${title || 'asset'}](${siyuanAssetPath})\n\n`; } else { assetMarkdown = `[Failed to download asset: View on Hoarder](${assetToDownloadUrl})\n\n`; } } else if (bookmark.content.imageUrl) { assetMarkdown = `![${title || 'image'}](${bookmark.content.imageUrl})\n\n`; } } else { let externalImageUrl: string | undefined; if (bookmark.content.type === "asset" && bookmark.content.assetType === "image" && bookmark.content.assetId) { externalImageUrl = getHoarderAssetUrl(bookmark.content.assetId); } else if (bookmark.content.type === "link" && bookmark.content.imageAssetId) { externalImageUrl = getHoarderAssetUrl(bookmark.content.imageAssetId); } else if (bookmark.content.imageUrl) { externalImageUrl = bookmark.content.imageUrl; } if (externalImageUrl) { assetMarkdown = `![${title || 'image'}](${externalImageUrl})\n\n`; } } content += assetMarkdown; if (url && bookmark.content.type !== "asset") { content += `**URL:** [${url}](${url})\n\n`; } if (bookmark.summary) { content += `## Summary\n\n${bookmark.summary}\n\n`; } if (description) { content += `## Description\n\n${description}\n\n`; } content += `## Notes\n\n${bookmark.note || ""}\n\n`; const hoarderBaseUrl = this.settings.apiEndpoint.replace("/api/v1", ""); content += `----\n[View in Hoarder](${hoarderBaseUrl}/dashboard/preview/${bookmark.id})`; return content; }

    // setSiYuanAttributes: Sin cambios respecto a la versión unidireccional anterior
    async setSiYuanAttributes(docRootId: string, bookmark: HoarderBookmark, title: string) { const attrs: IObject = { [ATTR_HOARDER_ID]: bookmark.id, [`${ATTR_PREFIX}url`]: bookmark.content.type === 'link' ? bookmark.content.url : bookmark.content.sourceUrl || '', [`${ATTR_PREFIX}title`]: title, [`${ATTR_PREFIX}created`]: new Date(bookmark.createdAt).toISOString(), [ATTR_MODIFIED]: bookmark.modifiedAt ? new Date(bookmark.modifiedAt).toISOString() : new Date(bookmark.createdAt).toISOString(), [`${ATTR_PREFIX}tags`]: bookmark.tags.map(t => t.name).join(', '), [`${ATTR_PREFIX}summary`]: bookmark.summary || '', [`${ATTR_PREFIX}favourited`]: String(bookmark.favourited), [`${ATTR_PREFIX}archived`]: String(bookmark.archived), }; try { console.log(`Setting attributes for doc ${docRootId}:`, attrs); const setResult = await fetchPost('/api/attr/setBlockAttrs', { id: docRootId, attrs: attrs }); if (setResult.code !== 0) { console.error(`Failed to set attributes for doc ${docRootId} [${setResult.code}]: ${setResult.msg}`); } } catch (error) { console.error(`Network error setting attributes for doc ${docRootId}:`, error); } }

    // --- UI de Ajustes (Sin cambios funcionales, solo texto título) ---
        // --- UI de Ajustes (Corregido fetchPost) ---
        private async setupSettingsUI() {
            this.setting = new Setting({ height: "auto", width: "600px", title: "Hoarder Sync Settings (One-Way)", confirmCallback: async () => { if (!this.settings.apiKey || !this.settings.apiEndpoint || !this.settings.apiEndpoint.startsWith("http") || !this.settings.syncNotebookId) { showMessage("Please fill in API Key, valid Endpoint, and select a Notebook.", 3000, "error"); return; } await this.saveSettings(); showMessage("Hoarder settings saved."); } });
            const createTextField = (key: keyof HoarderSyncSettings, placeholder: string, type: string = 'text') => { const input = document.createElement('input'); input.type = type; input.className = 'b3-text-field fn__block'; input.placeholder = placeholder; input.value = String(this.settings[key] || (type === 'number' ? '60' : '')); input.addEventListener('input', () => { if (type === 'number') { const numValue = parseInt(input.value); this.settings[key] = isNaN(numValue) ? 60 : Math.max(0, numValue) as any; input.value = String(this.settings[key]); } else { this.settings[key] = input.value as any; } }); return input; };
            const createToggle = (key: keyof HoarderSyncSettings) => { const switchElement = document.createElement('input'); switchElement.type = 'checkbox'; switchElement.className = 'b3-switch fn__flex-center'; switchElement.checked = !!this.settings[key]; switchElement.addEventListener('change', () => { this.settings[key] = switchElement.checked as any; }); const container = document.createElement('span'); container.appendChild(switchElement); return container; };
            this.setting.addItem({ title: "Hoarder API Key", description: "Your API key from Hoarder settings.", createActionElement: () => createTextField('apiKey', 'Enter your Hoarder API key', 'password'), });
            this.setting.addItem({ title: "Hoarder API Endpoint", description: "Usually https://api.hoarder.app/api/v1 or your self-hosted URL.", createActionElement: () => createTextField('apiEndpoint', DEFAULT_SETTINGS.apiEndpoint), });
    
            // --- Corrección aquí ---
            const notebookSelect = document.createElement('select');
            notebookSelect.className = 'b3-select fn__block'; // Clase SiYuan
            notebookSelect.innerHTML = '<option value="">Loading notebooks...</option>';
            notebookSelect.disabled = true;
    
            // Usar el patrón de callback de fetchPost
            fetchPost('/api/notebook/lsNotebooks', {}, (res: { code: number; msg: string; data?: { notebooks: Array<{ id: string; name: string }> } }) => {
                // El código que antes estaba en .then() va aquí dentro
                if (res.code === 0 && res.data?.notebooks) {
                    notebookSelect.innerHTML = '<option value="">-- Select a Notebook --</option>'; // Opción por defecto
                    res.data.notebooks.forEach((notebook) => { // No necesitas el tipo explícito aquí si 'res' está tipado
                        const option = document.createElement('option');
                        option.value = notebook.id;
                        option.textContent = notebook.name;
                        if (notebook.id === this.settings.syncNotebookId) {
                            option.selected = true;
                        }
                        notebookSelect.appendChild(option);
                    });
                    notebookSelect.disabled = false;
                } else {
                    // El código que antes estaba en .catch() o para manejar errores va aquí
                    notebookSelect.innerHTML = '<option value="">Error loading notebooks</option>';
                    console.error("Failed to load notebooks:", res.code, res.msg);
                    // Podrías mostrar un showMessage aquí también si quieres notificar al usuario
                    // showMessage(`Error loading notebooks: ${res.msg || 'Unknown error'}`, 5000, 'error');
                }
            });
            // --- Fin de la corrección ---
    
            notebookSelect.addEventListener('change', () => {
                this.settings.syncNotebookId = notebookSelect.value || null;
            });
            this.setting.addItem({ title: "Target SiYuan Notebook", description: "The notebook where Hoarder bookmarks will be saved.", createActionElement: () => notebookSelect, });
    
            // ... (resto de los items de configuración sin cambios) ...
            this.setting.addItem({ title: "Sync Interval (minutes)", description: "How often to automatically sync (0 to disable auto-sync).", createActionElement: () => createTextField('syncIntervalMinutes', '60', 'number'), });
            const tagsInput = document.createElement('textarea'); tagsInput.className = 'b3-text-field fn__block'; tagsInput.rows = 2; tagsInput.placeholder = 'tag1, tag2, another tag'; tagsInput.value = this.settings.excludedTags.join(', '); tagsInput.addEventListener('input', () => { this.settings.excludedTags = tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0); });
            this.setting.addItem({ title: "Excluded Tags", description: "Comma-separated tags. Bookmarks with these tags won't be synced (unless favorited).", createActionElement: () => tagsInput, });
            this.setting.addItem({ title: "Update Existing Documents", description: "Overwrite existing SiYuan documents if the Hoarder bookmark is newer.", createActionElement: () => createToggle('updateExistingFiles') });
            this.setting.addItem({ title: "Exclude Archived Bookmarks", description: "Don't sync bookmarks marked as archived in Hoarder.", createActionElement: () => createToggle('excludeArchived') });
            this.setting.addItem({ title: "Only Sync Favorites", description: "Only sync bookmarks marked as favorite in Hoarder.", createActionElement: () => createToggle('onlyFavorites') });
            this.setting.addItem({ title: "Download Assets Locally", description: "Download images/assets into SiYuan instead of linking externally.", createActionElement: () => createToggle('downloadAssets') });
            const syncContainer = document.createElement('div'); syncContainer.className = "fn__flex";
            this.syncButton = document.createElement('button'); this.syncButton.className = 'b3-button b3-button--outline'; this.syncButton.textContent = this.isSyncing ? "Syncing..." : "Sync Now"; this.syncButton.disabled = this.isSyncing; this.syncButton.addEventListener('click', async () => { if (this.isSyncing) { showMessage("Sync is already in progress.", 3000, "info"); return; } showMessage("Starting manual Hoarder sync..."); const result = await this.syncBookmarks(); showMessage(result.message, result.success ? 4000 : 6000, result.success ? "info" : "error"); });
            this.syncStatusElement = document.createElement('div'); this.syncStatusElement.className = "ft__smaller ft__on-surface fn__flex-center fn__margin-left"; this.updateSyncStatusDisplay();
            syncContainer.appendChild(this.syncButton); syncContainer.appendChild(this.syncStatusElement);
            this.setting.addItem({ title: "Manual Sync", description: "Trigger a synchronization with Hoarder immediately.", actionElement: syncContainer, });
        }
    
        // ... (resto de la clase Plugin sin cambios) ...
    
         // updateSyncStatusDisplay: Sin cambios
        private updateSyncStatusDisplay() { if (this.syncStatusElement) { if (this.settings.lastSyncTimestamp > 0) { this.syncStatusElement.textContent = `Last synced: ${new Date(this.settings.lastSyncTimestamp).toLocaleString()}`; } else { this.syncStatusElement.textContent = "Never synced."; } } }
    } // Fin de la clase HoarderSyncPlugin