// src/sync_logic.ts
import { showMessage } from "siyuan";
import { KarakeepBookmark, ProcessResult } from "./types";
import { fetchKarakeepBookmarks } from "./karakeep_api";
import {
    findExistingDocIdByKarakeepId, getSiYuanBlockAttrs, removeSiYuanDocById,
    createSiYuanDocWithMd, setSiYuanDocAttributes
} from "./siyuan_api";
import { formatBookmarkAsMarkdown, getBookmarkTitle } from "./formatting";
import { sanitizeSiYuanPath } from "./utils";
import { ATTR_MODIFIED } from "./constants";
import KarakeepSyncPlugin from "./index"; // Para acceder a settings, logs, i18n

/**
 * Runs a full synchronization cycle. Fetches and processes bookmarks.
 * NOTE: This function assumes the 'isSyncing' state is managed by the caller.
 */
export async function runSyncCycle(plugin: KarakeepSyncPlugin): Promise<{ success: boolean; message: string }> {
    let createdCount = 0, updatedCount = 0, skippedCount = 0, skippedFilteredCount = 0, errorCount = 0;
    let criticalErrorOccurred = false;
    let finalMessage = "";
    let notebookId: string | null = null;

    try {
        plugin.logInfo("SYNC CYCLE: Starting.");

        // Config checks
        if (!plugin.settings.apiKey) throw new Error(plugin.i18n.apiKeyMissing || "Karakeep API key not configured.");
        if (!plugin.settings.syncNotebookId) throw new Error(plugin.i18n.notebookMissing || "Target SiYuan notebook not configured.");
        notebookId = plugin.settings.syncNotebookId;
        plugin.logInfo(`SYNC CYCLE: Config checks passed. Notebook ID: ${notebookId}`);

        // Sync Loop
        let cursor: string | undefined;
        const processedBookmarkIds = new Set<string>();
        let pageCount = 0;
        do {
             pageCount++;
             plugin.logInfo(`SYNC CYCLE: Fetching page ${pageCount}. Cursor: ${cursor ? "..." + cursor.slice(-4) : "start"}`);
             const response = await fetchKarakeepBookmarks(plugin.settings, cursor);
             const bookmarks = response.bookmarks || [];
             cursor = response.nextCursor;
             plugin.logInfo(`SYNC CYCLE: Received ${bookmarks.length} bookmarks. Total fetched so far: ${processedBookmarkIds.size + bookmarks.length}. Has next page: ${!!cursor}`);

             for (const bookmark of bookmarks) {
                 if (processedBookmarkIds.has(bookmark.id)) {
                     plugin.logWarn(`SYNC CYCLE: Duplicate bookmark ID ${bookmark.id} encountered in pagination. Skipping.`);
                     continue;
                 }
                 processedBookmarkIds.add(bookmark.id);

                 const result: ProcessResult = await processBookmark(plugin, bookmark, notebookId as string);
                 switch (result.status) {
                     case "created": createdCount++; break;
                     case "updated": updatedCount++; break;
                     case "skipped": skippedCount++; break;
                     case "skipped_filtered": skippedFilteredCount++; break;
                     case "error":
                         errorCount++;
                         plugin.logError(`SYNC CYCLE: Error processing bookmark ${bookmark.id}: ${result.message}`);
                         // Decide si parar en el primer error
                         // criticalErrorOccurred = true; // Descomentar para parar ante el primer error
                         break;
                 }
                 if (criticalErrorOccurred) {
                    plugin.logWarn("SYNC CYCLE: Critical error flag set. Breaking loop.");
                    break; // Salir del bucle for
                 }
             }
             plugin.logInfo(`SYNC CYCLE: Finished processing page ${pageCount}. Stats: C=${createdCount}, U=${updatedCount}, S=${skippedCount}, SF=${skippedFilteredCount}, E=${errorCount}`);
             if (criticalErrorOccurred) break; // Salir del bucle do-while

        } while (cursor && !criticalErrorOccurred);

        plugin.logInfo("SYNC CYCLE: Sync loop finished.");

        if (!criticalErrorOccurred) {
            plugin.logInfo("SYNC CYCLE: Saving last sync timestamp...");
            plugin.settings.lastSyncTimestamp = Date.now();
            // No guardar aquí, saveSettings() se llama fuera si es necesario
            // await saveSettings(plugin); // Evitar guardado parcial si hay errores
             plugin.logInfo("SYNC CYCLE: Timestamp updated in memory.");
        }

    } catch (error: any) {
        plugin.logError("SYNC CYCLE: CRITICAL ERROR during sync cycle:", error);
        criticalErrorOccurred = true;
        finalMessage = `${plugin.i18n.syncFailed || "Sync failed critically"}: ${error.message || "Unknown error"}`;
        errorCount++; // Contabilizar el error crítico
    }
    // Construir mensaje final fuera del try-catch
    if (!criticalErrorOccurred) {
       finalMessage = `${plugin.i18n.syncComplete || "Sync complete"}: ${createdCount} ${plugin.i18n.created || "created"}, ${updatedCount} ${plugin.i18n.updated || "updated"}, ${skippedCount + skippedFilteredCount} ${plugin.i18n.skipped || "skipped"}`;
       if (skippedFilteredCount > 0) { finalMessage += ` (${skippedFilteredCount} ${plugin.i18n.filtered || "filtered"})`; }
       if (errorCount > 0) { finalMessage += `, ${errorCount} ${plugin.i18n.errors || "errors"} (${plugin.i18n.checkLogs || "check logs"})`; }
   } else if (!finalMessage) {
       // Si hubo error crítico pero no se asignó mensaje (p.ej., error antes del loop)
       finalMessage = plugin.i18n.syncFailed || "Sync failed critically";
   }

   const success = !criticalErrorOccurred && errorCount === 0;
   plugin.logInfo(`SYNC CYCLE: Finished. Success: ${success}, Message: "${finalMessage}"`);
   return { success: success, message: finalMessage };
}


