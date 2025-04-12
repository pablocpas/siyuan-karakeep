// src/siyuan_api.ts
import { fetchSyncPost } from "siyuan";
import { KarakeepBookmark, KarakeepSyncSettings, SiyuanAttributes } from "./types";
import {
    API_SQL_QUERY, ATTR_KARAKEEP_ID, ATTR_MODIFIED,
    API_GET_BLOCK_ATTRS, API_SET_BLOCK_ATTRS, API_REMOVE_DOC_BY_ID,
    API_CREATE_DOC_WITH_MD, API_UPLOAD_ASSET, ATTR_PREFIX
} from "./constants";
import { logInfo, logWarn, logError, getExtensionFromContentType, getKarakeepAssetUrl } from "./utils";

/**
 * Finds an existing SiYuan document ID using the Karakeep bookmark ID attribute via SQL.
 */
export async function findExistingDocIdByKarakeepId(notebookId: string, karakeepBookmarkId: string): Promise<string | null> {
    const sqlQuery = `
        SELECT b.id
        FROM blocks AS b
        JOIN attributes AS a ON b.id = a.block_id
        WHERE
            b.box = '${notebookId}' AND
            b.type = 'd' AND
            a.name = '${ATTR_KARAKEEP_ID}' AND
            a.value = '${karakeepBookmarkId}'
        LIMIT 1
    `;
    logInfo(`Searching for existing doc via SQL for Karakeep ID ${karakeepBookmarkId} in notebook ${notebookId}`);
    try {
        const result = await fetchSyncPost<{ id: string }[]>(API_SQL_QUERY, { stmt: sqlQuery });
        if (result.code === 0 && result.data?.length > 0) {
            const foundId = result.data[0].id;
            logInfo(`Found existing document ID via SQL: ${foundId}`);
            return foundId;
        } else if (result.code === 0) {
            logInfo(`No document found via SQL for Karakeep ID ${karakeepBookmarkId}.`);
            return null;
        } else {
            logError(`SQL query failed [${result.code}]: ${result.msg} for Karakeep ID ${karakeepBookmarkId}`);
            return null;
        }
    } catch (error: any) {
        logError(`Network error during SQL query for Karakeep ID ${karakeepBookmarkId}:`, error);
        throw error; // Re-throw network errors
    }
}

/**
 * Gets attributes for a given SiYuan block ID.
 */
export async function getSiYuanBlockAttrs(blockId: string): Promise<SiyuanAttributes | null> {
    try {
        const attrsResult = await fetchSyncPost(API_GET_BLOCK_ATTRS, { id: blockId });
        if (attrsResult.code === 0 && attrsResult.data) {
            return attrsResult.data;
        } else {
            logWarn(`Could not get attributes for block ${blockId} [${attrsResult?.code}] ${attrsResult?.msg}.`);
            return null;
        }
    } catch (error: any) {
        logError(`Network error getting attributes for block ${blockId}:`, error);
        return null; // Treat network error as failure to get attrs
    }
}

/**
 * Sets custom attributes on a SiYuan document block.
 */
export async function setSiYuanDocAttributes(docRootId: string, bookmark: KarakeepBookmark, title: string): Promise<void> {
    const attrs: SiyuanAttributes = {
        [ATTR_KARAKEEP_ID]: bookmark.id,
        [ATTR_MODIFIED]: bookmark.modifiedAt ? new Date(bookmark.modifiedAt).toISOString() : new Date(bookmark.createdAt).toISOString(),
        // Standard SiYuan attributes (might be overwritten by user)
        title: title,
        url: bookmark.content.type === 'link' ? bookmark.content.url : bookmark.content.sourceUrl || '',
        // Custom prefixed attributes
        [`${ATTR_PREFIX}url`]: bookmark.content.type === 'link' ? bookmark.content.url : bookmark.content.sourceUrl || '',
        [`${ATTR_PREFIX}created`]: new Date(bookmark.createdAt).toISOString(),
        [`${ATTR_PREFIX}tags`]: bookmark.tags.map(t => t.name).join(', '),
        [`${ATTR_PREFIX}summary`]: bookmark.summary || '',
        [`${ATTR_PREFIX}favourited`]: String(bookmark.favourited),
        [`${ATTR_PREFIX}archived`]: String(bookmark.archived),
        // Legacy non-prefixed, keep for now? Maybe remove later.
        created: new Date(bookmark.createdAt).toISOString(),
        tags: bookmark.tags.map(t => t.name).join(', '),
        summary: bookmark.summary || '',
        favourited: String(bookmark.favourited),
        archived: String(bookmark.archived),
    };

    try {
        logInfo(`Setting attributes for doc ${docRootId} (Karakeep ID ${bookmark.id})`);
        const setResult = await fetchSyncPost(API_SET_BLOCK_ATTRS, { id: docRootId, attrs: attrs });
        if (setResult.code === 0) {
            logInfo(`Successfully set attributes for doc ${docRootId}.`);
        } else {
            logError(`Failed setting attributes for doc ${docRootId} [${setResult?.code}]: ${setResult?.msg}`);
        }
    } catch (error: any) {
        logError(`Network error setting attributes for doc ${docRootId}:`, error);
    }
}

/**
 * Creates a new document in SiYuan with the given Markdown content.
 * Returns the new document ID on success, null on failure.
 */
