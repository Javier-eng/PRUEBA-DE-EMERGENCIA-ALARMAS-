/**
 * Monitor de conexión: si la app está offline más de 10 segundos, fuerza
 * terminate() + clearPersistence() y recarga para limpiar el canal Listen bloqueado.
 */

import { reconnectFirestoreAfterOffline } from '../firebaseConfig';

const OFFLINE_THRESHOLD_MS = 10_000;

let timeoutId: ReturnType<typeof setTimeout> | null = null;

function clearOfflineTimer(): void {
  if (timeoutId !== null) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}

function scheduleReconnect(): void {
  if (timeoutId !== null) return;
  timeoutId = setTimeout(() => {
    timeoutId = null;
    try {
      console.warn('[ConnectionMonitor] Offline > 10s, reconectando Firestore (terminate + clearPersistence + reload)');
      reconnectFirestoreAfterOffline();
    } catch (e) {
      console.warn('[ConnectionMonitor] No se pudo reconectar:', (e as Error)?.message);
    }
  }, OFFLINE_THRESHOLD_MS);
}

export function startConnectionMonitor(): void {
  if (typeof window === 'undefined' || !window.navigator) return;

  const onOnline = (): void => {
    clearOfflineTimer();
  };

  const onOffline = (): void => {
    scheduleReconnect();
  };

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  if (!navigator.onLine) {
    scheduleReconnect();
  }
}

