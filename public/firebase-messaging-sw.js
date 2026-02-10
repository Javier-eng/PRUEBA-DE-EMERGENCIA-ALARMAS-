/* eslint-disable no-restricted-globals */
// =============================================================================
// MÓDULO ESTABLE — Service Worker Firebase (notificaciones en segundo plano)
// INDEPENDIENTE de Firestore/WebChannel: solo usa Messaging. Los micro-cortes
// de conexión (RPC Listen) no afectan a este SW ni al audio/notificación.
// No modificar la lógica de showNotification sin revisar compatibilidad Android.
// =============================================================================
// Service Worker para Firebase Cloud Messaging (notificaciones push).
// Las variables de entorno se inyectan en build time por vite-plugin-inject-env.js

importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.2/firebase-messaging-compat.js');

firebase.initializeApp({"apiKey":"","authDomain":"","projectId":"","storageBucket":"","messagingSenderId":"","appId":"","measurementId":""});

const messaging = firebase.messaging();

/**
 * INSTALL: Activar inmediatamente para evitar Cold Start en Android
 * skipWaiting() fuerza al SW a activarse sin esperar a que todas las pestañas se cierren
 */
self.addEventListener('install', function(event) {
  console.log('[SW] Install event - activando inmediatamente');
  self.skipWaiting(); // Activar sin esperar
});

/**
 * ACTIVATE: Tomar control inmediato de todas las pestañas
 * clients.claim() hace que el SW controle todas las pestañas desde el segundo 1
 */
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate event - tomando control de todas las pestañas');
  event.waitUntil(
    self.clients.claim().then(function() {
      console.log('[SW] Control tomado de todas las pestañas');
      return self.registration.update(); // Actualizar registro
    })
  );
});

/**
 * Background Message Handler (Módulo Estable)
 * Se ejecuta cuando llega un mensaje push mientras la app está en background o cerrada.
 * CRÍTICO: event.waitUntil envuelve todo el proceso para evitar que el SW se cierre
 * antes de completar la notificación (soluciona fallo alterno en Android).
 */
messaging.onBackgroundMessage(function (payload) {
  console.log('[Service Worker] Mensaje recibido en background:', payload);
  console.log('[Service Worker] payload.notification:', payload.notification);
  console.log('[Service Worker] payload.data:', payload.data);
  
  // Extraer título con múltiples fallbacks y sanitización
  let title = payload.notification?.title;
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    title = payload.data?.title;
  }
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    title = payload.data?.label; // Intentar desde label si title no está
  }
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    title = 'Nueva Alarma'; // Fallback final
  }
  // Sanitizar título: quitar espacios múltiples y limitar longitud
  title = title.trim().replace(/\s+/g, ' ').substring(0, 100);
  if (title.length === 0) title = 'Nueva Alarma';
  
  const body = payload.notification?.body ?? payload.data?.body ?? '';
  const data = payload.data || {};
  const notificationType = data.type || 'alarm';
  const groupId = data.groupId || ''; // Siempre presente (vacío para alarmas personales)
  
  console.log('[Service Worker] Título final sanitizado:', title);
  console.log('[Service Worker] Tipo de notificación:', notificationType);
  console.log('[Service Worker] GroupId:', groupId);
  
  // Determinar URL de navegación según el tipo
  let clickAction = '/';
  if (notificationType === 'join_request' && groupId) {
    clickAction = '/?groupId=' + groupId + '&pending=true';
  } else if (notificationType === 'group_alarm' && groupId) {
    clickAction = '/?groupId=' + groupId;
  } else if (notificationType === 'member_left' && groupId) {
    clickAction = '/?groupId=' + groupId;
  } else if (notificationType === 'personal_alarm') {
    clickAction = '/'; // Mis alarmas personales
  }
  
  // Configurar vibración según tipo (alarmas más intensas)
  const vibratePattern = (notificationType === 'personal_alarm' || notificationType === 'group_alarm')
    ? [200, 100, 200, 100, 200] // Patrón más largo para alarmas
    : [200, 100, 200]; // Patrón corto para otros eventos
  
  const options = {
    body: body,
    icon: '/vite.svg',
    badge: '/vite.svg',
    tag: data.alarmId || notificationType + (groupId ? '_' + groupId : '') || 'notification',
    requireInteraction: notificationType === 'personal_alarm' || notificationType === 'group_alarm', // Alarmas requieren interacción
    vibrate: vibratePattern,
    data: {
      type: notificationType,
      groupId: groupId || '', // Siempre presente (vacío si es personal)
      ...data,
      click_action: clickAction,
    },
    sound: 'default',
  };
  
  // CRÍTICO: event.waitUntil mantiene el SW activo hasta que la promesa se resuelva
  // Esto evita que Chrome suspenda el SW antes de mostrar la notificación (fallo alterno)
  return new Promise(function(resolve, reject) {
    // CRÍTICO: No modificar este bloque, asegura compatibilidad con Android.
    // Usar SIEMPRE self.registration.showNotification() (nunca new Notification()).
    try {
      const notificationPromise = self.registration.showNotification(title, options);
      // Resolver cuando la notificación se muestre correctamente
      notificationPromise.then(function() {
        console.log('[Service Worker] Notificación mostrada correctamente');
        resolve();
      }).catch(function(err) {
        console.error('[Service Worker] Error al mostrar notificación:', err);
        // Fallback: intentar con título por defecto si el personalizado falla
        try {
          const fallbackOptions = { ...options };
          fallbackOptions.data = { ...fallbackOptions.data, originalTitle: title };
          self.registration.showNotification('Nueva Alarma', fallbackOptions)
            .then(function() {
              console.log('[Service Worker] Notificación fallback mostrada');
              resolve();
            })
            .catch(function(fallbackErr) {
              console.error('[Service Worker] Error en fallback:', fallbackErr);
              // Último recurso: notificación mínima
              self.registration.showNotification('Alarma', {
                body: body || 'Tienes una alarma',
                icon: '/vite.svg',
                tag: 'alarm_fallback',
              }).then(function() {
                console.log('[Service Worker] Notificación mínima mostrada');
                resolve();
              }).catch(function(minErr) {
                console.error('[Service Worker] Error en notificación mínima:', minErr);
                reject(minErr);
              });
            });
        } catch (fallbackErr) {
          console.error('[Service Worker] Error crítico en fallback:', fallbackErr);
          reject(fallbackErr);
        }
      });
    } catch (err) {
      console.error('[Service Worker] Error crítico al mostrar notificación:', err);
      reject(err);
    }
  });
});