/**
 * Processes a single Karakeep bookmark: filters, checks existence, creates/updates in SiYuan.
 */
async function processBookmark(plugin: KarakeepSyncPlugin, bookmark: KarakeepBookmark, notebookId: string): Promise<ProcessResult> {
    // 1. Apply Filters
    if (plugin.settings.excludeArchived && bookmark.archived) return { status: "skipped_filtered", message: "Archived" };
    if (plugin.settings.onlyFavorites && !bookmark.favourited) return { status: "skipped_filtered", message: "Not favorite" };
    // Apply tag filter only if *not* a favorite (favorites bypass tag exclusion)
    if (!bookmark.favourited && plugin.settings.excludedTags.length > 0) {
        const bookmarkTagsLower = bookmark.tags.map((tag) => tag.name.toLowerCase());
        const excludedTagsLower = plugin.settings.excludedTags.map(t => t.toLowerCase().trim()).filter(t => t);
        if (excludedTagsLower.some((excludedTag) => bookmarkTagsLower.indexOf(excludedTag) !== -1)) {
            return { status: "skipped_filtered", message: "Excluded tag" };
        }
    }

    // 2. Prepare Document Info
    const title = getBookmarkTitle(bookmark);
    const safeDocPath = `/${sanitizeSiYuanPath(title, bookmark.createdAt)}`.replace(/^\/+/, "/"); // Ensure single leading slash

    try {
        // 3. Check if Document Exists
        const existingDocId = await findExistingDocIdByKarakeepId(notebookId, bookmark.id);

        if (existingDocId) {
            // 4. Document Exists: Decide whether to update
            const shouldUpdate = await shouldUpdateDocument(plugin, existingDocId, bookmark);
            if (shouldUpdate) {
                plugin.logInfo(`Updating existing document ${existingDocId} for bookmark ${bookmark.id} at path ${safeDocPath}`);
                return await updateSiYuanDocument(plugin, existingDocId, bookmark, notebookId, title, safeDocPath);
            } else {
                plugin.logInfo(`Skipping existing document ${existingDocId} (up-to-date or update disabled).`);
                return { status: "skipped", message: "Exists, no update needed" };
            }
        } else {
            // 5. Document Does Not Exist: Create new one
            plugin.logInfo(`Creating new document for bookmark ${bookmark.id} at path ${notebookId}:${safeDocPath}`);
            return await createNewSiYuanDocument(plugin, bookmark, notebookId, title, safeDocPath);
        }
    } catch (error: any) {
        plugin.logError(`Failed to process bookmark ${bookmark.id} (path: ${safeDocPath}):`, error);
        return { status: "error", message: error.message || "Unknown processing error" };
    }
}

