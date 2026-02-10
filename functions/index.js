/**
 * Cloud Functions para MyDays
 *
 * - notifyAdminOnJoinRequest: cuando un usuario solicita unirse a un grupo
 * - notifyOnPersonalAlarm: cuando se crea una alarma personal (users/{userId}/alarms/{alarmId})
 * - notifyOnGroupAlarm: cuando se crea una alarma de grupo (groups/{groupId}/alarms/{alarmId}) → todos los miembros
 * - notifyAdminOnMemberLeft: cuando alguien sale de un grupo (groups/{groupId}/activity/{activityId} con type='member_left')
 *
 * Todas las notificaciones tienen priority: "high" y payload con groupId y tipo para que funcionen con la app cerrada.
 */

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { initializeApp } from "firebase-admin/app";

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

/** Helper: enviar notificación FCM con prioridad alta y payload estándar (groupId + tipo) */
async function sendHighPriorityNotification(
  fcmToken,
  title,
  body,
  data = {}
) {
  if (!fcmToken) return;
  
  // Log: verificar que title es un string válido antes de construir el mensaje
  console.log("[CF sendHighPriorityNotification] Título recibido:", title, "Tipo:", typeof title);
  console.log("[CF sendHighPriorityNotification] Body recibido:", body, "Tipo:", typeof body);
  
  // Asegurar que title es string y no está vacío
  const safeTitle = typeof title === "string" && title.trim().length > 0 
    ? title.trim() 
    : "Nueva Alarma";
  const safeBody = typeof body === "string" ? body : String(body || "");
  
  console.log("[CF sendHighPriorityNotification] Título seguro:", safeTitle);
  
  const message = {
    notification: { 
      title: safeTitle, // Asegurar que siempre es string válido
      body: safeBody 
    },
    data: {
      ...data,
      type: data.type || "alarm",
      groupId: data.groupId || "",
      title: safeTitle, // También en data por si acaso
      label: data.label || safeTitle, // Asegurar que label está presente
    },
    token: fcmToken,
    android: {
      priority: "high",
      ttl: 0, // timeToLive: 0 = entrega inmediata sin retrasos (crítico para evitar fallo alterno)
      notification: {
        title,
        body,
        channelId: data.channelId || "alarms",
        sound: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: 1,
          "content-available": 1,
        },
      },
    },
  };
    // Log final: mensaje completo que se envía a FCM
    console.log("[CF sendHighPriorityNotification] Mensaje FCM completo:", JSON.stringify({
      notification: message.notification,
      data: message.data,
      token: message.token ? message.token.substring(0, 20) + "..." : "null",
    }, null, 2));
    
    try {
      await messaging.send(message);
      console.log("[CF sendHighPriorityNotification] Notificación enviada exitosamente");
    } catch (err) {
    if (
      err.code === "messaging/invalid-registration-token" ||
      err.code === "messaging/registration-token-not-registered"
    ) {
      console.log("Token inválido, limpiando:", fcmToken.substring(0, 20));
      const userId = data.userId;
      if (userId) {
        await db.doc(`users/${userId}`).update({ fcmToken: null });
      }
    } else {
      console.error("Error enviando push:", err.message);
    }
  }
}

/** Helper: obtener tokens FCM de una lista de userIds */
async function getFCMTokens(userIds) {
  const tokens = [];
  const userRefs = userIds.map((uid) => db.doc(`users/${uid}`));
  const snaps = await Promise.all(userRefs.map((ref) => ref.get()));
  for (const snap of snaps) {
    if (snap.exists) {
      const token = snap.data()?.fcmToken;
      if (token) tokens.push({ userId: snap.id, token });
    }
  }
  return tokens;
}

/** Helper: sanitizar label de alarma (limpiar espacios, limitar longitud, asegurar fallback) */
function sanitizeAlarmLabel(label) {
  const MAX_LENGTH = 100;
  const DEFAULT = "Nueva Alarma";
  if (!label || typeof label !== "string") return DEFAULT;
  let sanitized = label.trim().replace(/\s+/g, " ");
  if (sanitized.length > MAX_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LENGTH - 3) + "...";
  }
  return sanitized || DEFAULT;
}

/**
 * Al crear un documento en groups/{groupId}/pending/{userId}, notificar al owner del grupo.
 * El owner recibe un push para poder aprobar la solicitud desde el móvil.
 */
