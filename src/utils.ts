// src/utils.ts
import { LOG_PREFIX } from "./constants";

// --- Logging Helpers ---
// Note: These could be standalone, but accessing plugin"s logger might be better if Siyuan provides one.
// Keeping them simple for now.
export function logInfo(message: string, ...args: any[]) { console.info(`${LOG_PREFIX} ${message}`, ...args); }
export function logWarn(message: string, ...args: any[]) { console.warn(`${LOG_PREFIX} ${message}`, ...args); }
export function logError(message: string, ...args: any[]) { console.error(`${LOG_PREFIX} ${message}`, ...args); }

/**
 * Sanitizes a string to be used as part of a SiYuan file path segment.
 */
export function sanitizeSiYuanPath(title: string, createdAt: string): string {
    const dateStr = new Date(createdAt).toISOString().split("T")[0]; // YYYY-MM-DD

    let sanitizedTitle = title
        .replace(/[\\\/:\*\?"<>\|#%\^\&\{\}\[\]\n\r\t]/g, "-")
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

/**
 * Simple helper to guess file extension from Content-Type or existing filename.
 */
export function getExtensionFromContentType(contentType: string, fallbackFileName?: string): string {
    const mimeMap: Record<string, string> = {
        "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif",
        "image/webp": "webp", "image/svg+xml": "svg", "application/pdf": "pdf",
    };
    const mainType = contentType.split(";")[0].trim().toLowerCase();
    if (mimeMap[mainType]) {
        return mimeMap[mainType];
    }
    if (fallbackFileName && fallbackFileName.includes(".")) {
       const ext = fallbackFileName.split(".").pop();
       if (ext && ext.length < 5) return ext.toLowerCase();
    }
    return "asset"; // Absolute fallback
}

/**
 * Helper to construct the Karakeep asset URL from the API endpoint.
 */
export function getKarakeepAssetUrl(apiEndpoint: string, assetId: string): string | null {
    try {
         const baseUrl = new URL(apiEndpoint);
         const origin = baseUrl.origin;
         return `${origin}/assets/${assetId}`;
    } catch (e) {
         logWarn(`Could not parse Karakeep API endpoint (${apiEndpoint}) to build asset URL.`);
         return null; // Indicate failure
    }
}