/**
 * Servicio centralizado de base de datos Firestore
 * Todas las operaciones de persistencia pasan por aquí para asegurar
 * que los datos se guarden correctamente en Firestore y no en localStorage
 */
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  doc,
  setDoc,
  updateDoc,
  getDocFromServer,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import type { Alarm, UserProfile } from '../types';
import { getUserTimezone } from '../utils/timezone';
import { withRetryOnIndexedDBClosed } from '../utils/persistenceHelper';

// ============================================================================
// ALARMAS
// ============================================================================

/**
 * Guarda una nueva alarma en Firestore usando addDoc
 * @param userId - UID del usuario que crea la alarma
 * @param alarmData - Datos de la alarma (sin id, se genera automáticamente)
 * @returns ID de la alarma creada
 */
export const saveAlarm = async (
  userId: string,
  alarmData: Omit<Alarm, 'id'>
): Promise<string> => {
  // Asegurar que el userId esté en los datos
  const alarmWithUser = {
    ...alarmData,
    createdBy: userId, // Siempre incluir el uid del usuario
    createdAt: Date.now(),
  };

  const docRef = await addDoc(collection(db, 'alarms'), alarmWithUser);
  return docRef.id;
};

/**
 * Guarda una alarma en un grupo específico
 * @param groupId - ID del grupo
 * @param userId - UID del usuario que crea la alarma
 * @param alarmData - Datos de la alarma
 * @returns ID de la alarma creada
 */
export const saveAlarmToGroup = async (
  groupId: string,
  userId: string,
  alarmData: Omit<Alarm, 'id'>
): Promise<string> => {
  const alarmWithUser = {
    ...alarmData,
    createdBy: userId,
    createdAt: Date.now(),
  };

  const docRef = await addDoc(
    collection(db, 'groups', groupId, 'alarms'),
    alarmWithUser
  );
  return docRef.id;
};

/**
 * Guarda una alarma personal del usuario (sin grupo)
 * @param userId - UID del usuario
 * @param alarmData - Datos de la alarma
 * @returns ID de la alarma creada
 */
export const saveAlarmToUser = async (
  userId: string,
  alarmData: Omit<Alarm, 'id'>
): Promise<string> => {
  // Asegurar que siempre incluya el userId del usuario autenticado
  const alarmWithUser = {
    ...alarmData,
    createdBy: userId, // Siempre usar el userId pasado como parámetro (fuente de verdad)
    createdAt: alarmData.createdAt || Date.now(), // Usar el createdAt existente o generar uno nuevo
  };

  const docRef = await addDoc(
    collection(db, 'users', userId, 'alarms'),
    alarmWithUser
  );
  return docRef.id;
};

/**
 * Carga todas las alarmas de un usuario usando getDocs con query filtrado
 * @param userId - UID del usuario
 * @returns Array de alarmas del usuario
 */
export const loadUserAlarms = async (userId: string): Promise<Alarm[]> => {
  return withRetryOnIndexedDBClosed(async () => {
    const q = query(
      collection(db, 'alarms'),
      where('createdBy', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Alarm[];
  });
};

/**
 * Carga las alarmas de un grupo usando getDocs
 * @param groupId - ID del grupo
 * @returns Array de alarmas del grupo
 */
export const loadGroupAlarms = async (groupId: string): Promise<Alarm[]> => {
  return withRetryOnIndexedDBClosed(async () => {
    const q = query(
      collection(db, 'groups', groupId, 'alarms'),
      orderBy('createdAt', 'desc')
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Alarm[];
  });
};

/**
 * Carga las alarmas personales de un usuario (subcolección)
 * @param userId - UID del usuario
 * @returns Array de alarmas personales
 */
/** Errores de red/Firestore no deben bloquear la app ni el audio; devolver [] en fallo. Reintento si IndexedDB se está cerrando. */
export const loadPersonalAlarms = async (userId: string): Promise<Alarm[]> => {
  try {
    return await withRetryOnIndexedDBClosed(async () => {
      const q = query(
        collection(db, 'users', userId, 'alarms'),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Alarm[];
    });
  } catch (e) {
    try {
      console.warn('[Firestore] loadPersonalAlarms:', (e as Error)?.message ?? e);
    } catch (_) {}
    return [];
  }
};

// ============================================================================
// GRUPOS
// ============================================================================

export interface GroupData {
  id: string;
  name: string;
  owner: string;
  members: string[];
  createdAt: number;
}

/**
 * Crea un nuevo grupo en Firestore usando addDoc
 * @param userId - UID del usuario que crea el grupo (será el owner)
 * @param groupName - Nombre del grupo
 * @returns ID y nombre del grupo creado
 */
export const createGroup = async (
  userId: string,
  groupName: string
): Promise<{ groupId: string; groupName: string }> => {
  // Generar ID único para el grupo
  const groupId = generateGroupId();
  const name = groupName.trim() || 'Mi Grupo';

  // Crear el grupo con addDoc (aunque usamos setDoc para tener control del ID)
  // Usamos setDoc porque necesitamos un ID específico generado
  const groupRef = doc(db, 'groups', groupId);
  await setDoc(groupRef, {
    name,
    owner: userId, // Siempre incluir el uid del usuario como owner
    members: [userId], // El creador es automáticamente miembro
    createdAt: Date.now(),
  });

  // Actualizar el perfil del usuario con el grupo
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, {
    groupId,
    groupName: name,
  });

  return { groupId, groupName: name };
};

/**
 * Genera un ID único para grupos (6 caracteres alfanuméricos)
 */
function generateGroupId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 6; i++) {
    id += chars[bytes[i]! % chars.length];
  }
  return id;
}

/**
 * Carga todos los grupos de un usuario usando getDocs con query filtrado
 * @param userId - UID del usuario
 * @returns Array de grupos donde el usuario es owner o miembro
 */
export const loadUserGroups = async (userId: string): Promise<GroupData[]> => {
  return withRetryOnIndexedDBClosed(async () => {
    const ownerQuery = query(
      collection(db, 'groups'),
      where('owner', '==', userId),
      orderBy('createdAt', 'desc')
    );
    const ownerSnapshot = await getDocs(ownerQuery);
    const ownerGroups = ownerSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as GroupData[];

    const memberQuery = query(
      collection(db, 'groups'),
      where('members', 'array-contains', userId),
      orderBy('createdAt', 'desc')
    );
    const memberSnapshot = await getDocs(memberQuery);
    const memberGroups = memberSnapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as GroupData))
      .filter((g) => g.owner !== userId);

    const allGroups = [...ownerGroups, ...memberGroups];
    allGroups.sort((a, b) => b.createdAt - a.createdAt);
    return allGroups;
  });
};