export const notifyAdminOnJoinRequest = onDocumentCreated(
  {
    document: "groups/{groupId}/pending/{userId}",
    region: "europe-west1",
  },
  async (event) => {
    const { groupId, userId } = event.params;
    const snap = event.data;
    if (!snap || !snap.exists) return;

    const pendingData = snap.data();
    const displayName = pendingData.displayName || "Alguien";

    // Obtener el grupo para saber el owner
    const groupRef = db.doc(`groups/${groupId}`);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) return;

    const ownerId = groupSnap.data()?.owner;
    const groupName = groupSnap.data()?.name || "Mi Grupo";
    if (!ownerId) return;

    // Obtener el FCM token del administrador
    const userRef = db.doc(`users/${ownerId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;

    const fcmToken = userSnap.data()?.fcmToken;
    if (!fcmToken) {
      console.log("Admin no tiene FCM token, no se envía push:", ownerId);
      return;
    }

    await sendHighPriorityNotification(
      fcmToken,
      "Nueva solicitud de unión",
      `${displayName} quiere unirse a "${groupName}". Abre la app para aprobar o rechazar.`,
      {
        type: "join_request",
        groupId,
        groupName,
        userId: ownerId, // userId del destinatario (admin) para limpiar token si es inválido
        requesterId: userId, // userId del que solicita
        displayName,
        channelId: "join_requests",
      }
    );
    console.log("Push enviado al admin:", ownerId, "por solicitud de", userId);
  }
);

/**
 * Alarma personal creada: notificar al usuario propietario (aunque la app esté cerrada).
 * Payload incluye groupId: "" (vacío) y type: "personal_alarm".
 */
export const notifyOnPersonalAlarm = onDocumentCreated(
  {
    document: "users/{userId}/alarms/{alarmId}",
    region: "europe-west1",
  },
  async (event) => {
    const { userId, alarmId } = event.params;
    const snap = event.data;
    if (!snap || !snap.exists) return;

    const alarmData = snap.data();
    if (!alarmData.active) return; // Solo alarmas activas

    // Log comparativo: qué datos llegan desde Firestore
    console.log("[CF notifyOnPersonalAlarm] ===== DATOS DESDE FIRESTORE =====");
    console.log("[CF notifyOnPersonalAlarm] Datos completos:", JSON.stringify(alarmData, null, 2));
    console.log("[CF notifyOnPersonalAlarm] Estructura del objeto:", {
      tieneLabel: "label" in alarmData,
      tieneDatetimeUTC: "datetimeUTC" in alarmData,
      tieneTime: "time" in alarmData,
      tieneDate: "date" in alarmData,
      tieneActive: "active" in alarmData,
      tieneCreatedBy: "createdBy" in alarmData,
    });
    console.log("[CF notifyOnPersonalAlarm] alarmData.label:", alarmData.label, "Tipo:", typeof alarmData.label, "Es string?", typeof alarmData.label === "string");
    console.log("[CF notifyOnPersonalAlarm] Keys del objeto:", Object.keys(alarmData));

    const userRef = db.doc(`users/${userId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;

    const fcmToken = userSnap.data()?.fcmToken;
    if (!fcmToken) return;

    // Validar que label existe y es string antes de sanitizar
    const rawLabelFromFirestore = alarmData.label;
    console.log("[CF notifyOnPersonalAlarm] Label crudo desde Firestore:", rawLabelFromFirestore, "Tipo:", typeof rawLabelFromFirestore);
    
    const label = sanitizeAlarmLabel(rawLabelFromFirestore); // Sanitizado: limpia espacios, limita longitud, asegura fallback
    console.log("[CF notifyOnPersonalAlarm] Label después de sanitizar:", label, "Tipo:", typeof label);
    
    const datetimeUTC = alarmData.datetimeUTC;
    let dateStr = "";
    let timeStr = "";
    if (datetimeUTC) {
      const d = new Date(datetimeUTC);
      dateStr = d.toLocaleDateString("es-ES", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      timeStr = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    } else {
      dateStr = alarmData.date || "";
      timeStr = alarmData.time || "";
    }

    const notificationBody = `${dateStr} a las ${timeStr}`;
    console.log("[CF notifyOnPersonalAlarm] Preparando notificación con título:", label, "Body:", notificationBody);
    
    await sendHighPriorityNotification(
      fcmToken,
      label, // Título de la notificación (debe ser string)
      notificationBody,
      {
        type: "personal_alarm",
        groupId: "", // Vacío para alarmas personales
        alarmId,
        userId,
        label: String(label || "Nueva Alarma"), // Asegurar que label en data también es string
        datetimeUTC: datetimeUTC || "",
        date: dateStr,
        time: timeStr,
        channelId: "personal_alarms",
      }
    );
    console.log("[CF notifyOnPersonalAlarm] Notificación de alarma personal enviada a:", userId);
  }
);

/**
 * Alarma de grupo creada: notificar a TODOS los miembros del grupo (app cerrada o abierta).
 * Payload incluye groupId y type: "group_alarm".
 */
export const notifyOnGroupAlarm = onDocumentCreated(
  {
    document: "groups/{groupId}/alarms/{alarmId}",
    region: "europe-west1",
  },
  async (event) => {
    const { groupId, alarmId } = event.params;
    const snap = event.data;
    if (!snap || !snap.exists) return;

    const alarmData = snap.data();
    if (!alarmData.active) return;

    // Log comparativo: qué datos llegan desde Firestore
    console.log("[CF notifyOnGroupAlarm] Datos completos de Firestore:", JSON.stringify(alarmData, null, 2));
    console.log("[CF notifyOnGroupAlarm] alarmData.label:", alarmData.label, "Tipo:", typeof alarmData.label);
    console.log("[CF notifyOnGroupAlarm] alarmData tiene label?", "label" in alarmData);

    // Obtener el grupo para saber los miembros
    const groupRef = db.doc(`groups/${groupId}`);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) return;

    const members = groupSnap.data()?.members || [];
    const owner = groupSnap.data()?.owner || "";
    const groupName = groupSnap.data()?.name || "Mi Grupo";
    const allUserIds = [...new Set([owner, ...members])].filter(Boolean);

    if (allUserIds.length === 0) return;

    // Validar que label existe y es string antes de sanitizar
    const rawLabelFromFirestore = alarmData.label;
    console.log("[CF notifyOnGroupAlarm] Label crudo desde Firestore:", rawLabelFromFirestore, "Tipo:", typeof rawLabelFromFirestore);
    
    const label = sanitizeAlarmLabel(rawLabelFromFirestore); // Sanitizado: limpia espacios, limita longitud, asegura fallback
    console.log("[CF notifyOnGroupAlarm] Label después de sanitizar:", label, "Tipo:", typeof label);
    const datetimeUTC = alarmData.datetimeUTC;
    let dateStr = "";
    let timeStr = "";
    if (datetimeUTC) {
      const d = new Date(datetimeUTC);
      dateStr = d.toLocaleDateString("es-ES", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      timeStr = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
    } else {
      dateStr = alarmData.date || "";
      timeStr = alarmData.time || "";
    }

    // Obtener tokens FCM de todos los miembros
    const tokens = await getFCMTokens(allUserIds);

    // Enviar a todos los miembros del grupo
    const notificationTitle = `${label} - ${groupName}`;
    const notificationBody = `${dateStr} a las ${timeStr}`;
    console.log("[CF notifyOnGroupAlarm] Preparando notificaciones con título:", notificationTitle, "Body:", notificationBody);
    
    const promises = tokens.map(({ userId, token }) =>
      sendHighPriorityNotification(
        token,
        notificationTitle, // Título de la notificación (debe ser string)
        notificationBody,
        {
          type: "group_alarm",
          groupId,
          groupName,
          alarmId,
          userId,
          label: String(label || "Nueva Alarma"), // Asegurar que label en data también es string
          datetimeUTC: datetimeUTC || "",
          date: dateStr,
          time: timeStr,
          channelId: "group_alarms",
        }
      )
    );

    await Promise.allSettled(promises);
    console.log(`Notificaciones de alarma de grupo enviadas a ${tokens.length} miembros de ${groupId}`);
  }
);

/**
 * Miembro sale del grupo: notificar al administrador (groups/{groupId}/activity/{activityId} con type='member_left').
 * Payload incluye groupId y type: "member_left".
 */
export const notifyAdminOnMemberLeft = onDocumentCreated(
  {
    document: "groups/{groupId}/activity/{activityId}",
    region: "europe-west1",
  },
  async (event) => {
    const { groupId } = event.params;
    const snap = event.data;
    if (!snap || !snap.exists) return;

    const activityData = snap.data();
    if (activityData.type !== "member_left") return; // Solo eventos de salida

    // Obtener el grupo para saber el owner
    const groupRef = db.doc(`groups/${groupId}`);
    const groupSnap = await groupRef.get();
    if (!groupSnap.exists) return;

    const ownerId = groupSnap.data()?.owner;
    const groupName = groupSnap.data()?.name || "Mi Grupo";
    if (!ownerId) return;

    const userRef = db.doc(`users/${ownerId}`);
    const userSnap = await userRef.get();
    if (!userSnap.exists) return;

    const fcmToken = userSnap.data()?.fcmToken;
    if (!fcmToken) return;

    const displayName = activityData.displayName || "Un usuario";
    const message = activityData.message || `${displayName} ha abandonado el grupo ${groupName}.`;

    await sendHighPriorityNotification(
      fcmToken,
      "Miembro abandonó el grupo",
      message,
      {
        type: "member_left",
        groupId,
        groupName,
        userId: ownerId, // userId del destinatario (admin) para limpiar token si es inválido
        leftUserId: activityData.userId || "", // userId del que salió
        displayName,
        channelId: "group_activity",
      }
    );
    console.log("Notificación de abandono enviada al admin:", ownerId);
  }
);
