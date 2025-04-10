// index.ts (Versión Refactorizada)

import {
    Plugin,
    showMessage,
    Setting,
    fetchPost,
    fetchSyncPost,
    IObject,
    // IWebSocketData, // No se usa directamente, fetchSyncPost devuelve { code, msg, data }
    // confirm, Dialog, Menu, // Disponibles pero no usados
} from "siyuan";

import TurndownService from 'turndown';

import "./index.scss";

// --- Constantes ---
const STORAGE_SETTINGS_KEY = "hoarder-sync-settings";
const LOG_PREFIX = "[HoarderSync]";
const ATTR_PREFIX = "custom-hoarder-";
const ATTR_HOARDER_ID = `${ATTR_PREFIX}id`;
const ATTR_MODIFIED = `${ATTR_PREFIX}modified`;
const BOOKMARK_FETCH_LIMIT = 50;

// Rutas API SiYuan
const API_LS_NOTEBOOKS = '/api/notebook/lsNotebooks';
const API_GET_IDS_BY_HPATH = '/api/filetree/getIDsByHPath';
const API_GET_BLOCK_ATTRS = '/api/attr/getBlockAttrs';
const API_SET_BLOCK_ATTRS = '/api/attr/setBlockAttrs';
const API_REMOVE_DOC_BY_ID = '/api/filetree/removeDocByID';
const API_CREATE_DOC_WITH_MD = '/api/filetree/createDocWithMd';
const API_UPLOAD_ASSET = '/api/asset/upload';

// --- Interfaces Hoarder (Sin cambios) ---
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

// --- Tipo para el resultado del procesamiento de un bookmark ---
type ProcessResult = {
    status: 'created' | 'updated' | 'skipped' | 'skipped_filtered' | 'error';
    message?: string; // Mensaje de error o detalle
};

export default class HoarderSyncPlugin extends Plugin {
    public settings: HoarderSyncSettings;
    private isSyncing: boolean = false;
    private syncIntervalId: number | null = null;
    private syncStatusElement: HTMLElement | null = null;
    private syncButton: HTMLButtonElement | null = null;
    private turndownService: TurndownService;

