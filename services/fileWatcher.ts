import chokidar, { FSWatcher } from 'chokidar';
import path from 'path';
import { BrowserWindow } from 'electron';
import fs from 'fs';

// Map de watchers ativos: directoryId -> instância do watcher
const activeWatchers = new Map<string, FSWatcher>();

// Arquivos pendentes para processar (batching)
const pendingFiles = new Map<string, Set<string>>();
const processingTimeouts = new Map<string, NodeJS.Timeout>();

/**
 * Inicia o monitoramento de uma pasta
 */
export function startWatching(
  directoryId: string,
  dirPath: string,
  mainWindow: BrowserWindow
): { success: boolean; error?: string } {
  // Se já está sendo monitorada, retorna sucesso
  if (activeWatchers.has(directoryId)) {
    return { success: true };
  }

  try {
    // Configuração do chokidar
    const watcher = chokidar.watch(dirPath, {
      ignored: [
        '**/.thumbnails/**',
        '**/thumbnails/**',
        '**/.cache/**',
        '**/node_modules/**',
        '**/.git/**',
      ],
      persistent: true,
      ignoreInitial: true, // Não processar arquivos já existentes
      awaitWriteFinish: {
        stabilityThreshold: 2000, // Aguardar 2s de estabilidade
        pollInterval: 100
      },
      depth: 99, // Monitorar subpastas
    });

    // Handler para novos arquivos
    watcher.on('add', (filePath) => {
      const ext = path.extname(filePath).toLowerCase();

      // Filtrar apenas imagens
      if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
        // Adicionar ao batch
        if (!pendingFiles.has(directoryId)) {
          pendingFiles.set(directoryId, new Set());
        }
        pendingFiles.get(directoryId)!.add(filePath);

        // Debounce: processar após 500ms de inatividade
        if (processingTimeouts.has(directoryId)) {
          clearTimeout(processingTimeouts.get(directoryId)!);
        }

        processingTimeouts.set(directoryId, setTimeout(() => {
          processBatch(directoryId, dirPath, mainWindow);
        }, 500));
      }
    });

    // Handler de erros
    watcher.on('error', (error) => {
      console.error(`Watcher error for ${directoryId}:`, error);

      // Notificar renderer sobre o erro
      const errorMessage = error instanceof Error ? error.message : String(error);
      mainWindow.webContents.send('watcher-error', {
        directoryId,
        error: errorMessage
      });

      // Parar o watcher com problemas
      stopWatching(directoryId);
    });

    // Armazenar watcher
    activeWatchers.set(directoryId, watcher);

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}

/**
 * Para o monitoramento de uma pasta
 */
export function stopWatching(directoryId: string): { success: boolean } {
  const watcher = activeWatchers.get(directoryId);

  if (watcher) {
    watcher.close();
    activeWatchers.delete(directoryId);

    // Limpar batches pendentes
    if (processingTimeouts.has(directoryId)) {
      clearTimeout(processingTimeouts.get(directoryId)!);
      processingTimeouts.delete(directoryId);
    }
    pendingFiles.delete(directoryId);
  }

  return { success: true };
}

/**
 * Para todos os watchers (chamado no app quit)
 */
export function stopAllWatchers(): void {
  for (const [directoryId] of activeWatchers) {
    stopWatching(directoryId);
  }
}

/**
 * Retorna status de um watcher
 */
export function getWatcherStatus(directoryId: string): { active: boolean } {
  return { active: activeWatchers.has(directoryId) };
}

/**
 * Processa batch de arquivos detectados
 */
function processBatch(
  directoryId: string,
  dirPath: string,
  mainWindow: BrowserWindow
): void {
  const files = pendingFiles.get(directoryId);

  if (!files || files.size === 0) return;

  // Converter para array e preparar payload
  const filePaths = Array.from(files);

  const fileInfos = filePaths.map(filePath => {
    try {
      const stats = fs.statSync(filePath);
      return {
        name: path.basename(filePath),
        path: filePath,
        lastModified: stats.mtimeMs,
        size: stats.size,
        type: path.extname(filePath).slice(1) // Remove o "."
      };
    } catch (err) {
      console.error(`Error getting stats for ${filePath}:`, err);
      return null;
    }
  }).filter(Boolean);

  // Enviar para o renderer
  if (fileInfos.length > 0) {
    mainWindow.webContents.send('new-images-detected', {
      directoryId,
      files: fileInfos
    });
  }

  // Limpar batch
  pendingFiles.delete(directoryId);
  processingTimeouts.delete(directoryId);
}
