// index.ts (Versión Unidireccional Final Revisada)

import {
    Plugin,
    showMessage,
    Setting,
    fetchPost,      // Usado correctamente para lsNotebooks con callback
    fetchSyncPost,  // Usado para operaciones donde necesitamos esperar el resultado
    IObject,
    IWebSocketData, // Añadido para tipar mejor las respuestas de fetchSyncPost
    // Otros imports no usados explícitamente aquí pero disponibles:
    // confirm, Dialog, Menu,
} from "siyuan";

import TurndownService from 'turndown'; // <-- Añadir esta línea

import "./index.scss"; // Si tienes estilos

// --- Interfaces de Hoarder (Sin cambios) ---
interface HoarderTag { id: string; name: string; attachedBy: "ai" | "human"; }
interface HoarderBookmarkContent { type: "link" | "text" | "asset" | "unknown"; url?: string; title?: string; description?: string; imageUrl?: string; imageAssetId?: string; screenshotAssetId?: string; fullPageArchiveAssetId?: string; videoAssetId?: string; favicon?: string; htmlContent?: string; crawledAt?: string; text?: string; sourceUrl?: string; assetType?: "image" | "pdf"; assetId?: string; fileName?: string; }
interface HoarderBookmark { id: string; createdAt: string; modifiedAt?: string; title: string | null; archived: boolean; favourited: boolean; taggingStatus: "success" | "failure" | "pending" | null; note: string | null; summary: string | null; tags: HoarderTag[]; content: HoarderBookmarkContent; }
interface HoarderResponse { bookmarks: HoarderBookmark[]; total: number; nextCursor?: string; }