    async onload() {
        this.logInfo("Loading plugin...");

        // Inicializar Turndown Service una vez
        this.turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            emDelimiter: '*',
            strongDelimiter: '**',
        });

        await this.loadSettings();
        this.setupSettingsUI(); // Se ejecuta después de loadSettings
        this.addCommands();
        this.startPeriodicSync(); // Inicia la sincronización periódica si está configurada

        this.logInfo("Plugin loaded successfully.");
    }

    onunload() {
        this.logInfo("Unloading plugin...");
        this.stopPeriodicSync();
        this.logInfo("Plugin unloaded.");
    }

    // --- Logging Helpers ---
    private logInfo(message: string, ...args: any[]) { console.info(`${LOG_PREFIX} ${message}`, ...args); }
    private logWarn(message: string, ...args: any[]) { console.warn(`${LOG_PREFIX} ${message}`, ...args); }
    private logError(message: string, ...args: any[]) { console.error(`${LOG_PREFIX} ${message}`, ...args); }

    // --- Settings Management ---
    private async loadSettings() {
        const loadedData = await this.loadData(STORAGE_SETTINGS_KEY);
        const validSettings: Partial<HoarderSyncSettings> = {};
        if (loadedData) {
            for (const key in DEFAULT_SETTINGS) {
                if (loadedData.hasOwnProperty(key)) {
                    (validSettings as any)[key] = loadedData[key];
                }
            }
        }
        this.settings = { ...DEFAULT_SETTINGS, ...validSettings };
        this.logInfo("Settings loaded:", this.settings);
    }

    private async saveSettings() {
        const settingsToSave: Partial<HoarderSyncSettings> = {};
        for (const key in DEFAULT_SETTINGS) {
            if (this.settings.hasOwnProperty(key)) {
                (settingsToSave as any)[key] = (this.settings as any)[key];
            }
        }
        await this.saveData(STORAGE_SETTINGS_KEY, settingsToSave);
        this.logInfo("Settings saved.");
        this.updateSyncStatusDisplay(); // Actualizar UI si está visible
        this.startPeriodicSync(); // Reiniciar el temporizador con la nueva configuración
    }

    // --- Command Registration ---
    private addCommands() {
        this.addCommand({
            langKey: "syncHoarderBookmarks", // Usar camelCase para langKey es común
            hotkey: "",
            callback: async () => {
                if (this.isSyncing) {
                    showMessage(this.i18n.syncInProgress || "Sync is already in progress.", 3000, "info");
                    return;
                }
                showMessage(this.i18n.manualSyncStarting || "Starting manual Hoarder sync...");
                const result = await this.runSyncCycle();
                showMessage(result.message, result.success ? 4000 : 6000, result.success ? "info" : "error");
            },
            langText: { // Proporcionar textos para i18n
                "en_US": "Sync Hoarder Bookmarks (One-Way)",
                "zh_CN": "同步 Hoarder 书签（单向）", // Ejemplo Chino
                "es_ES": "Sincronizar Marcadores Hoarder (Unidireccional)"
                // Añadir otros idiomas si es necesario
            }
        });
    }

    // --- Periodic Sync Control ---
    private startPeriodicSync() {
        this.stopPeriodicSync(); // Detener cualquier temporizador existente

        const intervalMinutes = this.settings.syncIntervalMinutes;
        if (!intervalMinutes || intervalMinutes <= 0) {
            this.logInfo("Periodic sync disabled (interval <= 0).");
            return;
        }

        const intervalMillis = intervalMinutes * 60 * 1000;
        this.logInfo(`Starting periodic sync every ${intervalMinutes} minutes.`);
        this.syncIntervalId = window.setInterval(async () => {
            if (this.isSyncing) {
                this.logInfo("Skipping scheduled sync: previous sync still running.");
                return;
            }
            this.logInfo("Performing scheduled Hoarder sync...");
            const result = await this.runSyncCycle();
            this.logInfo("Scheduled sync finished.", result);
            // Opcional: Mostrar mensaje visual para sync programado
            // showMessage(`${this.i18n.scheduledSyncComplete || 'Scheduled sync'}: ${result.message}`, 3000, result.success ? 'info' : 'error');
        }, intervalMillis);
    }

    private stopPeriodicSync() {
        if (this.syncIntervalId) {
            window.clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
            this.logInfo("Periodic sync stopped.");
        }
    }

    // --- Hoarder API Interaction ---
    private async fetchBookmarks(cursor?: string): Promise<HoarderResponse> {
        const endpoint = this.settings.apiEndpoint.replace(/\/$/, ""); // Ensure no trailing slash
        const apiUrl = `${endpoint}/bookmarks`;
        const queryParams = new URLSearchParams({
            limit: BOOKMARK_FETCH_LIMIT.toString(),
            sort: 'createdAt', // O 'modifiedAt' si se prefiere procesar cambios primero
            order: 'asc'       // 'asc' para procesar desde el más antiguo
        });
        if (cursor) {
            queryParams.append("cursor", cursor);
        }

        this.logInfo(`Fetching Hoarder bookmarks: ${apiUrl}?${queryParams.toString()}`);
        try {
            const response = await fetch(`${apiUrl}?${queryParams.toString()}`, {
                headers: {
                    Authorization: `Bearer ${this.settings.apiKey}`,
                    "Content-Type": "application/json",
                }
            });
            if (!response.ok) {
                const errorText = await response.text();
                this.logError("Hoarder API Error:", response.status, errorText);
                throw new Error(`Hoarder API request failed: ${response.status} ${errorText}`);
            }
            return response.json() as Promise<HoarderResponse>;
        } catch (error) {
            this.logError("Error fetching bookmarks from Hoarder:", error);
            throw error; // Re-throw to be caught by the caller
        }
    }

    // --- Core Sync Logic ---

    /**
     * Runs a full synchronization cycle.
     * Fetches bookmarks from Hoarder and processes them.
     */
    public async runSyncCycle(): Promise<{ success: boolean; message: string }> {
        if (this.isSyncing) return { success: false, message: this.i18n.syncInProgress || "Sync already in progress." };
        if (!this.settings.apiKey) return { success: false, message: this.i18n.apiKeyMissing || "Hoarder API key not configured." };
        if (!this.settings.syncNotebookId) return { success: false, message: this.i18n.notebookMissing || "Target SiYuan notebook not configured." };

        this.setSyncingState(true);
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        let skippedFilteredCount = 0;
        let errorCount = 0;
        let criticalErrorOccurred = false;
        let finalMessage = "";
        const notebookId = this.settings.syncNotebookId;

        try {
            this.logInfo("Starting bookmark sync cycle...");
            let cursor: string | undefined;
            const processedBookmarkIds = new Set<string>(); // Track IDs processed in *this run*

            do {
                const response = await this.fetchBookmarks(cursor);
                const bookmarks = response.bookmarks || [];
                cursor = response.nextCursor;
                this.logInfo(`Fetched ${bookmarks.length} bookmarks. Next cursor: ${cursor ? '...' + cursor.slice(-6) : 'none'}`);

                for (const bookmark of bookmarks) {
                    // Evita procesar el mismo ID dos veces si la API devolviera duplicados en paginación (poco probable pero seguro)
                    if (processedBookmarkIds.has(bookmark.id)) continue;
                    processedBookmarkIds.add(bookmark.id);

                    const result: ProcessResult = await this.processBookmark(bookmark, notebookId);

                    switch (result.status) {
                        case 'created': createdCount++; break;
                        case 'updated': updatedCount++; break;
                        case 'skipped': skippedCount++; break;
                        case 'skipped_filtered': skippedFilteredCount++; break;
                        case 'error':
                            errorCount++;
                            this.logError(`Error processing bookmark ${bookmark.id}: ${result.message}`);
                            break;
                    }
                } // End for loop

            } while (cursor && !criticalErrorOccurred); // Stop if critical error or no more pages

            this.logInfo("Bookmark sync cycle finished.");
            this.settings.lastSyncTimestamp = Date.now();
            await this.saveSettings();

        } catch (error: any) {
            this.logError("Critical error during sync cycle:", error);
            criticalErrorOccurred = true;
            finalMessage = `${this.i18n.syncFailed || "Sync failed critically"}: ${error.message || "Unknown error"}`;
        } finally {
            this.setSyncingState(false);
        }

        if (!criticalErrorOccurred) {
            finalMessage = `${this.i18n.syncComplete || "Sync complete"}: ${createdCount} ${this.i18n.created || 'created'}, ${updatedCount} ${this.i18n.updated || 'updated'}, ${skippedCount + skippedFilteredCount} ${this.i18n.skipped || 'skipped'}`;
            if (skippedFilteredCount > 0) { finalMessage += ` (${skippedFilteredCount} ${this.i18n.filtered || 'filtered'})`; }
            if (errorCount > 0) { finalMessage += `, ${errorCount} ${this.i18n.errors || 'errors'} (${this.i18n.checkLogs || 'check logs'})`; }
        }

        return { success: !criticalErrorOccurred && errorCount === 0, message: finalMessage };
    }

    /**
     * Processes a single Hoarder bookmark.
     * Determines if it should be synced, creates or updates the SiYuan document.
     */
    private async processBookmark(bookmark: HoarderBookmark, notebookId: string): Promise<ProcessResult> {
        // 1. Apply Filters
        if (this.settings.excludeArchived && bookmark.archived) return { status: 'skipped_filtered' };
        if (this.settings.onlyFavorites && !bookmark.favourited) return { status: 'skipped_filtered' };
        if (!bookmark.favourited && this.settings.excludedTags.length > 0) {
            const bookmarkTagsLower = bookmark.tags.map((tag) => tag.name.toLowerCase());
            const excludedTagsLower = this.settings.excludedTags.map(t => t.toLowerCase().trim()).filter(t => t);
            if (excludedTagsLower.some((excludedTag) => bookmarkTagsLower.includes(excludedTag))) {
                return { status: 'skipped_filtered' };
            }
        }

        // 2. Prepare Document Info
        const title = this.getBookmarkTitle(bookmark);
        const safeDocPath = `/${this.sanitizeSiYuanPath(title, bookmark.createdAt)}`.replace(/^\/+/, "/");

        try {
            // 3. Check if Document Exists in SiYuan
            const existingDocId = await this.findExistingDocumentId(notebookId, safeDocPath);

            if (existingDocId) {
                // 4. Document Exists: Decide whether to update
                const shouldUpdate = await this.shouldUpdateDocument(existingDocId, bookmark);
                if (shouldUpdate) {
                    this.logInfo(`Updating existing document ${existingDocId} for bookmark ${bookmark.id} at path ${safeDocPath}`);
                    return await this.updateSiYuanDocument(existingDocId, bookmark, notebookId, title, safeDocPath);
                } else {
                    this.logInfo(`Skipping existing document ${existingDocId} (up-to-date or update disabled).`);
                    return { status: 'skipped' };
                }
            } else {
                // 5. Document Does Not Exist: Create new one
                this.logInfo(`Creating new document for bookmark ${bookmark.id} at path ${notebookId}:${safeDocPath}`);
                return await this.createSiYuanDocument(bookmark, notebookId, title, safeDocPath);
            }
        } catch (error: any) {
            this.logError(`Failed to process bookmark ${bookmark.id} (path: ${safeDocPath}):`, error);
            return { status: 'error', message: error.message || "Unknown processing error" };
        }
    }

    /**
     * Finds the SiYuan document ID for a given notebook and HPath.
     * Returns the ID string if found, null otherwise.
     */
    private async findExistingDocumentId(notebookId: string, hPath: string): Promise<string | null> {
        this.logInfo(`Checking existence via API for path: ${hPath} in notebook ${notebookId}`);
        try {
            const result = await fetchSyncPost(API_GET_IDS_BY_HPATH, {
                notebook: notebookId,
                path: hPath,
            });

            if (result.code === 0 && result.data && Array.isArray(result.data) && result.data.length > 0) {
                this.logInfo(`Found existing document ID via API: ${result.data[0]}`);
                return result.data[0]; // Return the first ID found
            } else if (result.code === 0) {
                this.logInfo(`No document found via API for path ${hPath}.`);
                return null;
            } else {
                // API returned an error code
                this.logWarn(`API ${API_GET_IDS_BY_HPATH} failed [${result.code}]: ${result.msg} for path ${hPath}`);
                return null; // Treat API error as 'not found' for safety, but log it
            }
        } catch (error: any) {
            this.logError(`Network error during API ${API_GET_IDS_BY_HPATH} check for path ${hPath}:`, error);
            throw error; // Re-throw network errors as they might be critical
        }
    }

    /**
     * Checks if an existing SiYuan document should be updated based on settings and modification times.
     */
    private async shouldUpdateDocument(docId: string, bookmark: HoarderBookmark): Promise<boolean> {
        if (!this.settings.updateExistingFiles) {
            return false; // Update is disabled
        }

        try {
            const attrsResult = await fetchSyncPost(API_GET_BLOCK_ATTRS, { id: docId });
            if (attrsResult.code === 0 && attrsResult.data) {
                const attrs = attrsResult.data;
                const storedModifiedTime = attrs[ATTR_MODIFIED] ? new Date(attrs[ATTR_MODIFIED]).getTime() : 0;
                const bookmarkModifiedTime = bookmark.modifiedAt ? new Date(bookmark.modifiedAt).getTime() : new Date(bookmark.createdAt).getTime();

                if (!storedModifiedTime || bookmarkModifiedTime > storedModifiedTime) {
                    this.logInfo(`Marking doc ${docId} for update (bookmark modified: ${bookmarkModifiedTime} > stored: ${storedModifiedTime}).`);
                    return true; // Bookmark is newer or no stored time
                } else {
                    return false; // Document is up-to-date
                }
            } else {
                // Failed to get attributes, assume update needed to be safe
                this.logWarn(`Could not get attributes for existing doc ${docId} [${attrsResult?.code}] ${attrsResult?.msg}. Assuming update needed.`);
                return true;
            }
        } catch (error: any) {
            // Network error during attribute check, assume update needed
            this.logError(`Network error checking modification time for doc ${docId}:`, error);
            return true;
        }
    }

    /**
     * Creates a new document in SiYuan for the given bookmark.
     */
    private async createSiYuanDocument(bookmark: HoarderBookmark, notebookId: string, title: string, path: string): Promise<ProcessResult> {
        try {
            const markdownContent = await this.formatBookmarkAsMarkdown(bookmark, title);
            const createParams = { notebook: notebookId, path: path, markdown: markdownContent };

            this.logInfo(`Calling ${API_CREATE_DOC_WITH_MD} for bookmark ${bookmark.id}`);
            const createResult = await fetchSyncPost(API_CREATE_DOC_WITH_MD, createParams);

            if (createResult?.code === 0 && createResult.data) {
                const newDocId = createResult.data as string;
                this.logInfo(`Document created successfully for bookmark ${bookmark.id}, new ID: ${newDocId}. Setting attributes...`);
                await this.setSiYuanAttributes(newDocId, bookmark, title);
                return { status: 'created' };
            } else {
                const errorCode = createResult?.code ?? 'N/A';
                const errorMsg = createResult?.msg ?? 'API call failed or returned unexpected result';
                this.logError(`Failed to create document for bookmark ${bookmark.id} [${errorCode}]: ${errorMsg}. Path: ${path}`);
                return { status: 'error', message: `API create failed (${errorCode}): ${errorMsg}` };
            }
        } catch (error: any) {
            this.logError(`Error during document creation process for bookmark ${bookmark.id}:`, error);
            return { status: 'error', message: error.message || "Document creation failed" };
        }
    }

    /**
     * Updates an existing SiYuan document by deleting and recreating it.
     */
    private async updateSiYuanDocument(existingDocId: string, bookmark: HoarderBookmark, notebookId: string, title: string, path: string): Promise<ProcessResult> {
        // 1. Delete the existing document
        try {
            this.logInfo(`Attempting to delete document ${existingDocId} for update (bookmark ${bookmark.id})`);
            const deleteResult = await fetchSyncPost(API_REMOVE_DOC_BY_ID, { id: existingDocId });
            if (deleteResult.code !== 0) {
                this.logError(`Failed to delete existing document ${existingDocId} for update [${deleteResult?.code}]: ${deleteResult?.msg}`);
                return { status: 'error', message: `Failed to delete old doc (${deleteResult?.code}): ${deleteResult?.msg}` };
            }
            this.logInfo(`Successfully deleted existing doc ${existingDocId}. Recreating...`);
        } catch (error: any) {
            this.logError(`Network error during delete operation for doc ${existingDocId}:`, error);
            return { status: 'error', message: error.message || "Failed to delete old document" };
        }

        // 2. Recreate the document (using the same creation logic)
        // We pass the *same* path, SiYuan should handle creating it again.
        const createResult = await this.createSiYuanDocument(bookmark, notebookId, title, path);

        // Adjust the status from 'created' to 'updated' if creation was successful
        if (createResult.status === 'created') {
            return { status: 'updated' };
        } else {
            // If recreation failed, return the error from createSiYuanDocument
            this.logError(`Failed to recreate document after deletion for bookmark ${bookmark.id}. Previous ID was ${existingDocId}.`);
            return createResult; // Propagate the error result
        }
    }

    // --- Helper Functions ---

    /**
     * Sets the custom attributes on a SiYuan document block.
     */
    private async setSiYuanAttributes(docRootId: string, bookmark: HoarderBookmark, title: string): Promise<void> {
        const attrs: IObject = {
            [ATTR_HOARDER_ID]: bookmark.id,
            [ATTR_MODIFIED]: bookmark.modifiedAt ? new Date(bookmark.modifiedAt).toISOString() : new Date(bookmark.createdAt).toISOString(),
            title: title, // Also store the original Hoarder title (or derived)
            url: bookmark.content.type === 'link' ? bookmark.content.url : bookmark.content.sourceUrl || '',
            created: new Date(bookmark.createdAt).toISOString(),
            tags: bookmark.tags.map(t => t.name).join(', '),
            summary: bookmark.summary || '',
            favourited: String(bookmark.favourited),
            archived: String(bookmark.archived),
            // Add prefix to avoid potential conflicts with standard SiYuan attributes
            [`${ATTR_PREFIX}url`]: bookmark.content.type === 'link' ? bookmark.content.url : bookmark.content.sourceUrl || '',
            [`${ATTR_PREFIX}created`]: new Date(bookmark.createdAt).toISOString(),
            [`${ATTR_PREFIX}tags`]: bookmark.tags.map(t => t.name).join(', '),
            [`${ATTR_PREFIX}summary`]: bookmark.summary || '',
            [`${ATTR_PREFIX}favourited`]: String(bookmark.favourited),
            [`${ATTR_PREFIX}archived`]: String(bookmark.archived),
        };

        try {
            this.logInfo(`Setting attributes for doc ${docRootId} (Hoarder ID ${bookmark.id})`);
            const setResult = await fetchSyncPost(API_SET_BLOCK_ATTRS, { id: docRootId, attrs: attrs });
            if (setResult.code === 0) {
                this.logInfo(`Successfully set attributes for doc ${docRootId}.`);
            } else {
                this.logError(`Failed setting attributes for doc ${docRootId} [${setResult?.code}]: ${setResult?.msg}`);
            }
        } catch (error: any) {
            this.logError(`Network error setting attributes for doc ${docRootId}:`, error);
        }
    }

    /**
     * Generates a suitable title for the SiYuan document.
     */
    private getBookmarkTitle(bookmark: HoarderBookmark): string {
        // Prioritize Hoarder's explicit title
        if (bookmark.title && bookmark.title.trim()) return bookmark.title.trim();

        // Derive title from content if no explicit title
        const content = bookmark.content;
        if (content.type === "link") {
            if (content.title && content.title.trim()) return content.title.trim();
            if (content.url) {
                try {
                    const url = new URL(content.url);
                    // Try path component first
                    const pathSegments = url.pathname.split('/');
                    const lastSegment = pathSegments.pop() || pathSegments.pop(); // Handle trailing slash
                    if (lastSegment) {
                        const decodedSegment = decodeURIComponent(lastSegment);
                        const pathTitle = decodedSegment.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
                        if (pathTitle) return pathTitle;
                    }
                    // Fallback to hostname
                    return url.hostname.replace(/^www\./, "");
                } catch {
                    // Invalid URL, use the raw URL string as fallback
                    return content.url.substring(0, 100); // Truncate long invalid URLs
                }
            }
        } else if (content.type === "text") {
            if (content.text) {
                const firstLine = content.text.split('\n')[0].trim();
                return firstLine.length <= 100 ? firstLine : firstLine.substring(0, 97) + "...";
            }
        } else if (content.type === "asset") {
            if (content.fileName) return content.fileName.replace(/\.[^/.]+$/, "").trim(); // Use filename without extension
            if (content.sourceUrl) {
                try {
                    const url = new URL(content.sourceUrl);
                     const pathSegments = url.pathname.split('/');
                    const lastSegment = pathSegments.pop() || pathSegments.pop();
                    if (lastSegment) return decodeURIComponent(lastSegment);
                    return url.hostname; // Fallback to hostname if path is just '/'
                } catch {
                    return content.sourceUrl.substring(0, 100); // Truncate long invalid source URLs
                 }
            }
        }

        // Absolute fallback: Generate a unique-ish title
        const dateStr = new Date(bookmark.createdAt).toISOString().split("T")[0];
        return `Bookmark-${bookmark.id.substring(0, 8)}-${dateStr}`;
    }


    /**
     * Sanitizes a string to be used as part of a SiYuan file path segment.
     * Replaces invalid characters and ensures a max length.
     */
    private sanitizeSiYuanPath(title: string, createdAt: string): string {
        const dateStr = new Date(createdAt).toISOString().split("T")[0]; // YYYY-MM-DD

        // Remove/replace invalid characters for SiYuan paths
        // \ / : * ? " < > | # % ^ & { } [ ] and control characters (like newline)
        let sanitizedTitle = title
            .replace(/[\\\/:\*\?"<>\|#%\^\&\{\}\[\]\n\r\t]/g, "-") // Replace unsafe chars with hyphen
            .replace(/\s+/g, "-")        // Replace whitespace with hyphen
            .replace(/-+/g, "-")         // Collapse multiple hyphens
            .replace(/^-+|-+$/g, "")     // Trim leading/trailing hyphens
            .replace(/^\.+|\.+$/g, "");  // Trim leading/trailing dots

        // Limit length to avoid issues with long file names
        const maxTitleLength = 60;
        if (sanitizedTitle.length > maxTitleLength) {
            // Cut and remove trailing hyphen if necessary
            sanitizedTitle = sanitizedTitle.substring(0, maxTitleLength).replace(/-+$/, "");
        }

        // Ensure the title is not empty after sanitization
        if (!sanitizedTitle) {
            sanitizedTitle = `bookmark-${dateStr}`; // Fallback if title becomes empty
        }

        // Prepend date for chronological sorting potential
        return `${dateStr}-${sanitizedTitle}`;
    }

    /**
     * Formats a Hoarder bookmark into Markdown content for a SiYuan document.
     */
    private async formatBookmarkAsMarkdown(bookmark: HoarderBookmark, title: string): Promise<string> {
        const url = bookmark.content.type === "link" ? bookmark.content.url : bookmark.content.sourceUrl;
        const description = bookmark.content.type === "link" ? bookmark.content.description : bookmark.content.text;
        const htmlContent = bookmark.content.htmlContent;

        const getHoarderAssetUrl = (assetId: string): string => {
            try {
                // Intenta construir la URL base desde el endpoint de la API
                 const baseUrl = new URL(this.settings.apiEndpoint);
                 // Asume que /api/v1 es el path, lo quita para obtener el origen base
                 const origin = baseUrl.origin;
                 return `${origin}/assets/${assetId}`;
            } catch (e) {
                 this.logWarn("Could not parse Hoarder API endpoint to build asset URL:", this.settings.apiEndpoint);
                 // Fallback a una ruta relativa o un placeholder si no se puede parsear
                 return `/assets/${assetId}`; // O manejar de otra forma
            }
        };

        let markdown = `# ${title}\n\n`;
        let assetMarkdown = "";

        // 1. Handle Assets (Image primarily)
        if (this.settings.downloadAssets) {
            let assetToDownloadUrl: string | undefined;
            let assetIdToUse: string | undefined;

            // Prioritize specific asset types if available
            if (bookmark.content.type === "asset" && bookmark.content.assetType === "image" && bookmark.content.assetId) {
                assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.assetId);
                assetIdToUse = bookmark.content.assetId;
            } else if (bookmark.content.type === "link") {
                 if (bookmark.content.imageAssetId) { // Prefer dedicated image asset
                     assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.imageAssetId);
                     assetIdToUse = bookmark.content.imageAssetId;
                 } else if (bookmark.content.screenshotAssetId) { // Fallback to screenshot
                     assetToDownloadUrl = getHoarderAssetUrl(bookmark.content.screenshotAssetId);
                     assetIdToUse = bookmark.content.screenshotAssetId;
                 }
                 // Consider fullPageArchiveAssetId? Probably not for inline display.
                 // Consider videoAssetId? Needs different handling (link or embed).
            }

            if (assetToDownloadUrl && assetIdToUse) {
                const siyuanAssetPath = await this.downloadAndUploadAsset(assetToDownloadUrl, assetIdToUse, title);
                if (siyuanAssetPath) {
                    // Use SiYuan asset path syntax: ![alt](assets/path/to/image.png)
                    assetMarkdown = `![${title || 'asset'}](${siyuanAssetPath})\n\n`;
                } else {
                    // Fallback link if download/upload failed
                    assetMarkdown = `[${this.i18n.assetDownloadFailed || 'Failed to download asset'}: ${this.i18n.viewOnHoarder || 'View on Hoarder'}](${assetToDownloadUrl})\n\n`;
                }
            } else if (bookmark.content.imageUrl) {
                 // If no specific asset ID but an external image URL exists (less common now?)
                 // Decide whether to attempt download or just link: Let's try downloading if downloadAssets is true
                  const siyuanAssetPath = await this.downloadAndUploadAsset(bookmark.content.imageUrl, bookmark.id, title); // Use bookmark ID for uniqueness
                  if (siyuanAssetPath) {
                      assetMarkdown = `![${title || 'image'}](${siyuanAssetPath})\n\n`;
                  } else {
                      assetMarkdown = `![${title || 'image'}](${bookmark.content.imageUrl})\n\n`; // Fallback to external link if download fails
                  }
            }
        } else { // downloadAssets is false, link externally
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
        markdown += assetMarkdown;

        // 2. Core Content Fields
        if (url && bookmark.content.type !== "asset") { // Don't show source URL for assets if it's just an internal ID link
            markdown += `**URL:** [${url}](${url})\n\n`;
        }
        if (bookmark.summary) {
            markdown += `## ${this.i18n.summary || 'Summary'}\n\n${bookmark.summary.trim()}\n\n`;
        }
        if (description && bookmark.content.type !== 'text') { // Avoid duplicating text content if type is 'text'
            markdown += `## ${this.i18n.description || 'Description'}\n\n${description.trim()}\n\n`;
        } else if (description && bookmark.content.type === 'text') {
             markdown += `## ${this.i18n.textContent || 'Text Content'}\n\n${description.trim()}\n\n`;
        }
        if (bookmark.tags.length > 0) {
            markdown += `**${this.i18n.tags || 'Tags'}:** ${bookmark.tags.map(t => `#${t.name.replace(/\s+/g, '-')}`).join(' ')}\n\n`; // Format as SiYuan tags
        }
        markdown += `## ${this.i18n.notes || 'Notes'}\n\n${bookmark.note || ""}\n\n`;

        // 3. HTML Content Snapshot (Converted to Markdown)
        if (htmlContent && htmlContent.trim()) {
            this.logInfo(`Converting htmlContent for bookmark ${bookmark.id}...`);
            try {
                const convertedMarkdown = this.turndownService.turndown(htmlContent);
                if (convertedMarkdown && convertedMarkdown.trim()) {
                    markdown += `## ${this.i18n.contentSnapshot || 'Content Snapshot'}\n\n${convertedMarkdown.trim()}\n\n`;
                } else {
                    this.logInfo(`HTML conversion resulted in empty markdown for bookmark ${bookmark.id}.`);
                }
            } catch (e: any) {
                this.logError(`Error converting htmlContent for bookmark ${bookmark.id}:`, e);
                // Optional: Add error marker in the note
                // markdown += `## Content Snapshot\n\n[Error converting HTML content]\n\n`;
            }
        }

        // 4. Link back to Hoarder
        try {
            const hoarderBaseUrl = new URL(this.settings.apiEndpoint).origin;
            markdown += `----\n[${this.i18n.viewOnHoarder || 'View in Hoarder'}](${hoarderBaseUrl}/dashboard/preview/${bookmark.id})`;
        } catch (e) {
            this.logWarn("Could not determine Hoarder base URL from endpoint:", this.settings.apiEndpoint);
            markdown += `----\nHoarder ID: ${bookmark.id}`;
        }

        return markdown;
    }

    /**
     * Downloads an asset from a URL (potentially authenticated) and uploads it to SiYuan.
     * Returns the SiYuan asset path on success, null on failure.
     */
    private async downloadAndUploadAsset(assetUrl: string, assetIdHint: string, titleHint: string): Promise<string | null> {
        this.logInfo(`Attempting to download and upload asset: ${assetUrl}`);
        try {
            // 1. Download from source URL
            const headers: Record<string, string> = {};
            let needsAuth = false;
            try {
                const apiDomain = new URL(this.settings.apiEndpoint).origin;
                if (assetUrl.startsWith(apiDomain)) {
                    headers["Authorization"] = `Bearer ${this.settings.apiKey}`;
                    needsAuth = true;
                }
            } catch (e) {
                this.logWarn("Could not parse apiEndpoint URL to determine asset domain:", this.settings.apiEndpoint);
            }

            const response = await fetch(assetUrl, { headers });
            if (!response.ok) {
                 if (response.status === 404) {
                    this.logWarn(`Asset not found (404) at ${assetUrl}`);
                 } else if (response.status === 401 || response.status === 403) {
                     this.logWarn(`Authorization error (${response.status}) fetching asset: ${assetUrl}${needsAuth ? ' (Auth header sent)' : ' (No auth header sent)'}`);
                 } else {
                    this.logError(`Failed to download asset (${response.status}) from: ${assetUrl}`);
                 }
                 return null; // Cannot proceed if download fails
            }
            const buffer = await response.arrayBuffer();
            const contentType = response.headers.get("content-type") || "application/octet-stream";

            // 2. Prepare filename for SiYuan
            let fileName = "";
             try {
                 // Try to get filename from URL path
                 const urlPathName = new URL(assetUrl).pathname;
                 fileName = urlPathName.substring(urlPathName.lastIndexOf('/') + 1).split(/[?#]/)[0];
             } catch {
                 // Ignore URL parsing errors if URL is weird
             }

            // Sanitize and fallback filename generation
            if (!fileName || fileName.length > 50 || !fileName.includes('.')) {
                 const extension = this.getExtensionFromContentType(contentType, fileName);
                 const safeTitlePart = titleHint.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 20);
                 // Use part of assetIdHint for uniqueness if available
                 const idPart = assetIdHint.length > 8 ? assetIdHint.substring(0, 8) : assetIdHint;
                 fileName = `${idPart}-${safeTitlePart || 'asset'}.${extension}`;
            }
            // Final sanitization for filename characters
            fileName = fileName.replace(/[\\\/:\*\?"<>\|]/g, "-").replace(/\s/g, '_');

            // 3. Prepare FormData for SiYuan upload
            const formData = new FormData();
            formData.append('assetsDirPath', '/assets/hoarder-sync/'); // Use a dedicated subfolder
            formData.append('assets[]', new File([buffer], fileName, { type: contentType }));
            // notebook ID is required for the API call but seems to place assets globally anyway?
            // Let's include it as it might be used for permissions or future features.
            if (this.settings.syncNotebookId) {
                formData.append('notebook', this.settings.syncNotebookId);
            } else {
                 this.logWarn("No sync notebook ID set, asset upload might behave unexpectedly.");
                 // The API might require a notebook ID. If not set, the upload might fail.
                 // Consider selecting a default notebook or handling this case more robustly.
                 // For now, proceed without it, but log a warning.
            }


            // 4. Upload to SiYuan
            this.logInfo(`Uploading asset '${fileName}' (${(buffer.byteLength / 1024).toFixed(1)} KB) to SiYuan...`);
            const uploadResult = await fetchSyncPost(API_UPLOAD_ASSET, formData);

            if (uploadResult.code === 0 && uploadResult.data?.succMap && uploadResult.data.succMap[fileName]) {
                const siyuanAssetPath = uploadResult.data.succMap[fileName];
                // The path returned by succMap is usually relative like 'assets/hoarder-sync/filename.ext'
                this.logInfo(`Asset uploaded successfully to SiYuan: ${siyuanAssetPath}`);
                return siyuanAssetPath; // Return the relative path for use in Markdown
            } else {
                const errorFiles = uploadResult.data?.errFiles?.join(', ') || 'N/A';
                this.logError(`Failed to upload asset '${fileName}' to SiYuan. Code: ${uploadResult?.code}, Msg: ${uploadResult?.msg}, Errors: ${errorFiles}`, uploadResult);
                return null;
            }
        } catch (error: any) {
            this.logError(`Error during asset download/upload for ${assetUrl}:`, error);
            return null;
        }
    }

    /**
     * Simple helper to guess file extension from Content-Type or existing filename.
     */
     private getExtensionFromContentType(contentType: string, fallbackFileName?: string): string {
         const mimeMap: Record<string, string> = {
             'image/jpeg': 'jpg',
             'image/png': 'png',
             'image/gif': 'gif',
             'image/webp': 'webp',
             'image/svg+xml': 'svg',
             'application/pdf': 'pdf',
         };
         const mainType = contentType.split(';')[0].trim().toLowerCase();
         if (mimeMap[mainType]) {
             return mimeMap[mainType];
         }
         // Try fallback filename extension
         if (fallbackFileName && fallbackFileName.includes('.')) {
            const ext = fallbackFileName.split('.').pop();
            if (ext && ext.length < 5) return ext.toLowerCase(); // Basic validation
         }
         // Absolute fallback
         return 'asset';
     }


    /**
     * Sets the syncing state and updates the UI accordingly.
     */
    private setSyncingState(syncing: boolean) {
        this.isSyncing = syncing;
        if (this.syncButton) {
            this.syncButton.disabled = syncing;
            this.syncButton.textContent = syncing
                ? (this.i18n.syncing || "Syncing...")
                : (this.i18n.syncNow || "Sync Now");
        }
        this.logInfo(`Syncing state set to: ${syncing}`);
    }

    // --- Settings UI Setup ---
    private setupSettingsUI() {
        this.setting = new Setting({
            height: "auto", // Auto height based on content
            width: "600px",
            title: this.i18n.settingsTitle || "Hoarder Sync Settings (One-Way)",
            confirmCallback: async () => {
                // Validation before saving
                if (!this.settings.apiKey) {
                    showMessage(this.i18n.apiKeyMissing || "Hoarder API Key is required.", 3000, "error"); return;
                }
                if (!this.settings.apiEndpoint || !this.settings.apiEndpoint.startsWith("http")) {
                    showMessage(this.i18n.invalidApiEndpoint || "A valid Hoarder API Endpoint (starting with http/https) is required.", 4000, "error"); return;
                }
                if (!this.settings.syncNotebookId) {
                    showMessage(this.i18n.notebookMissing || "Please select a Target SiYuan Notebook.", 3000, "error"); return;
                }
                await this.saveSettings();
                showMessage(this.i18n.settingsSaved || "Hoarder settings saved.");
            }
        });

        // --- UI Element Creation Helpers ---
        const createTextInput = (key: keyof HoarderSyncSettings, placeholder: string, type: 'text' | 'password' | 'url' = 'text'): HTMLInputElement => {
            const input = document.createElement('input');
            input.type = type;
            input.className = 'b3-text-field fn__block';
            input.placeholder = placeholder;
            input.value = this.settings[key] as string ?? ''; // Assume string for text inputs
            input.addEventListener('input', () => {
                (this.settings as any)[key] = input.value;
            });
            return input;
        };

        const createNumberInput = (key: keyof HoarderSyncSettings, placeholder: string, min: number = 0): HTMLInputElement => {
            const input = document.createElement('input');
            input.type = 'number';
            input.className = 'b3-text-field fn__block';
            input.placeholder = placeholder;
            input.min = String(min);
            input.value = String(this.settings[key] ?? DEFAULT_SETTINGS[key]); // Assume number
            input.addEventListener('input', () => {
                const numValue = parseInt(input.value, 10);
                 // Use default if invalid or below min
                this.settings[key] = (!isNaN(numValue) && numValue >= min) ? numValue : (DEFAULT_SETTINGS[key] as any);
                // Update input value in case it was corrected
                input.value = String(this.settings[key]);
            });
            return input;
        };

        const createToggleInput = (key: keyof HoarderSyncSettings): HTMLInputElement => {
            const switchElement = document.createElement('input');
            switchElement.type = 'checkbox';
            switchElement.className = 'b3-switch fn__flex-center';
            switchElement.checked = !!this.settings[key]; // Assume boolean
            switchElement.addEventListener('change', () => {
                this.settings[key] = switchElement.checked as any;
            });
            return switchElement;
        };

         const createTextareaInput = (key: keyof HoarderSyncSettings, placeholder: string, rows: number = 2): HTMLTextAreaElement => {
             const textarea = document.createElement('textarea');
             textarea.className = 'b3-text-field fn__block';
             textarea.rows = rows;
             textarea.placeholder = placeholder;
             // Assume key holds string[] for tags, join them
             if (Array.isArray(this.settings[key])) {
                 textarea.value = (this.settings[key] as string[]).join(', ');
             } else {
                 textarea.value = ''; // Should be an array, handle gracefully
             }
             textarea.addEventListener('input', () => {
                 (this.settings as any)[key] = textarea.value.split(',')
                     .map(tag => tag.trim())
                     .filter(tag => tag.length > 0);
             });
             return textarea;
         };

        // --- Adding Settings Items ---
        this.setting.addItem({
            title: this.i18n.apiKey || "Hoarder API Key",
            description: this.i18n.apiKeyDesc || "Your API key from Hoarder settings.",
            createActionElement: () => createTextInput('apiKey', this.i18n.apiKeyPlaceholder || 'Enter your Hoarder API key', 'password'),
        });

        this.setting.addItem({
            title: this.i18n.apiEndpoint || "Hoarder API Endpoint",
            description: this.i18n.apiEndpointDesc || `Usually ${DEFAULT_SETTINGS.apiEndpoint} or your self-hosted URL.`,
            createActionElement: () => createTextInput('apiEndpoint', DEFAULT_SETTINGS.apiEndpoint, 'url'),
        });

        // Notebook Selector (using fetchPost with callback)
        const notebookSelect = document.createElement('select');
        notebookSelect.className = 'b3-select fn__block';
        notebookSelect.innerHTML = `<option value="">${this.i18n.loadingNotebooks || 'Loading notebooks...'}</option>`;
        notebookSelect.disabled = true;
        fetchPost(API_LS_NOTEBOOKS, {}, (res) => {
            notebookSelect.innerHTML = ''; // Clear loading message
            if (res.code === 0 && res.data?.notebooks) {
                const placeholderOption = document.createElement('option');
                placeholderOption.value = "";
                placeholderOption.textContent = `-- ${this.i18n.selectNotebook || 'Select a Notebook'} --`;
                notebookSelect.appendChild(placeholderOption);

                res.data.notebooks.forEach((notebook: { id: string; name: string }) => {
                    const option = document.createElement('option');
                    option.value = notebook.id;
                    option.textContent = notebook.name;
                    if (notebook.id === this.settings.syncNotebookId) {
                        option.selected = true;
                    }
                    notebookSelect.appendChild(option);
                });
                notebookSelect.disabled = false;
                 // Ensure current setting reflects loaded selection
                 if (this.settings.syncNotebookId && !res.data.notebooks.some((nb: {id: string}) => nb.id === this.settings.syncNotebookId)) {
                     this.logWarn(`Previously selected notebook (${this.settings.syncNotebookId}) not found. Resetting selection.`);
                     this.settings.syncNotebookId = null; // Reset if not found
                 } else if (!this.settings.syncNotebookId) {
                    // If nothing was selected, ensure the placeholder is shown
                    placeholderOption.selected = true;
                 }

            } else {
                const errorOption = document.createElement('option');
                errorOption.value = "";
                errorOption.textContent = this.i18n.errorLoadingNotebooks || 'Error loading notebooks';
                notebookSelect.appendChild(errorOption);
                this.logError("Failed to load notebooks:", res?.code, res?.msg);
                showMessage(`${this.i18n.errorLoadingNotebooks || 'Error loading notebooks'}: ${res?.msg || 'Unknown error'}`, 5000, 'error');
            }
        });
        notebookSelect.addEventListener('change', () => {
            this.settings.syncNotebookId = notebookSelect.value || null;
        });
        this.setting.addItem({
            title: this.i18n.targetNotebook || "Target SiYuan Notebook",
            description: this.i18n.targetNotebookDesc || "The notebook where Hoarder bookmarks will be saved.",
            createActionElement: () => notebookSelect,
        });

        this.setting.addItem({
            title: this.i18n.syncInterval || "Sync Interval (minutes)",
            description: this.i18n.syncIntervalDesc || "How often to automatically sync (0 to disable). Default: 60.",
            createActionElement: () => createNumberInput('syncIntervalMinutes', '60'),
        });

        this.setting.addItem({
            title: this.i18n.excludedTags || "Excluded Tags",
            description: this.i18n.excludedTagsDesc || "Comma-separated. Bookmarks with ANY of these tags won't sync (unless favorited).",
            createActionElement: () => createTextareaInput('excludedTags', this.i18n.excludedTagsPlaceholder || 'e.g., read-later, temp, project-x'),
        });

        this.setting.addItem({
            title: this.i18n.updateExisting || "Update Existing Documents",
            description: this.i18n.updateExistingDesc || "Overwrite if the Hoarder bookmark is newer (based on 'modifiedAt').",
            createActionElement: () => createToggleInput('updateExistingFiles')
        });

        this.setting.addItem({
            title: this.i18n.excludeArchived || "Exclude Archived Bookmarks",
            description: this.i18n.excludeArchivedDesc || "Don't sync bookmarks marked as archived in Hoarder.",
            createActionElement: () => createToggleInput('excludeArchived')
        });

        this.setting.addItem({
            title: this.i18n.onlyFavorites || "Only Sync Favorites",
            description: this.i18n.onlyFavoritesDesc || "Only sync favorites. Excluded tags ignored for favorites.",
            createActionElement: () => createToggleInput('onlyFavorites')
        });

        this.setting.addItem({
            title: this.i18n.downloadAssets || "Download Assets Locally",
            description: this.i18n.downloadAssetsDesc || "Download images/assets into SiYuan. Requires Hoarder server access.",
            createActionElement: () => createToggleInput('downloadAssets')
        });

        // Manual Sync Button and Status
        const syncContainer = document.createElement('div');
        syncContainer.className = "fn__flex fn__flex-center"; // Align items vertically

        this.syncButton = document.createElement('button');
        this.syncButton.className = 'b3-button b3-button--outline fn__flex-center';
        this.syncButton.textContent = this.isSyncing ? (this.i18n.syncing || "Syncing...") : (this.i18n.syncNow || "Sync Now");
        this.syncButton.disabled = this.isSyncing;
        this.syncButton.addEventListener('click', async () => {
             // Re-trigger the command callback for consistency
             this.commands.find(cmd => cmd.langKey === 'syncHoarderBookmarks')?.callback();
        });

        this.syncStatusElement = document.createElement('div');
        this.syncStatusElement.className = "ft__smaller ft__on-surface fn__flex-center fn__margin-left";
        this.updateSyncStatusDisplay(); // Initial status

        syncContainer.appendChild(this.syncButton);
        syncContainer.appendChild(this.syncStatusElement);

        this.setting.addItem({
            title: this.i18n.manualSync || "Manual Sync",
            description: this.i18n.manualSyncDesc || "Trigger synchronization immediately.",
            actionElement: syncContainer, // Use actionElement for complex controls
        });
    }

    /**
     * Updates the text displaying the last sync time in the settings UI.
     */
    private updateSyncStatusDisplay() {
        if (this.syncStatusElement) {
            const lastSyncText = this.i18n.lastSync || "Last synced";
            const neverSyncedText = this.i18n.neverSynced || "Never synced.";
            if (this.settings.lastSyncTimestamp > 0) {
                try {
                    // Format date/time according to user's locale settings
                     this.syncStatusElement.textContent = `${lastSyncText}: ${new Date(this.settings.lastSyncTimestamp).toLocaleString()}`;
                 } catch (e) {
                     // Fallback if toLocaleString fails for some reason
                     this.syncStatusElement.textContent = `${lastSyncText}: ${new Date(this.settings.lastSyncTimestamp).toISOString()}`;
                 }
            } else {
                this.syncStatusElement.textContent = neverSyncedText;
            }
        }
    }

} // Fin de la clase HoarderSyncPlugin