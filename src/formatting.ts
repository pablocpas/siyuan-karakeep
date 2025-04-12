// src/formatting.ts
import { KarakeepBookmark } from "./types";
import { downloadAndUploadAsset } from "./siyuan_api";
import { logInfo, logWarn, logError, getKarakeepAssetUrl } from "./utils";
import KarakeepSyncPlugin from "./index"; // Para acceder a i18n

/**
 * Generates a suitable title for the SiYuan document.
 */
export function getBookmarkTitle(bookmark: KarakeepBookmark): string {
    if (bookmark.title?.trim()) return bookmark.title.trim();

    const content = bookmark.content;
    if (content.type === "link") {
        if (content.title?.trim()) return content.title.trim();
        if (content.url) {
            try {
                const url = new URL(content.url);
                const pathSegments = url.pathname.split("/");
                const lastSegment = pathSegments.pop() || pathSegments.pop();
                if (lastSegment) {
                    const decodedSegment = decodeURIComponent(lastSegment);
                    const pathTitle = decodedSegment.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ").trim();
                    if (pathTitle) return pathTitle;
                }
                return url.hostname.replace(/^www\./, "");
            } catch { return content.url.substring(0, 100); }
        }
    } else if (content.type === "text" && content.text) {
        const firstLine = content.text.split("\n")[0].trim();
        return firstLine.length <= 100 ? firstLine : firstLine.substring(0, 97) + "...";
    } else if (content.type === "asset") {
        if (content.fileName) return content.fileName.replace(/\.[^/.]+$/, "").trim();
        if (content.sourceUrl) {
            try {
                const url = new URL(content.sourceUrl);
                 const pathSegments = url.pathname.split("/");
                 const lastSegment = pathSegments.pop() || pathSegments.pop();
                 if (lastSegment) return decodeURIComponent(lastSegment);
                 return url.hostname;
            } catch { return content.sourceUrl.substring(0, 100); }
        }
    }

    const dateStr = new Date(bookmark.createdAt).toISOString().split("T")[0];
    return `Bookmark-${bookmark.id.substring(0, 8)}-${dateStr}`;
}

/**
 * Formats a Karakeep bookmark into Markdown content for a SiYuan document.
 */
export async function formatBookmarkAsMarkdown(
    plugin: KarakeepSyncPlugin, // Necesario para settings, i18n, turndown
    bookmark: KarakeepBookmark,
    title: string
): Promise<string> {
    const settings = plugin.settings;
    const i18n = plugin.i18n;
    const turndownService = plugin.turndownService;

    const url = bookmark.content.type === "link" ? bookmark.content.url : bookmark.content.sourceUrl;
    const description = bookmark.content.type === "link" ? bookmark.content.description : bookmark.content.text;
    const htmlContent = bookmark.content.htmlContent;

    let markdown = `# ${title}\n\n`;
    let assetMarkdown = "";

    // 1. Handle Assets
    let assetUrlToProcess: string | null = null;
    let assetIdForHint: string = bookmark.id; // Use bookmark ID as default hint
    let assetDescription = title || "asset";

    // Determine which asset URL to use (if any)
    if (bookmark.content.type === "asset" && bookmark.content.assetType === "image" && bookmark.content.assetId) {
        assetUrlToProcess = getKarakeepAssetUrl(settings.apiEndpoint, bookmark.content.assetId);
        assetIdForHint = bookmark.content.assetId;
    } else if (bookmark.content.type === "link") {
         if (bookmark.content.imageAssetId) {
             assetUrlToProcess = getKarakeepAssetUrl(settings.apiEndpoint, bookmark.content.imageAssetId);
             assetIdForHint = bookmark.content.imageAssetId;
         } else if (bookmark.content.screenshotAssetId) {
             assetUrlToProcess = getKarakeepAssetUrl(settings.apiEndpoint, bookmark.content.screenshotAssetId);
             assetIdForHint = bookmark.content.screenshotAssetId;
         }
    } else if (bookmark.content.imageUrl) { // Fallback to direct imageUrl only if other assets are missing
        assetUrlToProcess = bookmark.content.imageUrl;
        assetDescription = title || "image";
    }

    // Process the chosen asset URL
    if (assetUrlToProcess) {
        if (settings.downloadAssets) {
            const siyuanAssetPath = await downloadAndUploadAsset(settings, assetUrlToProcess, assetIdForHint, assetDescription);
            if (siyuanAssetPath) {
                assetMarkdown = `![${assetDescription}](${siyuanAssetPath})\n\n`;
            } else {
                 const viewText = i18n.viewOnKarakeep || "View on Karakeep";
                 const failText = i18n.assetDownloadFailed || "Failed to download asset";
                assetMarkdown = `[${failText}: ${viewText}](${assetUrlToProcess})\n\n`;
            }
        } else { // Link externally if downloadAssets is false
            assetMarkdown = `![${assetDescription}](${assetUrlToProcess})\n\n`;
        }
    }
    markdown += assetMarkdown;


    // 2. Core Content Fields
    if (url && bookmark.content.type !== "asset") {
        markdown += `**URL:** [${url}](${url})\n\n`;
    }
    if (bookmark.summary) {
        markdown += `## ${i18n.summary || "Summary"}\n\n${bookmark.summary.trim()}\n\n`;
    }
    if (description && bookmark.content.type !== "text") {
        markdown += `## ${i18n.description || "Description"}\n\n${description.trim()}\n\n`;
    } else if (description && bookmark.content.type === "text") {
         markdown += `## ${i18n.textContent || "Text Content"}\n\n${description.trim()}\n\n`;
    }
    if (bookmark.tags.length > 0) {
        markdown += `**${i18n.tags || "Tags"}:** ${bookmark.tags.map(t => `#${t.name.replace(/\s+/g, "-")}`).join(" ")}\n\n`;
    }
    markdown += `## ${i18n.notes || "Notes"}\n\n${bookmark.note || ""}\n\n`;

    // 3. HTML Content Snapshot
    if (htmlContent?.trim()) {
        logInfo(`Converting htmlContent for bookmark ${bookmark.id}...`);
        try {
            const convertedMarkdown = turndownService.turndown(htmlContent);
            if (convertedMarkdown?.trim()) {
                markdown += `## ${i18n.contentSnapshot || "Content Snapshot"}\n\n${convertedMarkdown.trim()}\n\n`;
            } else {
                logInfo(`HTML conversion resulted in empty markdown for bookmark ${bookmark.id}.`);
            }
        } catch (e: any) {
            logError(`Error converting htmlContent for bookmark ${bookmark.id}:`, e);
        }
    }

    // 4. Link back to Karakeep
    try {
        const KarakeepBaseUrl = new URL(settings.apiEndpoint).origin;
        markdown += `----\n[${i18n.viewOnKarakeep || "View in Karakeep"}](${KarakeepBaseUrl}/dashboard/preview/${bookmark.id})`;
    } catch (e) {
        logWarn("Could not determine Karakeep base URL from endpoint:", settings.apiEndpoint);
        markdown += `----\nKarakeep ID: ${bookmark.id}`;
    }

    return markdown;
}