// --- Settings Interface & Defaults (Sin cambios) ---
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
        console.log("Hoarder Sync Plugin (Unidirectional, Final Review) loading...");
        await this.loadSettings();
        // Llamar a setupSettingsUI *después* de loadSettings
        // Nota: setupSettingsUI contiene una llamada asíncrona (fetchPost para notebooks)
        // pero no necesitamos esperar a que termine aquí para que el plugin cargue.
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
        console.log("Hoarder Sync Plugin (Unidirectional, Final Review) loaded.");
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
        // Cargar solo las propiedades definidas en DEFAULT_SETTINGS para evitar datos obsoletos
        const validSettings: Partial<HoarderSyncSettings> = {};
        for (const key in DEFAULT_SETTINGS) {
            if (loadedData && loadedData.hasOwnProperty(key)) {
                (validSettings as any)[key] = loadedData[key];
            }
        }
        this.settings = { ...DEFAULT_SETTINGS, ...validSettings }; // Asegura todos los defaults + datos cargados
        console.log("Settings loaded:", this.settings);
    }

    private async saveSettings() {
        // Guardar solo las propiedades definidas en DEFAULT_SETTINGS
        const settingsToSave: Partial<HoarderSyncSettings> = {};
        for (const key in DEFAULT_SETTINGS) {
            if (this.settings.hasOwnProperty(key)) {
                (settingsToSave as any)[key] = (this.settings as any)[key];
            }
        }
        await this.saveData(STORAGE_SETTINGS_KEY, settingsToSave);
        console.log("Settings saved:", settingsToSave);
        if (this.syncStatusElement) {
            this.updateSyncStatusDisplay();
        }
        this.startPeriodicSync(); // Reiniciar con nuevos ajustes de intervalo
    }

    // --- Lógica de Sincronización ---

    startPeriodicSync() {
        if (this.syncIntervalId) {
            window.clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
        }
        if (!this.settings.syncIntervalMinutes || this.settings.syncIntervalMinutes <= 0) {
            console.log("Periodic sync disabled (interval <= 0).");
            return;
        }
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
            // Podrías añadir un showMessage opcional aquí si quieres feedback visual
            // showMessage(`Scheduled sync: ${result.message}`, 3000, result.success ? 'info' : 'error');
        }, intervalMillis);
    }

    // fetchBookmarks: Sin cambios
    async fetchBookmarks(cursor?: string, limit: number = 50): Promise<HoarderResponse> {
        const endpoint = this.settings.apiEndpoint.replace(/\/$/, ""); // Quita / final si existe
        const apiUrl = `${endpoint}/bookmarks`;
        const queryParams = new URLSearchParams({
            limit: limit.toString(),
            sort: 'createdAt', // O 'modifiedAt' si prefieres procesar cambios recientes primero
            order: 'asc'       // 'asc' para procesar desde el más antiguo, 'desc' para el más nuevo
        });
        if (cursor) {
            queryParams.append("cursor", cursor);
        }
        console.log(`Fetching Hoarder bookmarks: ${apiUrl}?${queryParams.toString()}`);
        try {
            const response = await fetch(`${apiUrl}?${queryParams.toString()}`, {
                headers: {
                    Authorization: `Bearer ${this.settings.apiKey}`,
                    "Content-Type": "application/json",
                }
            });
            if (!response.ok) {
                const errorText = await response.text();
                console.error("Hoarder API Error:", response.status, errorText);
                throw new Error(`Hoarder API request failed: ${response.status} ${errorText}`);
            }
            return response.json() as Promise<HoarderResponse>;
        } catch (error) {
            console.error("Error fetching bookmarks from Hoarder:", error);
            throw error; // Re-lanzar para que syncBookmarks lo maneje
        }
    }

    // getBookmarkTitle: Sin cambios
    getBookmarkTitle(bookmark: HoarderBookmark): string {
        if (bookmark.title) return bookmark.title;
        if (bookmark.content.type === "link") {
            if (bookmark.content.title) return bookmark.content.title;
            if (bookmark.content.url) {
                try {
                    const url = new URL(bookmark.content.url);
                    const pathTitle = url.pathname.split("/").pop()?.replace(/\.[^/.]+$/, "")?.replace(/[-_]/g, " ");
                    if (pathTitle && pathTitle.trim()) return pathTitle.trim();
                    return url.hostname.replace(/^www\./, "");
                } catch { return bookmark.content.url; } // Si la URL no es válida
            }
        } else if (bookmark.content.type === "text") {
            if (bookmark.content.text) {
                const firstLine = bookmark.content.text.split("\n")[0];
                return firstLine.length <= 100 ? firstLine : firstLine.substring(0, 97) + "...";
            }
        } else if (bookmark.content.type === "asset") {
            if (bookmark.content.fileName) return bookmark.content.fileName.replace(/\.[^/.]+$/, "");
            if (bookmark.content.sourceUrl) {
                try {
                    const url = new URL(bookmark.content.sourceUrl);
                    return url.pathname.split("/").pop() || url.hostname;
                } catch { return bookmark.content.sourceUrl; }
            }
        }
        // Fallback title
        return `Bookmark-${bookmark.id}-${new Date(bookmark.createdAt).toISOString().split("T")[0]}`;
    }

    // --- Función Principal de Sincronización (Usando fetchSyncPost donde es necesario) ---
    // --- Función Principal de Sincronización (Revisada: Detectar por API getIDsByHPath) ---
    async syncBookmarks(): Promise<{ success: boolean; message: string }> {
        // ... (inicio sin cambios: checks iniciales, setSyncingState, contadores, etc.) ...
        if (this.isSyncing) return { success: false, message: "Sync already in progress." };
        if (!this.settings.apiKey) return { success: false, message: "Hoarder API key not configured." };
        if (!this.settings.syncNotebookId) return { success: false, message: "Target SiYuan notebook not configured." };

        this.setSyncingState(true);
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let excludedByTags = 0;
        let errorOccurred = false;
        let criticalErrorOccurred = false;
        let errorMessage = "";
        const notebookId = this.settings.syncNotebookId;

        try {
            console.log("Starting bookmark sync process (unidirectional, checking by API getIDsByHPath)...");
            let cursor: string | undefined;
            const processedBookmarkIds = new Set<string>();

            do {
                const result: HoarderResponse = await this.fetchBookmarks(cursor);
                const bookmarks = result.bookmarks || [];
                cursor = result.nextCursor;
                console.log(`Fetched ${bookmarks.length} bookmarks. Next cursor: ${cursor}`);

                for (const bookmark of bookmarks) {
                    if (processedBookmarkIds.has(bookmark.id)) { continue; }
                    processedBookmarkIds.add(bookmark.id);

                    // --- Filtrado local (sin cambios) ---
                    if (this.settings.excludeArchived && bookmark.archived) { skippedCount++; continue; }
                    if (this.settings.onlyFavorites && !bookmark.favourited) { skippedCount++; continue; }
                    if (!bookmark.favourited && this.settings.excludedTags.length > 0) {
                        const bookmarkTagsLower = bookmark.tags.map((tag) => tag.name.toLowerCase());
                        const excludedTagsLower = this.settings.excludedTags.map(t => t.toLowerCase().trim()).filter(t => t);
                        if (excludedTagsLower.some((excludedTag) => bookmarkTagsLower.includes(excludedTag))) {
                            excludedByTags++; skippedCount++; continue;
                        }
                    }

                    const title = this.getBookmarkTitle(bookmark);
                    const safeDocPath = `/${this.sanitizeSiYuanPath(title, bookmark.createdAt)}`.replace(/^\/+/, "/"); // Esta sigue siendo la ruta que queremos

                    // --- Buscar documento existente POR HPATH usando la API ---
                    console.log(`[Debug HPathCheck] Checking existence via API /getIDsByHPath for path: ${safeDocPath} in notebook ${notebookId}`);
                    let existingDocId: string | null = null;
                    try {
                        const checkResult = await fetchSyncPost('/api/filetree/getIDsByHPath', {
                            path: safeDocPath, // La ruta legible por humanos
                            notebook: notebookId
                        });
                        console.log(`[Debug HPathCheck] API /getIDsByHPath result for path ${safeDocPath}:`, checkResult);

                        if (checkResult.code === 0 && checkResult.data && Array.isArray(checkResult.data) && checkResult.data.length > 0) {
                            // Encontrado, tomar el primer ID (normalmente solo habrá uno)
                            existingDocId = checkResult.data[0];
                            console.log(`[Debug HPathCheck] Found existing document ID via API: ${existingDocId}`);
                        } else if (checkResult.code === 0) {
                            // Código 0 pero data vacío o no es array válido -> No encontrado
                             console.log(`[Debug HPathCheck] No document found via API for path ${safeDocPath}. Will create.`);
                        } else {
                            // Error de la API
                            console.error(`API /getIDsByHPath failed [${checkResult.code}]: ${checkResult.msg}`);
                            errorMessage = `API check failed: ${checkResult.msg}.`;
                            errorOccurred = true;
                            skippedCount++;
                            continue; // Saltar este bookmark
                        }
                    } catch (e: any) {
                         console.error(`Network error during API /getIDsByHPath check (bookmark ${bookmark.id}):`, e.message || e);
                         errorMessage = `Network error during API check.`;
                         errorOccurred = true;
                         skippedCount++;
                         continue; // Saltar este bookmark
                    }

                    // --- Lógica Principal (Exactamente la misma que antes, ahora usa el existingDocId correcto) ---
                    if (existingDocId) {
                        // --- Documento Encontrado por HPath API: Decidir si actualizar o saltar ---
                        let updateThisDoc = false;
                        if (this.settings.updateExistingFiles) {
                           // ... (Exactamente el mismo código que antes para obtener atributos y comparar fechas) ...
                            try {
                                const attrsResult = await fetchSyncPost('/api/attr/getBlockAttrs', { id: existingDocId });
                                if (attrsResult.code === 0 && attrsResult.data) {
                                    const attrs = attrsResult.data;
                                    const storedModifiedTime = attrs[ATTR_MODIFIED] ? new Date(attrs[ATTR_MODIFIED]).getTime() : 0;
                                    const bookmarkModifiedTime = bookmark.modifiedAt ? new Date(bookmark.modifiedAt).getTime() : new Date(bookmark.createdAt).getTime();
                                    if (!storedModifiedTime || bookmarkModifiedTime > storedModifiedTime) {
                                        updateThisDoc = true;
                                        console.log(`Marking doc ${existingDocId} (found by HPath API) for update (bookmark ${bookmark.id} modified: ${bookmarkModifiedTime} > stored: ${storedModifiedTime}).`);
                                    } else {
                                         console.log(`Skipping update for ${existingDocId} (found by HPath API, bookmark ${bookmark.id} not modified or older).`);
                                    }
                                } else {
                                    console.warn(`Could not get attributes for existing doc ${existingDocId} (found by HPath API) [${attrsResult?.code}] ${attrsResult?.msg}. Assuming update needed.`);
                                    updateThisDoc = true;
                                }
                            } catch (e: any) {
                                console.error(`Network error checking modification time for doc ${existingDocId} (found by HPath API):`, e.message || e);
                                updateThisDoc = true;
                            }
                        }

                        if (updateThisDoc) {
                            // --- Actualizar (Borrar el encontrado por HPath API y Recrear con el mismo path) ---
                             // ... (Exactamente el mismo código que antes para borrar, recrear y poner atributos) ...
                            console.log(`Attempting to update document ${existingDocId} (found by HPath API) for bookmark ${bookmark.id}`);
                            let deleteSuccess = false;
                            try {
                                const deleteResult = await fetchSyncPost('/api/filetree/removeDocByID', { id: existingDocId });
                                if (deleteResult.code === 0) {
                                    console.log(`Successfully deleted existing doc ${existingDocId} (found by HPath API) for update.`);
                                    deleteSuccess = true;
                                } else {
                                    console.error(`Failed to delete existing document ${existingDocId} (found by HPath API) for update [${deleteResult?.code}]: ${deleteResult?.msg}`);
                                    skippedCount++; errorOccurred = true;
                                }
                            } catch (e: any) {
                                console.error(`Network error during delete operation for doc ${existingDocId} (found by HPath API):`, e.message || e);
                                skippedCount++; errorOccurred = true;
                            }

                            if (deleteSuccess) {
                                try {
                                    const markdownContent = await this.formatBookmarkAsMarkdown(bookmark, title);
                                    const createParams = { notebook: notebookId, path: safeDocPath, markdown: markdownContent };
                                    console.log("Recreating doc with same path (using fetchSyncPost):", JSON.stringify(createParams));
                                    const createResult = await fetchSyncPost('/api/filetree/createDocWithMd', createParams);
                                    console.log(`[Debug] fetchSyncPost completed for RECREATION of ${bookmark.id} at path ${safeDocPath}. Raw result:`, createResult);
                                    if (createResult?.code === 0 && createResult.data) {
                                        const newDocId = createResult.data as string;
                                        console.log(`Document recreated via API for bookmark ${bookmark.id} at path ${safeDocPath}, received NEW ID: ${newDocId}.`);
                                        await this.setSiYuanAttributes(newDocId, bookmark, title);
                                        updatedCount++;
                                        console.log(`Successfully processed and attributed UPDATED bookmark ${bookmark.id} as new doc ${newDocId}`);
                                    } else {
                                        const errorCode = createResult?.code ?? 'N/A';
                                        const errorMsg = createResult?.msg ?? 'fetchSyncPost failed or returned unexpected result during recreation';
                                        console.error(`Failed to recreate document using fetchSyncPost for bookmark ${bookmark.id} at path ${safeDocPath} [${errorCode}]: ${errorMsg}`);
                                        skippedCount++; errorOccurred = true;
                                    }
                                } catch (e: any) {
                                    console.error(`Error during document recreation process (using fetchSyncPost) for bookmark ${bookmark.id} at path ${safeDocPath}:`, e.message || e);
                                    skippedCount++; errorOccurred = true;
                                }
                            } // fin if(deleteSuccess)
                        } else {
                            // --- Saltar documento existente (no se actualiza) ---
                             // ... (Exactamente el mismo código que antes) ...
                             if (this.settings.updateExistingFiles) {
                                console.log(`Skipping existing document ${existingDocId} (found by HPath API, up-to-date).`);
                             } else {
                                console.log(`Skipping existing document ${existingDocId} (found by HPath API, update disabled).`);
                                skippedCount++;
                             }
                        }
                    } else {
                        // --- Documento No Encontrado por HPath API: Crear Nuevo ---
                         // ... (Exactamente el mismo código que antes para crear y poner atributos) ...
                        console.log(`Creating new document for bookmark ${bookmark.id} at path ${notebookId}:${safeDocPath}`);
                        try {
                            const markdownContent = await this.formatBookmarkAsMarkdown(bookmark, title);
                            const createParams = { notebook: notebookId, path: safeDocPath, markdown: markdownContent };
                            console.log("Creating doc with params (using fetchSyncPost):", JSON.stringify(createParams));
                            const createResult = await fetchSyncPost('/api/filetree/createDocWithMd', createParams);
                            console.log(`[Debug] fetchSyncPost completed for CREATION of ${bookmark.id}. Raw result:`, createResult);
                            if (createResult?.code === 0 && createResult.data) {
                                const newDocId = createResult.data as string;
                                console.log(`Document created via API for bookmark ${bookmark.id}, received ID: ${newDocId}.`);
                                await this.setSiYuanAttributes(newDocId, bookmark, title);
                                createdCount++;
                                console.log(`Successfully processed and attributed bookmark ${bookmark.id} as new doc ${newDocId}`);
                            } else {
                                const errorCode = createResult?.code ?? 'N/A';
                                const errorMsg = createResult?.msg ?? 'fetchSyncPost failed or returned unexpected result';
                                console.error(`Failed to create document using fetchSyncPost for bookmark ${bookmark.id} [${errorCode}]: ${errorMsg}. Path: ${safeDocPath}`);
                                skippedCount++; errorOccurred = true;
                            }
                        } catch (e: any) {
                            console.error(`Error during document creation process (using fetchSyncPost) for bookmark ${bookmark.id}:`, e.message || e);
                            skippedCount++; errorOccurred = true;
                        }
                    }
                } // Fin for bookmarks
            } while (cursor && !criticalErrorOccurred);

            // ... (final sin cambios: log final, guardar settings, return) ...
            console.log("Bookmark sync process finished.");
            this.settings.lastSyncTimestamp = Date.now();
            await this.saveSettings();

        } catch (error: any) {
            console.error("Critical error during bookmark sync:", error);
            criticalErrorOccurred = true;
            errorMessage = `Sync failed critically: ${error.message || "Unknown error"}`;
        } finally {
            this.setSyncingState(false);
        }

        let finalMessage = errorMessage;
        if (!criticalErrorOccurred) {
             finalMessage = `Sync complete: ${createdCount} created, ${updatedCount} updated, ${skippedCount} skipped`;
            if (excludedByTags > 0) { finalMessage += `, ${excludedByTags} excluded by tags`; }
            if (errorOccurred) { finalMessage += `. Note: Some non-critical errors occurred (check console log).`; }
        }
        return { success: !criticalErrorOccurred && !errorOccurred, message: finalMessage };
    }

    // --- Resto de funciones auxiliares SIN CAMBIOS ---
    // ... (pegar aquí setSyncingState, sanitizeSiYuanPath, downloadAsset, formatBookmarkAsMarkdown, setSiYuanAttributes, setupSettingsUI, updateSyncStatusDisplay) ...
            // setSyncingState: Sin cambios
        private setSyncingState(syncing: boolean) {
            this.isSyncing = syncing;
            if (this.syncButton) {
                this.syncButton.disabled = syncing;
                // Usar i18n si está disponible, si no, usar texto fijo
                const syncingText = this.i18n?.syncing || "Syncing...";
                const syncNowText = this.i18n?.syncNow || "Sync Now";
                this.syncButton.textContent = syncing ? syncingText : syncNowText;
            }
            console.log(`Syncing state set to: ${syncing}`);
        }

        // sanitizeSiYuanPath: Sin cambios
        sanitizeSiYuanPath(title: string, createdAt: string): string {
            const dateStr = new Date(createdAt).toISOString().split("T")[0]; // YYYY-MM-DD
            let sanitizedTitle = title.replace(/[\\\/:\*\?"<>\|#%\^\&\{\}\[\]\n\r\t]/g, "-")
                                      .replace(/\s+/g, "-")
                                      .replace(/-+/g, "-")
                                      .replace(/^-+|-+$/g, "")
                                      .replace(/^\.+|\.+$/g, "");

            const maxTitleLength = 60;
            if (sanitizedTitle.length > maxTitleLength) {
                sanitizedTitle = sanitizedTitle.substring(0, maxTitleLength).replace(/-+$/, "");
            }
            if (!sanitizedTitle) {
                sanitizedTitle = `bookmark-${dateStr}`;
            }
            return `${dateStr}-${sanitizedTitle}`;
        }

        // downloadAsset: Usa fetchSyncPost para la subida (sin cambios respecto a la versión anterior revisada)
        async downloadAsset(assetUrl: string, assetId: string, title: string): Promise<string | null> {
            console.log(`Attempting to download and upload asset: ${assetUrl}`);
            try {
                // Descarga desde Hoarder
                const headers: Record<string, string> = {};
                try {
                     const apiDomain = new URL(this.settings.apiEndpoint).origin;
                     if (assetUrl.startsWith(apiDomain)) {
                         headers["Authorization"] = `Bearer ${this.settings.apiKey}`;
                     }
                } catch (e) {
                     console.warn("Could not parse apiEndpoint URL to determine asset domain:", this.settings.apiEndpoint);
                }

                const response = await fetch(assetUrl, { headers });
                if (!response.ok) {
                    if (response.status === 404) {
                         console.warn(`Asset not found (404) on Hoarder server: ${assetUrl}`);
                    } else {
                         console.error(`Failed to download asset (${response.status}) from Hoarder: ${assetUrl}`);
                    }
                    throw new Error(`Failed to download asset (${response.status}): ${assetUrl}`);
                }
                const buffer = await response.arrayBuffer();

                // Preparar nombre de archivo para Siyuan
                let fileName = assetUrl.substring(assetUrl.lastIndexOf('/') + 1).split(/[?#]/)[0];
                if (!fileName || fileName.length > 50 || !fileName.includes('.')) {
                    const extension = fileName.split('.').pop() || 'asset';
                    const safeTitlePart = title.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 20);
                    fileName = `${assetId.substring(0, 8)}-${safeTitlePart}.${extension}`;
                }
                fileName = fileName.replace(/[\\\/:\*\?"<>\|]/g, "-");

                // Preparar FormData para Siyuan
                const formData = new FormData();
                formData.append('assets[]', new File([buffer], fileName));
                if (this.settings.syncNotebookId) {
                     formData.append('notebook', this.settings.syncNotebookId);
                }
                formData.append('assetsDirPath', '/assets/');

                console.log(`Uploading asset '${fileName}' to SiYuan...`);
                const uploadResult = await fetchSyncPost('/api/asset/upload', formData);

                if (uploadResult.code === 0 && uploadResult.data?.succMap && uploadResult.data.succMap[fileName]) {
                    const siyuanAssetPath = uploadResult.data.succMap[fileName];
                    console.log(`Asset uploaded successfully to SiYuan: ${siyuanAssetPath}`);
                    return siyuanAssetPath;
                } else {
                     if (uploadResult.data?.errFiles?.length > 0) {
                         console.error(`Failed to upload some assets to SiYuan. Errors: ${uploadResult.data.errFiles.join(', ')}`);
                     } else {
                         console.error("Failed to upload asset to SiYuan:", uploadResult?.msg || "Unknown upload error", uploadResult);
                     }
                     return null;
                }
            } catch (error: any) {
                console.error(`Error downloading/uploading asset ${assetUrl}:`, error.message || error);
                return null;
            }
        }

        // formatBookmarkAsMarkdown: Maneja fallo de downloadAsset (sin cambios respecto a la versión anterior revisada)
    // formatBookmarkAsMarkdown: Añadido manejo de htmlContent con Turndown
    async formatBookmarkAsMarkdown(bookmark: HoarderBookmark, title: string): Promise<string> {
        const url = bookmark.content.type === "link" ? bookmark.content.url : bookmark.content.sourceUrl;
        const description = bookmark.content.type === "link" ? bookmark.content.description : bookmark.content.text;
        const htmlContent = bookmark.content.htmlContent; // Obtener el contenido HTML

        // Crear una instancia del servicio de conversión (puedes optimizar creando una sola instancia en la clase si lo prefieres)
        const turndownService = new TurndownService({
            headingStyle: 'atx', // Usa # para encabezados
            codeBlockStyle: 'fenced', // Usa ``` para bloques de código
            emDelimiter: '*', // Usa * para énfasis
            strongDelimiter: '**', // Usa ** para negrita
        });

        const getHoarderAssetUrl = (assetId: string): string => {
            const baseUrl = this.settings.apiEndpoint.replace(/\/api\/v1\/?$/, "");
            return `${baseUrl}/assets/${assetId}`;
        };

        let content = `# ${title}\n\n`;
        let assetMarkdown = "";

        // --- Lógica de Assets (sin cambios) ---
        if (this.settings.downloadAssets) {
            // ... (código de descarga de assets como estaba) ...
            let assetToDownloadUrl: string | undefined;
            let assetIdToUse: string | undefined;

            if (bookmark.content.type === "asset" && bookmark.content.assetType === "image" && bookmark.content.assetId) {
                assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.assetId);
                assetIdToUse = bookmark.content.assetId;
            } else if (bookmark.content.type === "link" && bookmark.content.imageAssetId) {
                assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.imageAssetId);
                assetIdToUse = bookmark.content.imageAssetId;
            } else if (bookmark.content.type === "link" && bookmark.content.screenshotAssetId) {
                 assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.screenshotAssetId);
                 assetIdToUse = bookmark.content.screenshotAssetId;
            }

            if (assetToDownloadUrl && assetIdToUse) {
                const siyuanAssetPath = await this.downloadAsset(assetToDownloadUrl, assetIdToUse, title);
                if (siyuanAssetPath) {
                    assetMarkdown = `![${title || 'asset'}](${siyuanAssetPath})\n\n`;
                } else {
                    assetMarkdown = `[Failed to download asset: View on Hoarder](${assetToDownloadUrl})\n\n`;
                }
            } else if (bookmark.content.imageUrl) {
                assetMarkdown = `![${title || 'image'}](${bookmark.content.imageUrl})\n\n`;
            }
        } else {
            // ... (código de enlace externo de assets como estaba) ...
            let externalImageUrl: string | undefined;
             if (bookmark.content.type === "asset" && bookmark.content.assetType === "image" && bookmark.content.assetId) {
                 externalImageUrl = getHoarderAssetUrl(bookmark.content.assetId);
             } else if (bookmark.content.type === "link" && bookmark.content.imageAssetId) {
                 externalImageUrl = getHoarderAssetUrl(bookmark.content.imageAssetId);
             } else if (bookmark.content.type === "link" && bookmark.content.screenshotAssetId) {
                 externalImageUrl = getHoarderAssetUrl(bookmark.content.screenshotAssetId);
             } else if (bookmark.content.imageUrl) {
                 externalImageUrl = bookmark.content.imageUrl;
             }

            if (externalImageUrl) {
                assetMarkdown = `![${title || 'image'}](${externalImageUrl})\n\n`;
            }
        }
        content += assetMarkdown;
        // --- Fin Lógica de Assets ---

        if (url && bookmark.content.type !== "asset") {
            content += `**URL:** [${url}](${url})\n\n`;
        }
        if (bookmark.summary) {
            content += `## Summary\n\n${bookmark.summary.trim()}\n\n`;
        }
        if (description) {
            content += `## Description\n\n${description.trim()}\n\n`;
        }
        if (bookmark.tags.length > 0) {
            content += `**Tags:** ${bookmark.tags.map(t => t.name).join(', ')}\n\n`;
        }
        content += `## Notes\n\n${bookmark.note || ""}\n\n`;

        // --- AÑADIR CONTENIDO HTML CONVERTIDO ---
        if (htmlContent && htmlContent.trim()) {
            console.log(`[Debug HTML] Found htmlContent for bookmark ${bookmark.id}. Attempting conversion...`);
            try {
                const convertedMarkdown = turndownService.turndown(htmlContent);
                if (convertedMarkdown && convertedMarkdown.trim()) {
                    content += `## Content Snapshot\n\n${convertedMarkdown.trim()}\n\n`;
                    console.log(`[Debug HTML] Conversion successful for bookmark ${bookmark.id}.`);
                } else {
                    console.log(`[Debug HTML] Conversion resulted in empty markdown for bookmark ${bookmark.id}.`);
                }
            } catch (e: any) {
                console.error(`[Debug HTML] Error converting htmlContent for bookmark ${bookmark.id}:`, e.message || e);
                // Opcional: añadir un marcador de error en la nota
                // content += `## Content Snapshot\n\nError converting HTML content.\n\n`;
            }
        }
        // --- FIN CONTENIDO HTML ---

        // Link a Hoarder (sin cambios)
        try {
             const hoarderBaseUrl = new URL(this.settings.apiEndpoint).origin;
             content += `----\n[View in Hoarder](${hoarderBaseUrl}/dashboard/preview/${bookmark.id})`;
        } catch (e) {
             console.warn("Could not determine Hoarder base URL from endpoint:", this.settings.apiEndpoint);
             content += `----\nHoarder ID: ${bookmark.id}`;
        }

        return content;
    }
        // setSiYuanAttributes: Usa fetchSyncPost (sin cambios respecto a la versión anterior revisada)
        async setSiYuanAttributes(docRootId: string, bookmark: HoarderBookmark, title: string) {
            const attrs: IObject = {
                [ATTR_HOARDER_ID]: bookmark.id,
                [`${ATTR_PREFIX}url`]: bookmark.content.type === 'link' ? bookmark.content.url : bookmark.content.sourceUrl || '',
                [`${ATTR_PREFIX}title`]: title,
                [`${ATTR_PREFIX}created`]: new Date(bookmark.createdAt).toISOString(),
                [ATTR_MODIFIED]: bookmark.modifiedAt ? new Date(bookmark.modifiedAt).toISOString() : new Date(bookmark.createdAt).toISOString(),
                [`${ATTR_PREFIX}tags`]: bookmark.tags.map(t => t.name).join(', '),
                [`${ATTR_PREFIX}summary`]: bookmark.summary || '',
                [`${ATTR_PREFIX}favourited`]: String(bookmark.favourited),
                [`${ATTR_PREFIX}archived`]: String(bookmark.archived),
            };
            try {
                console.log(`[Debug setAttrs] Attempting to set attributes for doc ${docRootId} with Hoarder ID ${bookmark.id}:`, attrs);
                const setResult = await fetchSyncPost('/api/attr/setBlockAttrs', { id: docRootId, attrs: attrs });
                if (setResult.code === 0) {
                    console.log(`[Debug setAttrs] SUCCESS setting attributes for doc ${docRootId}. API Response:`, setResult);
                } else {
                    console.error(`[Debug setAttrs] FAILED setting attributes for doc ${docRootId} [${setResult?.code}]: ${setResult?.msg}. API Response:`, setResult);
                }
            } catch (error: any) {
                console.error(`[Debug setAttrs] NETWORK ERROR setting attributes for doc ${docRootId}:`, error.message || error);
            }
        }

        // --- UI de Ajustes (Usa fetchPost con callback para lsNotebooks) (sin cambios respecto a la versión anterior revisada) ---
        private setupSettingsUI() {
            this.setting = new Setting({
                height: "auto",
                width: "600px",
                title: "Hoarder Sync Settings (One-Way)", // Puedes usar i18n aquí si lo tienes configurado
                confirmCallback: async () => {
                    if (!this.settings.apiKey) { showMessage("Hoarder API Key is required.", 3000, "error"); return; }
                    if (!this.settings.apiEndpoint || !this.settings.apiEndpoint.startsWith("http")) { showMessage("A valid Hoarder API Endpoint (starting with http/https) is required.", 3000, "error"); return; }
                     if (!this.settings.syncNotebookId) { showMessage("Please select a Target SiYuan Notebook.", 3000, "error"); return; }
                    await this.saveSettings();
                    showMessage("Hoarder settings saved."); // Puedes usar i18n aquí
                }
            });

            const createTextField = (key: keyof HoarderSyncSettings, placeholder: string, type: string = 'text') => {
                const input = document.createElement('input');
                input.type = type;
                input.className = 'b3-text-field fn__block';
                input.placeholder = placeholder;
                input.value = String(this.settings[key] ?? (type === 'number' ? DEFAULT_SETTINGS[key] : ''));
                input.addEventListener('input', () => {
                    if (type === 'number') {
                        const numValue = parseInt(input.value);
                        this.settings[key] = (!isNaN(numValue) && numValue >= 0) ? numValue : (DEFAULT_SETTINGS[key] as any);
                        input.value = String(this.settings[key]);
                    } else {
                        this.settings[key] = input.value as any;
                    }
                });
                return input;
            };

            const createToggle = (key: keyof HoarderSyncSettings) => {
                const switchElement = document.createElement('input');
                switchElement.type = 'checkbox';
                switchElement.className = 'b3-switch fn__flex-center';
                switchElement.checked = !!this.settings[key];
                switchElement.addEventListener('change', () => { this.settings[key] = switchElement.checked as any; });
                return switchElement;
            };

            this.setting.addItem({
                title: "Hoarder API Key", // i18n
                description: "Your API key from Hoarder settings.", // i18n
                createActionElement: () => createTextField('apiKey', 'Enter your Hoarder API key', 'password'),
            });
            this.setting.addItem({
                title: "Hoarder API Endpoint", // i18n
                description: `Usually ${DEFAULT_SETTINGS.apiEndpoint} or your self-hosted URL.`, // i18n
                createActionElement: () => createTextField('apiEndpoint', DEFAULT_SETTINGS.apiEndpoint),
            });

            const notebookSelect = document.createElement('select');
            notebookSelect.className = 'b3-select fn__block';
            notebookSelect.innerHTML = '<option value="">Loading notebooks...</option>'; // i18n
            notebookSelect.disabled = true;
            fetchPost('/api/notebook/lsNotebooks', {}, (res) => {
                if (res.code === 0 && res.data?.notebooks) {
                    notebookSelect.innerHTML = '<option value="">-- Select a Notebook --</option>'; // i18n
                    res.data.notebooks.forEach((notebook: { id: string; name: string }) => {
                        const option = document.createElement('option');
                        option.value = notebook.id;
                        option.textContent = notebook.name;
                        if (notebook.id === this.settings.syncNotebookId) { option.selected = true; }
                        notebookSelect.appendChild(option);
                    });
                    notebookSelect.disabled = false;
                } else {
                    notebookSelect.innerHTML = '<option value="">Error loading notebooks</option>'; // i18n
                    console.error("Failed to load notebooks:", res.code, res.msg);
                     showMessage(`Error loading notebooks: ${res.msg || 'Unknown error'}`, 5000, 'error'); // i18n
                }
            });
            notebookSelect.addEventListener('change', () => { this.settings.syncNotebookId = notebookSelect.value || null; });
            this.setting.addItem({
                title: "Target SiYuan Notebook", // i18n
                description: "The notebook where Hoarder bookmarks will be saved.", // i18n
                createActionElement: () => notebookSelect,
            });

            this.setting.addItem({
                title: "Sync Interval (minutes)", // i18n
                description: "How often to automatically sync (0 to disable auto-sync). Default: 60.", // i18n
                createActionElement: () => createTextField('syncIntervalMinutes', '60', 'number'),
            });
            const tagsInput = document.createElement('textarea');
            tagsInput.className = 'b3-text-field fn__block';
            tagsInput.rows = 2;
            tagsInput.placeholder = 'e.g., read-later, temporary, project-x';
            tagsInput.value = this.settings.excludedTags.join(', ');
            tagsInput.addEventListener('input', () => {
                this.settings.excludedTags = tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
            });
            this.setting.addItem({
                title: "Excluded Tags", // i18n
                description: "Comma-separated tags. Bookmarks with ANY of these tags won't be synced (unless favorited).", // i18n
                createActionElement: () => tagsInput,
            });
            this.setting.addItem({
                title: "Update Existing Documents", // i18n
                description: "Overwrite existing SiYuan documents if the Hoarder bookmark is newer (based on 'modifiedAt').", // i18n
                createActionElement: () => createToggle('updateExistingFiles')
            });
            this.setting.addItem({
                title: "Exclude Archived Bookmarks", // i18n
                description: "Don't sync bookmarks marked as archived in Hoarder.", // i18n
                createActionElement: () => createToggle('excludeArchived')
            });
            this.setting.addItem({
                title: "Only Sync Favorites", // i18n
                description: "Only sync bookmarks marked as favorite in Hoarder. Excluded tags are ignored for favorites.", // i18n
                createActionElement: () => createToggle('onlyFavorites')
            });
            this.setting.addItem({
                title: "Download Assets Locally", // i18n
                description: "Download images/assets into SiYuan instead of linking externally. Requires Hoarder server access.", // i18n
                createActionElement: () => createToggle('downloadAssets')
            });

            const syncContainer = document.createElement('div');
            syncContainer.className = "fn__flex";
            this.syncButton = document.createElement('button');
            this.syncButton.className = 'b3-button b3-button--outline';
            this.syncButton.textContent = this.isSyncing ? (this.i18n?.syncing || "Syncing...") : (this.i18n?.syncNow || "Sync Now");
            this.syncButton.disabled = this.isSyncing;
            this.syncButton.addEventListener('click', async () => {
                if (this.isSyncing) { showMessage("Sync is already in progress.", 3000, "info"); return; } // i18n
                showMessage("Starting manual Hoarder sync..."); // i18n
                const result = await this.syncBookmarks();
                showMessage(result.message, result.success ? 4000 : 6000, result.success ? "info" : "error");
            });
            this.syncStatusElement = document.createElement('div');
            this.syncStatusElement.className = "ft__smaller ft__on-surface fn__flex-center fn__margin-left";
            this.updateSyncStatusDisplay();
            syncContainer.appendChild(this.syncButton);
            syncContainer.appendChild(this.syncStatusElement);
            this.setting.addItem({
                title: "Manual Sync", // i18n
                description: "Trigger a synchronization with Hoarder immediately.", // i18n
                actionElement: syncContainer,
            });
        }

        // updateSyncStatusDisplay: Usa i18n si está disponible
        private updateSyncStatusDisplay() {
            if (this.syncStatusElement) {
                const lastSyncText = this.i18n?.lastSync || "Last synced";
                const neverSyncedText = this.i18n?.neverSynced || "Never synced.";
                if (this.settings.lastSyncTimestamp > 0) {
                    this.syncStatusElement.textContent = `${lastSyncText}: ${new Date(this.settings.lastSyncTimestamp).toLocaleString()}`;
                } else {
                    this.syncStatusElement.textContent = neverSyncedText;
                }
            }
        }
} // Fin de la clase HoarderSyncPlugin