/**
 * Manejar clics en notificaciones
 * Cuando el usuario hace clic en una notificación, abre la app y navega a la sección relevante.
 */
self.addEventListener('notificationclick', function (event) {
  console.log('[Service Worker] Notificación clickeada:', event.notification.data);
  
  event.notification.close();
  
  const data = event.notification.data || {};
  const url = data.click_action || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Si ya hay una ventana abierta, enfocarla y navegar según el tipo
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === url || client.url.startsWith(self.location.origin)) {
          return client.focus().then(() => {
            const type = data.type || '';
            const groupId = data.groupId || '';
            if (type === 'join_request' && groupId) {
              client.postMessage({
                type: 'navigate',
                groupId: groupId,
                action: 'show_pending',
              });
            } else if (type === 'group_alarm' && groupId) {
              client.postMessage({
                type: 'navigate',
                groupId: groupId,
                action: 'show_group',
              });
            } else if (type === 'member_left' && groupId) {
              client.postMessage({
                type: 'navigate',
                groupId: groupId,
                action: 'show_group',
              });
            } else if (type === 'personal_alarm') {
              client.postMessage({
                type: 'navigate',
                action: 'show_personal',
              });
            }
          });
        }
      }
      // Si no hay ventana abierta, abrir una nueva
      return clients.openWindow(url);
    })
  );
});

/** Cache de alarmas enviado por la app para prioridad de notificación aunque falle el stream Listen */
var cachedAlarms = [];

/**
 * Manejar cuando se recibe un mensaje mientras la app está en foreground
 * También maneja keep-alive pings para mantener el SW activo
 */
self.addEventListener('message', function (event) {
  var data = event.data;
  if (!data) return;
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }
  if (data.type === 'CACHE_ALARMS' && Array.isArray(data.alarms)) {
    cachedAlarms = data.alarms;
  }
  // Keep-alive ping: responder inmediatamente para mantener el SW activo
  if (data.type === 'KEEP_ALIVE') {
    console.log('[SW] Keep-alive ping recibido');
    event.ports[0]?.postMessage({ type: 'KEEP_ALIVE_ACK', timestamp: Date.now() });
    return;
  }
});
