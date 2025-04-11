// src/constants.ts
// Constantes relacionadas con el almacenamiento y atributos
export const STORAGE_SETTINGS_KEY = "Karakeep-sync-settings";
export const LOG_PREFIX = "[KarakeepSync]";
export const ATTR_PREFIX = "custom-Karakeep-";
export const ATTR_KARAKEEP_ID = `${ATTR_PREFIX}id`;
export const ATTR_MODIFIED = `${ATTR_PREFIX}modified`;

// Constantes de la API de Karakeep
export const BOOKMARK_FETCH_LIMIT = 50;
export const DEFAULT_KARAKEEP_API_ENDPOINT = "https://api.Karakeep.app/api/v1";

// Constantes de la API de SiYuan
export const API_LS_NOTEBOOKS = "/api/notebook/lsNotebooks";
export const API_GET_IDS_BY_HPATH = "/api/filetree/getIDsByHPath"; // No usado directamente en el código refactorizado, pero podría ser útil
export const API_GET_BLOCK_ATTRS = "/api/attr/getBlockAttrs";
export const API_SET_BLOCK_ATTRS = "/api/attr/setBlockAttrs";
export const API_REMOVE_DOC_BY_ID = "/api/filetree/removeDocByID";
export const API_CREATE_DOC_WITH_MD = "/api/filetree/createDocWithMd";
export const API_UPLOAD_ASSET = "/api/asset/upload";
export const API_SQL_QUERY = "/api/query/sql";