/**
 * Checks if an existing SiYuan document should be updated.
 */
async function shouldUpdateDocument(plugin: KarakeepSyncPlugin, docId: string, bookmark: KarakeepBookmark): Promise<boolean> {
    if (!plugin.settings.updateExistingFiles) {
        return false; // Update is disabled
    }

    const attrs = await getSiYuanBlockAttrs(docId);
    if (attrs) {
        const storedModifiedTime = attrs[ATTR_MODIFIED] ? new Date(attrs[ATTR_MODIFIED]).getTime() : 0;
        const bookmarkModifiedTime = bookmark.modifiedAt ? new Date(bookmark.modifiedAt).getTime() : new Date(bookmark.createdAt).getTime();

        if (!storedModifiedTime || bookmarkModifiedTime > storedModifiedTime) {
            plugin.logInfo(`Marking doc ${docId} for update (bookmark modified: ${bookmarkModifiedTime} > stored: ${storedModifiedTime}).`);
            return true;
        } else {
            return false; // Document is up-to-date
        }
    } else {
        // Failed to get attributes, assume update needed to be safe
        plugin.logWarn(`Could not get attributes for existing doc ${docId}. Assuming update needed.`);
        return true;
    }
}

/**
 * Creates a new SiYuan document.
 */
async function createNewSiYuanDocument(plugin: KarakeepSyncPlugin, bookmark: KarakeepBookmark, notebookId: string, title: string, path: string): Promise<ProcessResult> {
    try {
        const markdownContent = await formatBookmarkAsMarkdown(plugin, bookmark, title);
        const newDocId = await createSiYuanDocWithMd(notebookId, path, markdownContent, bookmark.id);

        if (newDocId) {
            await setSiYuanDocAttributes(newDocId, bookmark, title);
            return { status: "created" };
        } else {
            // Error already logged by createSiYuanDocWithMd
            return { status: "error", message: "Failed to create document via API." };
        }
    } catch (error: any) {
        plugin.logError(`Error during new document creation process for bookmark ${bookmark.id}:`, error);
        return { status: "error", message: error.message || "Document creation failed" };
    }
}

/**
 * Updates an existing SiYuan document by deleting and recreating it.
 */
async function updateSiYuanDocument(plugin: KarakeepSyncPlugin, existingDocId: string, bookmark: KarakeepBookmark, notebookId: string, title: string, path: string): Promise<ProcessResult> {
    // 1. Delete the existing document
    const deleted = await removeSiYuanDocById(existingDocId);
    if (!deleted) {
        return { status: "error", message: `Failed to delete old doc ${existingDocId}` };
    }
    plugin.logInfo(`Successfully deleted existing doc ${existingDocId}. Recreating...`);

    // 2. Recreate the document
    const createResult = await createNewSiYuanDocument(plugin, bookmark, notebookId, title, path);

    // Adjust the status from 'created' to 'updated' if creation was successful
    if (createResult.status === "created") {
        return { status: "updated" };
    } else {
        // If recreation failed, return the error from createNewSiYuanDocument
        plugin.logError(`Failed to recreate document after deletion for bookmark ${bookmark.id}. Previous ID was ${existingDocId}.`);
        return createResult; // Propagate the error result
    }
}