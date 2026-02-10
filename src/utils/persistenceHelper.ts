/**
 * Helper para robustez ante cierre de IndexedDB por el navegador (ahorro de energía).
 * Firestore usa IndexedDB internamente; si la conexión se cierra, las operaciones pueden fallar.
 */

const IDB_CLOSING_PATTERNS = [
  /IDBDatabase connection is closing/i,
  /connection is closing/i,
  /IndexedDB.*closed/i,
  /InvalidStateError/i,
  /Database has been closed/i,
  /Failed to execute.*on IDB/i,
];

export function isIndexedDBClosedError(e: unknown): boolean {
  if (!e) return false;
  const msg = e instanceof Error ? e.message : String(e);
  return IDB_CLOSING_PATTERNS.some((p) => p.test(msg));
}

const DEFAULT_DELAY_MS = 800;
const DEFAULT_MAX_RETRIES = 3;

/**
 * Ejecuta una operación async y, si falla por cierre de IndexedDB, reintenta tras un delay.
 * Útil para getDocs, getDocFromServer y otras lecturas Firestore.
 */
export async function withRetryOnIndexedDBClosed<T>(
  fn: () => Promise<T>,
  options: { delayMs?: number; maxRetries?: number } = {}
): Promise<T> {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxRetries && isIndexedDBClosedError(e)) {
        try {
          console.warn('[Persistence] IndexedDB cerrada, reintento en', delayMs, 'ms (intento', attempt + 1, '/', maxRetries + 1, ')');
        } catch (_) {}
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
}

/**
 * Espera a que IndexedDB esté estable (evita operar mientras se está cerrando).
 * Retorna después de un breve delay si se detectó un error de cierre reciente.
 */
export function waitForIndexedDBStable(): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 150);
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        clearTimeout(t);
        resolve();
      }, { timeout: 200 });
    }
  });
}
