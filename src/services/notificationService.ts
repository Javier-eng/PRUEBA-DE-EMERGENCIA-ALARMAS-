import { getToken, onMessage } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';
import { db, messaging } from '../firebaseConfig';
import { auth } from '../firebaseConfig';

/** VAPID Key del proyecto alarmas-firebase (Firebase Console → Configuración → Cloud Messaging → Web push certificates). Debe coincidir con el proyecto. */
const VAPID_KEY = 'BHA6YsnhfuchHZfBH8zadc8Fr0l9SPRakuSd886aMnd69n0fx40TNubK3mnGDT1UBVgjknEbKFsEnxikg_QVpPc';

/**
 * Espera a que el Service Worker esté realmente en estado 'activated'.
 * Usa navigator.serviceWorker.ready y, si el SW está en 'activating', espera
 * (con delay o statechange) antes de continuar. Evita pedir getToken demasiado pronto en móvil.
 */
const waitForServiceWorkerActivated = async (maxWaitMs = 15000): Promise<boolean> => {
  if (!('serviceWorker' in navigator)) {
    return false;
  }

  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    try {
      // 1. Esperar a que haya un Service Worker "ready" (controlling la página)
      const registration = await navigator.serviceWorker.ready;
      const active = registration.active;

      if (!active) {
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }

      const state = active.state;

      if (state === 'activated') {
        return true;
      }

      if (state === 'activating') {
        // Esperar 1 segundo antes de comprobar de nuevo (móvil suele necesitar este tiempo)
        await new Promise((r) => setTimeout(r, 1000));
        if (active.state === 'activated') return true;
        // Si sigue en activating, esperar al evento statechange (máx. 2 s)
        const activated = await new Promise<boolean>((resolve) => {
          const t = setTimeout(() => resolve(active.state === 'activated'), 2000);
          active.addEventListener(
            'statechange',
            () => {
              if (active.state === 'activated') {
                clearTimeout(t);
                resolve(true);
              }
            },
            { once: true }
          );
        });
        if (activated) return true;
        continue;
      }

      // installing, waiting, etc.
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return false;
};

/**
 * Solicita permisos de notificación y guarda el FCM Token en Firestore.
 * Esta función se llama cada vez que el usuario entra/inicia sesión para asegurar
 * que el token esté actualizado y guardado en users/{userId}.fcmToken
 * 
 * @param userId - UID del usuario autenticado
 * @returns Token FCM o null si no se pudo obtener
 */
export const requestNotificationPermission = async (userId: string): Promise<string | null> => {
  if (!messaging) {
    console.warn('Firebase Messaging no está disponible. Verifica que todas las variables VITE_FIREBASE_* estén configuradas.');
    return null;
  }

  // Verificar que el usuario esté autenticado antes de solicitar el token
  const currentUser = auth.currentUser;
  if (!currentUser || currentUser.uid !== userId) {
    console.warn('Usuario no autenticado. Esperando autenticación antes de solicitar token FCM.');
    return null;
  }

  // Esperar a que el Service Worker esté en estado 'activated' (crítico en móvil: no pedir getToken en 'activating')
  const swReady = await waitForServiceWorkerActivated();
  if (!swReady) {
    console.warn('Service Worker no está listo. Reintentando en 2 segundos...');
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const swReadyRetry = await waitForServiceWorkerActivated();
    if (!swReadyRetry) {
      console.error('Service Worker no está disponible después de múltiples intentos.');
      console.error('En Android, asegúrate de que la app esté en HTTPS o localhost.');
      return null;
    }
  }

  // Confirmar que estamos usando el SW listo antes de pedir permiso ni getToken
  await navigator.serviceWorker.ready;
  console.info('Service Worker listo');

  // Pequeña espera adicional para asegurar que la autenticación esté estable
  await new Promise((resolve) => setTimeout(resolve, 300));

  try {
    // Verificar permisos de notificación (solo después de que el SW esté listo)
    if (!('Notification' in window)) {
      console.warn('Este navegador no soporta notificaciones.');
      return null;
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    
    if (permission !== 'granted') {
      console.info('Permisos de notificación denegados por el usuario.');
      console.info('En Android, ve a Configuración del navegador → Notificaciones para habilitarlas.');
      return null;
    }

    // Verificar nuevamente que el usuario sigue autenticado
    const userStillAuthenticated = auth.currentUser;
    if (!userStillAuthenticated || userStillAuthenticated.uid !== userId) {
      console.warn('Usuario ya no está autenticado. Cancelando solicitud de token FCM.');
      return null;
    }

    // Verificar nuevamente que el Service Worker sigue en estado 'activated' antes de getToken
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (!reg?.active || reg.active.state !== 'activated') {
      console.warn('Service Worker no está activated. Estado:', reg?.active?.state ?? 'sin SW');
      return null;
    }

    // Solicitar el token FCM (solo cuando el SW está activated)
    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      // Guardar/actualizar el token en Firestore cada vez que el usuario entra
      // Esto asegura que el token esté siempre actualizado para enviar notificaciones push
      try {
        await updateDoc(doc(db, 'users', userId), { 
          fcmToken: token,
          fcmTokenUpdatedAt: Date.now(), // Timestamp de cuándo se actualizó el token
        });
        console.info('✅ Token FCM obtenido y guardado en Firestore (users/' + userId + '/fcmToken)');
        console.info('📱 Este token permite recibir notificaciones push incluso con la pestaña cerrada.');
        return token;
      } catch (firestoreError) {
        console.error('Error al guardar token FCM en Firestore:', firestoreError);
        // Aún retornamos el token aunque falle el guardado
        return token;
      }
    } else {
      console.warn('No se pudo obtener el token FCM. Verifica la configuración del Service Worker.');
      console.warn('En Android, asegúrate de:');
      console.warn('1. La app está en HTTPS (o localhost en desarrollo)');
      console.warn('2. El Service Worker está registrado correctamente');
      console.warn('3. Los permisos de notificación están habilitados');
      return null;
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const isSwRegistration = /service worker|serviceworker|messaging\/failed/i.test(msg);
    const isConfigError = /Missing App configuration|projectId|installations/i.test(msg);
    const isAuthError = /authentication|credential|oauth|401|unauthorized/i.test(msg);

    // Escribir el error exacto en el banner (no se oculta hasta que lo cierres)
    if (typeof window !== 'undefined' && (window as Window & { __showSWBannerError?: (e: unknown) => void }).__showSWBannerError) {
      (window as Window & { __showSWBannerError: (e: unknown) => void }).__showSWBannerError(error);
    }

    if (isAuthError) {
      console.warn('Error de autenticación al obtener token FCM. El usuario puede no estar completamente autenticado.');
      console.warn('Esto es normal si acabas de iniciar sesión. El token se solicitará automáticamente cuando estés completamente autenticado.');
    } else if (isConfigError) {
      console.error('Error de configuración de Firebase:', msg);
      console.error('Asegúrate de que todas las variables VITE_FIREBASE_* estén configuradas en .env o en Vercel');
    } else if (isSwRegistration) {
      console.error('❌ Error de Service Worker:', msg);
      console.error('En Android, verifica:');
      console.error('1. La URL es HTTPS (requerido para Service Workers)');
      console.error('2. El archivo firebase-messaging-sw.js está en /public/');
      console.error('3. El Service Worker está registrado (revisa la consola)');
      console.error('4. Los permisos del navegador permiten notificaciones');
    } else {
      console.error('Error al obtener el token FCM:', error);
    }
  }
  return null;
};

/**
 * Maneja mensajes FCM cuando la app está en foreground (pestaña abierta).
 * También envía mensajes al Service Worker para manejar navegación desde notificaciones.
 */
export const onForegroundMessage = (callback?: (payload: any) => void): void => {
  if (!messaging) return;
  
  onMessage(messaging, (payload) => {
    console.log('[Foreground] Mensaje FCM recibido:', payload);
    
    // Si hay callback personalizado, llamarlo primero
    if (callback) {
      callback(payload);
    }
    
    // CRÍTICO: No modificar este bloque, asegura compatibilidad con Android.
    // Solo registration.showNotification(); NUNCA new Notification().
    const notif = payload.notification;
    if (notif && 'serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => {
          if (!reg.active || reg.active.state !== 'activated') return;
          return reg.showNotification(notif.title ?? 'MyDays', {
            body: notif.body,
            icon: '/vite.svg',
            badge: '/vite.svg',
            tag: payload.data?.type || 'notification',
            data: payload.data || {},
          });
        })
        .catch(() => {})
        .finally(() => {
          (window as unknown as { __clearBanner?: () => void }).__clearBanner?.();
        });
    }
  });
};