/**
 * Carga un grupo específico por ID
 * @param groupId - ID del grupo
 * @returns Datos del grupo o null si no existe
 */
export const loadGroup = async (
  groupId: string
): Promise<GroupData | null> => {
  return withRetryOnIndexedDBClosed(async () => {
    const groupRef = doc(db, 'groups', groupId.trim().toUpperCase());
    const groupSnap = await getDocFromServer(groupRef);
    if (!groupSnap.exists()) return null;
    return { id: groupSnap.id, ...groupSnap.data() } as GroupData;
  });
};

// ============================================================================
// USUARIOS
// ============================================================================

/**
 * Crea o actualiza el perfil de un usuario en Firestore
 * @param user - Objeto User de Firebase Auth
 * @param groupId - ID del grupo (opcional)
 * @param groupName - Nombre del grupo (opcional)
 * @returns Perfil del usuario
 */
export const createOrUpdateUserProfile = async (
  user: { uid: string; email: string | null; displayName: string | null; photoURL: string | null },
  groupId: string | null = null,
  groupName: string | null = null
): Promise<UserProfile> => {
  const userRef = doc(db, 'users', user.uid);
  
  // Detectar zona horaria del navegador
  const timezone = getUserTimezone();

  try {
    // Usar getDocFromServer para asegurar que leemos del servidor; reintento si IndexedDB se cierra
    const userSnap = await withRetryOnIndexedDBClosed(() => getDocFromServer(userRef));

    if (!userSnap.exists()) {
      // Crear nuevo perfil con timezone
      const newProfile: UserProfile = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        groupId,
        groupName,
        timezone, // Guardar zona horaria del usuario
      };
      await setDoc(userRef, newProfile);
      return newProfile;
    } else {
      // Actualizar perfil existente (actualizar timezone si cambió)
      const existingData = userSnap.data() as UserProfile;
      const updates: Partial<UserProfile> = {
        email: user.email ?? existingData.email,
        displayName: user.displayName ?? existingData.displayName,
        photoURL: user.photoURL ?? existingData.photoURL,
        groupId: groupId ?? existingData.groupId,
        groupName: groupName ?? existingData.groupName,
        timezone, // Actualizar timezone siempre (por si el usuario viajó)
      };
      await updateDoc(userRef, updates);
      return { ...existingData, ...updates } as UserProfile;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Solo considerar offline si realmente es un error de red
    const isOffline =
      /offline|unavailable|network|failed to fetch|networkerror/i.test(msg) &&
      !/permission|denied|unauthorized/i.test(msg);

    if (isOffline) {
      // Retornar perfil básico si está offline
      return {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
        groupId,
        groupName,
      };
    }
    throw e;
  }
};

/**
 * Carga el perfil de un usuario
 * @param userId - UID del usuario
 * @returns Perfil del usuario o null si no existe
 */
export const loadUserProfile = async (
  userId: string
): Promise<UserProfile | null> => {
  return withRetryOnIndexedDBClosed(async () => {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDocFromServer(userRef);
    if (!userSnap.exists()) return null;
    return userSnap.data() as UserProfile;
  });
};
