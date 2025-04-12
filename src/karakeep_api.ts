// src/karakeep_api.ts
import { KarakeepResponse, KarakeepSyncSettings } from "./types";
import { BOOKMARK_FETCH_LIMIT } from "./constants";
import { logInfo, logError } from "./utils"; // Use utility loggers

/**
 * Fetches a batch of bookmarks from the Karakeep API.
 */
export async function fetchKarakeepBookmarks(settings: KarakeepSyncSettings, cursor?: string): Promise<KarakeepResponse> {
    const endpoint = settings.apiEndpoint.replace(/\/$/, ""); // Ensure no trailing slash
    const apiUrl = `${endpoint}/bookmarks`;
    const queryParams = new URLSearchParams({
        limit: BOOKMARK_FETCH_LIMIT.toString(),
        sort: "createdAt",
        order: "asc"
    });
    if (cursor) {
        queryParams.append("cursor", cursor);
    }

    logInfo(`Fetching Karakeep bookmarks: ${apiUrl}?${queryParams.toString()}`);
    try {
        const response = await fetch(`${apiUrl}?${queryParams.toString()}`, {
            headers: {
                Authorization: `Bearer ${settings.apiKey}`,
                "Content-Type": "application/json",
            }
        });
        if (!response.ok) {
            const errorText = await response.text();
            logError("Karakeep API Error:", response.status, errorText);
            throw new Error(`Karakeep API request failed: ${response.status} ${errorText}`);
        }
        return response.json() as Promise<KarakeepResponse>;
    } catch (error) {
        logError("Error fetching bookmarks from Karakeep:", error);
        throw error; // Re-throw to be caught by the sync cycle
    }
}