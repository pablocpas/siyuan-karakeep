// src/types.ts
import { IObject } from "siyuan"; // Importar IObject si es necesario para otras interfaces

// --- Interfaces Karakeep ---
export interface KarakeepTag {
    id: string;
    name: string;
    attachedBy: "ai" | "human";
}

export interface KarakeepBookmarkContent {
    type: "link" | "text" | "asset" | "unknown";
    url?: string;
    title?: string;
    description?: string;
    imageUrl?: string;
    imageAssetId?: string;
    screenshotAssetId?: string;
    fullPageArchiveAssetId?: string;
    videoAssetId?: string;
    favicon?: string;
    htmlContent?: string;
    crawledAt?: string;
    text?: string;
    sourceUrl?: string;
    assetType?: "image" | "pdf";
    assetId?: string;
    fileName?: string;
}

export interface KarakeepBookmark {
    id: string;
    createdAt: string;
    modifiedAt?: string;
    title: string | null;
    archived: boolean;
    favourited: boolean;
    taggingStatus: "success" | "failure" | "pending" | null;
    note: string | null;
    summary: string | null;
    tags: KarakeepTag[];
    content: KarakeepBookmarkContent;
}

export interface KarakeepResponse {
    bookmarks: KarakeepBookmark[];
    total: number;
    nextCursor?: string;
}

// --- Settings Interface ---
export interface KarakeepSyncSettings {
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

// --- Tipo para el resultado del procesamiento ---
export type ProcessResult = {
    status: "created" | "updated" | "skipped" | "skipped_filtered" | "error";
    message?: string; // Mensaje de error o detalle
};

// Helper para atributos de Siyuan si es necesario
export type SiyuanAttributes = IObject;