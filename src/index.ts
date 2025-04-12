// src/index.ts
import { Plugin, Setting } from "siyuan"; // Solo importar lo necesario aquí
import TurndownService from "turndown";

// Importar módulos refactorizados
import { STORAGE_SETTINGS_KEY } from "./constants";
import { loadSettings, setupSettingsDialog } from "./settings";
import { KarakeepSyncSettings } from "./types";
import { addCommands, addToolbarButton, setSyncingState, updateSyncStatusDisplay } from "./ui";
import { runSyncCycle } from "./sync_logic";
import { logInfo, logWarn, logError } from "./utils"; // Importar loggers

import "./index.scss"; // Estilos

export default class KarakeepSyncPlugin extends Plugin {
    // Mantener estado y referencias importantes aquí
    public settings!: KarakeepSyncSettings; // "!" indica que se inicializará en onload
    public isSyncing = false;
    public syncIntervalId: number | null = null;
    public turndownService!: TurndownService; // Inicializado en onload
    public topBarButtonElement: HTMLElement | null = null; // Para el botón de la barra superior

    // Referencias a elementos UI del diálogo de ajustes (manejados por settings.ts y ui.ts)
    public setting!: Setting; // Instancia del diálogo de ajustes
    public syncButton: HTMLButtonElement | null = null; // Botón "Sync Now" en ajustes
    public syncStatusElement: HTMLElement | null = null; // Texto "Last Synced" en ajustes

    async onload() {
        this.logInfo("Loading plugin...");

        // Inicializar Turndown
        this.turndownService = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            emDelimiter: "*",
            strongDelimiter: "**",
        });

        // Cargar ajustes (ahora llama a la función importada)
        await loadSettings(this); // Pasa "this" para que la función pueda modificar plugin.settings

        // Configurar UI de ajustes (llama a la función importada)
        setupSettingsDialog(this); // Pasa "this" para acceder a i18n, settings, métodos, etc.

        // Registrar comandos (llama a la función importada)
        addCommands(this);

        // Añadir botón a la barra superior (llama a la función importada)
        addToolbarButton(this);

        // Iniciar sincronización periódica (lógica permanece aquí)
        this.startPeriodicSync();

        this.logInfo("Plugin loaded successfully.");
    }

    onunload() {
        this.logInfo("Unloading plugin...");
        this.stopPeriodicSync();

        // Limpiar botón de la barra superior
        if (this.topBarButtonElement && this.topBarButtonElement.parentElement) {
            try {
                this.topBarButtonElement.parentElement.removeChild(this.topBarButtonElement);
                 this.logInfo("Toolbar button removed.");
            } catch (e){
                 this.logError("Error removing toolbar button:", e);
            }
        }
         this.topBarButtonElement = null; // Limpiar referencia

        this.logInfo("Plugin unloaded.");
    }

    // --- Logging Wrappers (opcional, si prefieres llamar a this.log...) ---
    // Podrías quitar estos y usar los importados directamente, pero así mantienes la interfaz this.logX
    public logInfo(message: string, ...args: any[]) { logInfo(message, ...args); }
    public logWarn(message: string, ...args: any[]) { logWarn(message, ...args); }
    public logError(message: string, ...args: any[]) { logError(message, ...args); }

    // --- Periodic Sync Control (Lógica permanece aquí) ---
    public startPeriodicSync() {
        this.stopPeriodicSync(); // Detener anterior si existe

        const intervalMinutes = this.settings?.syncIntervalMinutes; // Asegurar que settings esté cargado
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
            this.logInfo("Performing scheduled Karakeep sync...");
            this.setSyncingState(true); // Marcar como sincronizando
            try {
                 const result = await runSyncCycle(this); // Ejecutar ciclo
                 this.logInfo("Scheduled sync finished.", result);
                 // Opcional: Mostrar mensaje visual para sync programado
                 // showMessage(`${this.i18n.scheduledSyncComplete || "Scheduled sync"}: ${result.message}`, 3000, result.success ? "info" : "error");
                 // Guardar timestamp después del ciclo programado exitoso
                 if (result.success) {
                      // La hora ya se actualizó en runSyncCycle, solo necesitamos guardarla
                      await this.saveData(STORAGE_SETTINGS_KEY, this.settings); // Guardar directamente aquí
                      this.logInfo("Scheduled sync successful, settings (timestamp) saved.");
                 }

            } catch (error) {
                 this.logError("CRITICAL ERROR during scheduled sync:", error);
                 // showMessage("Scheduled sync failed critically.", 5000, "error");
            } finally {
                 this.setSyncingState(false); // Desmarcar como sincronizando
                 this.updateSyncStatusDisplay(); // Actualizar UI
            }
        }, intervalMillis);
    }

    public stopPeriodicSync() {
        if (this.syncIntervalId !== null) {
            window.clearInterval(this.syncIntervalId);
            this.syncIntervalId = null;
            this.logInfo("Periodic sync stopped.");
        }
    }

    // --- Métodos de UI Wrappers (llaman a funciones importadas) ---
    // Estos permiten que otras partes del plugin (como settings.ts)
    // llamen a this.setSyncingState() etc.
    public setSyncingState(syncing: boolean): void {
        setSyncingState(this, syncing);
    }

    public updateSyncStatusDisplay(): void {
        updateSyncStatusDisplay(this);
    }

    // El método saveSettings ahora está en settings.ts, se llama desde allí o desde el confirmCallback
    // El método loadSettings ahora está en settings.ts, se llama desde onload

} // Fin de la clase KarakeepSyncPlugin