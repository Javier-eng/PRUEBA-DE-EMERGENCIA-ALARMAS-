/**
 * Envía una copia de las alarmas activas al Service Worker para que las tenga cacheadas.
 * Así, aunque el stream Listen de Firestore falle, el SW tiene la última lista y las
 * notificaciones pueden seguir sonando desde la app (que mantiene el último estado).
 */
import type { Alarm } from '../types';
import { sanitizeAlarmLabel } from './sanitizeAlarmLabel';

export function syncAlarmsToServiceWorker(alarms: Alarm[]): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const payload = alarms
    .filter((a) => a.active)
    .map((a) => ({
      id: a.id,
      datetimeUTC: a.datetimeUTC,
      date: a.date,
      time: a.time,
      label: sanitizeAlarmLabel(a.label), // Sanitizado para evitar problemas
    }));
  try {
    controller.postMessage({ type: 'CACHE_ALARMS', alarms: payload });
  } catch (_) {}
}