export async function createSiYuanDocWithMd(notebookId: string, path: string, markdown: string, karakeepIdForLog: string): Promise<string | null> {
    try {
        const createParams = { notebook: notebookId, path: path, markdown: markdown };
        logInfo(`Calling ${API_CREATE_DOC_WITH_MD} for Karakeep ID ${karakeepIdForLog}`);
        const createResult = await fetchSyncPost(API_CREATE_DOC_WITH_MD, createParams);

        if (createResult?.code === 0 && createResult.data) {
            const newDocId = createResult.data as string;
            logInfo(`Document created successfully for Karakeep ID ${karakeepIdForLog}, new ID: ${newDocId}.`);
            return newDocId;
        } else {
            const errorCode = createResult?.code ?? 'N/A';
            const errorMsg = createResult?.msg ?? 'API call failed or returned unexpected result';
            logError(`Failed to create document for Karakeep ID ${karakeepIdForLog} [${errorCode}]: ${errorMsg}. Path: ${path}`);
            return null;
        }
    } catch (error: any) {
        logError(`Error during document creation API call for Karakeep ID ${karakeepIdForLog}:`, error);
        return null;
    }
}

/**
 * Deletes a SiYuan document by its ID.
 * Returns true on success, false on failure.
 */
export async function removeSiYuanDocById(docId: string): Promise<boolean> {
    try {
        logInfo(`Attempting to delete document ${docId}`);
        const deleteResult = await fetchSyncPost(API_REMOVE_DOC_BY_ID, { id: docId });
        if (deleteResult.code === 0) {
            logInfo(`Successfully deleted document ${docId}.`);
            return true;
        } else {
            logError(`Failed to delete document ${docId} [${deleteResult?.code}]: ${deleteResult?.msg}`);
            return false;
        }
    } catch (error: any) {
        logError(`Network error during delete operation for doc ${docId}:`, error);
        return false;
    }
}


/**
 * Downloads an asset from a URL (potentially authenticated) and uploads it to SiYuan.
 * Returns the SiYuan asset path on success, null on failure.
 */
export async function downloadAndUploadAsset(
    settings: KarakeepSyncSettings,
    assetUrl: string,
    assetIdHint: string,
    titleHint: string
): Promise<string | null> {
    logInfo(`Attempting to download and upload asset: ${assetUrl}`);
    try {
        // 1. Download from source URL
        const headers: Record<string, string> = {};
        let needsAuth = false;
        try {
            const apiDomain = new URL(settings.apiEndpoint).origin;
            if (assetUrl.startsWith(apiDomain)) {
                headers["Authorization"] = `Bearer ${settings.apiKey}`;
                needsAuth = true;
            }
        } catch (e) {
            logWarn("Could not parse apiEndpoint URL to determine asset domain:", settings.apiEndpoint);
        }

        const response = await fetch(assetUrl, { headers });
        if (!response.ok) {
             if (response.status === 404) logWarn(`Asset not found (404) at ${assetUrl}`);
             else if (response.status === 401 || response.status === 403) logWarn(`Authorization error (${response.status}) fetching asset: ${assetUrl}${needsAuth ? ' (Auth header sent)' : ' (No auth header sent)'}`);
             else logError(`Failed to download asset (${response.status}) from: ${assetUrl}`);
             return null;
        }
        const buffer = await response.arrayBuffer();
        const contentType = response.headers.get("content-type") || "application/octet-stream";

        // 2. Prepare filename for SiYuan
        let fileName = "";
         try {
             const urlPathName = new URL(assetUrl).pathname;
             fileName = urlPathName.substring(urlPathName.lastIndexOf('/') + 1).split(/[?#]/)[0];
         } catch { /* Ignore URL parsing errors */ }

        if (!fileName || fileName.length > 50 || !fileName.includes('.')) {
             const extension = getExtensionFromContentType(contentType, fileName);
             const safeTitlePart = titleHint.replace(/[^a-zA-Z0-9_-]/g, '-').substring(0, 20);
             const idPart = assetIdHint.length > 8 ? assetIdHint.substring(0, 8) : assetIdHint;
             fileName = `${idPart}-${safeTitlePart || 'asset'}.${extension}`;
        }
        fileName = fileName.replace(/[\\\/:\*\?"<>\|]/g, "-").replace(/\s/g, '_');

        // 3. Prepare FormData for SiYuan upload
        const formData = new FormData();
        formData.append('assetsDirPath', '/assets/Karakeep-sync/');
        formData.append('assets[]', new File([buffer], fileName, { type: contentType }));
        if (settings.syncNotebookId) {
            formData.append('notebook', settings.syncNotebookId);
        } else {
             logWarn("No sync notebook ID set for asset upload. Upload might fail or have unexpected behavior.");
             // Maybe throw an error or return null here if notebook ID is strictly required
             // return null;
        }

        // 4. Upload to SiYuan
        logInfo(`Uploading asset '${fileName}' (${(buffer.byteLength / 1024).toFixed(1)} KB) to SiYuan...`);
        const uploadResult = await fetchSyncPost(API_UPLOAD_ASSET, formData);

        if (uploadResult.code === 0 && uploadResult.data?.succMap?.[fileName]) {
            const siyuanAssetPath = uploadResult.data.succMap[fileName];
            logInfo(`Asset uploaded successfully to SiYuan: ${siyuanAssetPath}`);
            return siyuanAssetPath; // Relative path like 'assets/Karakeep-sync/filename.ext'
        } else {
            const errorFiles = uploadResult.data?.errFiles?.join(', ') || 'N/A';
            logError(`Failed to upload asset '${fileName}' to SiYuan. Code: ${uploadResult?.code}, Msg: ${uploadResult?.msg}, Errors: ${errorFiles}`, uploadResult);
            return null;
        }
    } catch (error: any) {
        logError(`Error during asset download/upload for ${assetUrl}:`, error);
        return null;
    }
}