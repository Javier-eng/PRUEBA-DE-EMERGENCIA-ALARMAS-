import {
  collection,
  query,
  onSnapshot,
  deleteDoc,
  doc,
  updateDoc,
  setDoc,
  addDoc,
  getDocFromServer,
  where,
  arrayUnion,
  arrayRemove,
  orderBy,
} from 'firebase/firestore';
import { db } from '../firebaseConfig';
import { createGroup as createGroupInDb } from './databaseService';
import { withRetryOnIndexedDBClosed } from '../utils/persistenceHelper';

export type GroupInfo = { id: string; name: string; owner: string; createdAt: number };

export const createGroup = async (
  userId: string,
  groupName?: string
): Promise<{ groupId: string; groupName: string }> => {
  const name = (groupName ?? 'Mi Grupo').trim() || 'Mi Grupo';
  return createGroupInDb(userId, name);
};

/** Solicitar unirse a un grupo. El usuario queda en estado 'pending' hasta que el admin acepte. */
export const joinGroupRequest = async (
  userId: string,
  groupId: string,
  displayName: string | null,
  photoURL: string | null
): Promise<{ groupName: string }> => {
  const id = groupId.trim().toUpperCase();
  const groupRef = doc(db, 'groups', id);
  let groupSnap;
  try {
    groupSnap = await getDocFromServer(groupRef);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Solo considerar offline si realmente es un error de red (no permisos u otros)
    const isOffline = /offline|unavailable|network|connection|failed to fetch|networkerror/i.test(msg)
      && !/permission|denied|unauthorized/i.test(msg);
    if (isOffline) {
      throw new Error('Sin conexión. Comprueba tu internet e inténtalo de nuevo.');
    }
    throw e;
  }
  if (!groupSnap.exists()) {
    throw new Error('No existe ningún grupo con ese ID. Comprueba el código e inténtalo de nuevo.');
  }
  const data = groupSnap.data();
  const members = (data?.members as string[] | undefined) ?? [];
  if (members.includes(userId)) {
    throw new Error('Ya eres miembro de este grupo.');
  }
  const groupName = (data?.name as string) ?? 'Mi Grupo';
  const pendingRef = doc(db, 'groups', id, 'pending', userId);
  await setDoc(pendingRef, {
    displayName: displayName ?? 'Usuario',
    photoURL: photoURL ?? null,
    requestedAt: Date.now(),
  });
  await updateDoc(doc(db, 'users', userId), { groupId: id, groupName });
  return { groupName };
};

export type PendingRequest = {
  userId: string;
  displayName: string;
  photoURL: string | null;
  requestedAt: number;
};

export const subscribeToPendingRequests = (
  groupId: string,
  callback: (requests: PendingRequest[]) => void
) => {
  const q = query(
    collection(db, 'groups', groupId, 'pending'),
    orderBy('requestedAt', 'asc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      try {
        const requests = snapshot.docs.map((d) => ({
          userId: d.id,
          displayName: (d.data().displayName as string) ?? 'Usuario',
          photoURL: (d.data().photoURL as string) ?? null,
          requestedAt: (d.data().requestedAt as number) ?? 0,
        }));
        callback(requests);
      } catch (e) {
        try { console.warn('[Firestore] subscribeToPendingRequests next:', (e as Error)?.message); } catch (_) {}
        callback([]);
      }
    },
    (err) => {
      try {
        console.warn('[Firestore] Listen error:', (err as Error)?.message ?? err);
        callback([]);
      } catch (_) {}
    }
  );
};

/** Aceptar a un usuario en el grupo. Solo el owner puede. */
export const acceptMember = async (
  adminUserId: string,
  groupId: string,
  userId: string
): Promise<void> => {
  const id = groupId.trim().toUpperCase();
  const groupRef = doc(db, 'groups', id);
  // Usar getDocFromServer para asegurar que leemos del servidor (no caché local)
  const groupSnap = await getDocFromServer(groupRef);
  if (!groupSnap.exists()) throw new Error('El grupo no existe.');
  const data = groupSnap.data();
  if ((data?.owner as string) !== adminUserId) {
    throw new Error('Solo el administrador del grupo puede aceptar solicitudes.');
  }
  await updateDoc(groupRef, { members: arrayUnion(userId) });
  const pendingRef = doc(db, 'groups', id, 'pending', userId);
  await deleteDoc(pendingRef);
};

/** Rechazar una solicitud. Solo el owner puede. Borra pending; el usuario debe limpiar su grupo al detectarlo. */
export const rejectMember = async (
  adminUserId: string,
  groupId: string,
  userId: string
): Promise<void> => {
  const id = groupId.trim().toUpperCase();
  const groupRef = doc(db, 'groups', id);
  // Usar getDocFromServer para asegurar que leemos del servidor (no caché local)
  const groupSnap = await getDocFromServer(groupRef);
  if (!groupSnap.exists()) throw new Error('El grupo no existe.');
  const data = groupSnap.data();
  if ((data?.owner as string) !== adminUserId) {
    throw new Error('Solo el administrador del grupo puede rechazar solicitudes.');
  }
  const pendingRef = doc(db, 'groups', id, 'pending', userId);
  await deleteDoc(pendingRef);
  // El usuario detectará en su cliente que ya no está en pending y limpiará su grupo con clearMyGroup.
}

/** Limpiar el grupo del usuario (ej. tras ser rechazado). Solo actualiza su propio documento. */
export const clearMyGroup = async (userId: string): Promise<void> => {
  await updateDoc(doc(db, 'users', userId), { groupId: null, groupName: null });
};

export type GroupData = {
  name: string;
  owner: string;
  members: string[];
};

/** Obtener members del grupo (para comprobar si el usuario sigue en el grupo cuando deja de estar pendiente). Reintento si IndexedDB se cierra. */
export const getGroupMembers = async (groupId: string): Promise<string[] | null> => {
  try {
    return await withRetryOnIndexedDBClosed(async () => {
      const id = groupId.trim().toUpperCase();
      const groupRef = doc(db, 'groups', id);
      const snap = await getDocFromServer(groupRef);
      if (!snap.exists()) return null;
      return (snap.data()?.members as string[]) ?? null;
    });
  } catch {
    return null;
  }
};

export const subscribeToGroup = (
  groupId: string,
  callback: (data: GroupData | null) => void
) => {
  const groupRef = doc(db, 'groups', groupId.trim().toUpperCase());
  return onSnapshot(
    groupRef,
    (snap) => {
      try {
        if (!snap.exists()) {
          callback(null);
          return;
        }
        const d = snap.data();
        callback({
          name: (d?.name as string) ?? 'Mi Grupo',
          owner: (d?.owner as string) ?? '',
          members: (d?.members as string[]) ?? [],
        });
      } catch (e) {
        try { console.warn('[Firestore] subscribeToGroup next:', (e as Error)?.message); } catch (_) {}
        callback(null);
      }
    },
    (err) => {
      try {
        console.warn('[Firestore] Listen error:', (err as Error)?.message ?? err);
        callback(null);
      } catch (_) {}
    }
  );
};

/** Suscripción al estado de solicitud del usuario en un grupo (si tiene doc en pending). */
export const subscribeToMyPendingStatus = (
  groupId: string,
  userId: string,
  callback: (isPending: boolean) => void
) => {
  const pendingRef = doc(db, 'groups', groupId.trim().toUpperCase(), 'pending', userId);
  return onSnapshot(
    pendingRef,
    (snap) => {
      try {
        callback(snap.exists());
      } catch (e) {
        try { console.warn('[Firestore] subscribeToMyPendingStatus next:', (e as Error)?.message); } catch (_) {}
        callback(false);
      }
    },
    (err) => {
      try {
        console.warn('[Firestore] Listen error:', (err as Error)?.message ?? err);
        callback(false);
      } catch (_) {}
    }
  );
};

/** Grupos donde el usuario es owner o miembro (varios grupos permitidos). Usa dos mapas para que, al eliminar un grupo, desaparezca en tiempo real para todos. */
export const subscribeToMyGroups = (userId: string, callback: (groups: GroupInfo[]) => void) => {
  const fromOwner = new Map<string, GroupInfo>();
  const fromMember = new Map<string, GroupInfo>();

  const mergeAndEmit = () => {
    const byId = new Map<string, GroupInfo>([...fromOwner, ...fromMember]);
    const groups = Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
    callback(groups);
  };

  const onListenError = (err: unknown) => {
    try {
      console.warn('[Firestore] Listen error (grupos), manteniendo datos:', (err as Error)?.message ?? err);
    } catch (_) {}
  };

  const unsubOwner = onSnapshot(
    query(collection(db, 'groups'), where('owner', '==', userId)),
    (snapshot) => {
      try {
        fromOwner.clear();
        snapshot.docs.forEach((d) => {
          fromOwner.set(d.id, {
            id: d.id,
            name: (d.data().name as string) ?? 'Mi Grupo',
            owner: d.data().owner as string,
            createdAt: (d.data().createdAt as number) ?? 0,
          });
        });
        mergeAndEmit();
      } catch (e) {
        try { console.warn('[Firestore] subscribeToMyGroups owner next:', (e as Error)?.message); } catch (_) {}
      }
    },
    onListenError
  );

  const unsubMember = onSnapshot(
    query(collection(db, 'groups'), where('members', 'array-contains', userId)),
    (snapshot) => {
      try {
        fromMember.clear();
        snapshot.docs.forEach((d) => {
          fromMember.set(d.id, {
            id: d.id,
            name: (d.data().name as string) ?? 'Mi Grupo',
            owner: d.data().owner as string,
            createdAt: (d.data().createdAt as number) ?? 0,
          });
        });
        mergeAndEmit();
      } catch (e) {
        try { console.warn('[Firestore] subscribeToMyGroups member next:', (e as Error)?.message); } catch (_) {}
      }
    },
    onListenError
  );

  return () => {
    unsubOwner();
    unsubMember();
  };
};

/** Solo el administrador puede eliminar el grupo (borrado total). */
export const deleteGroup = async (userId: string, groupId: string): Promise<void> => {
  const id = groupId.trim().toUpperCase();
  const groupRef = doc(db, 'groups', id);
  const groupSnap = await getDocFromServer(groupRef);
  if (!groupSnap.exists()) throw new Error('El grupo ya no existe.');
  const data = groupSnap.data();
  if ((data?.owner as string) !== userId) {
    throw new Error('Solo el administrador del grupo puede eliminarlo.');
  }
  await deleteDoc(groupRef);
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDocFromServer(userRef);
  if (userSnap.exists() && (userSnap.data()?.groupId === id)) {
    await updateDoc(userRef, { groupId: null, groupName: null });
  }
};

/**
 * Salir del grupo (solo miembros; el admin debe usar Eliminar grupo).
 * Quita al usuario de members, actualiza su perfil y crea un aviso para el administrador.
 */
export const leaveGroup = async (
  userId: string,
  groupId: string,
  displayName: string | null
): Promise<void> => {
  const id = groupId.trim().toUpperCase();
  const groupRef = doc(db, 'groups', id);
  const groupSnap = await getDocFromServer(groupRef);
  if (!groupSnap.exists()) throw new Error('El grupo no existe.');
  const data = groupSnap.data();
  const owner = (data?.owner as string) ?? '';
  const members = (data?.members as string[]) ?? [];
  const groupName = (data?.name as string) ?? 'Mi Grupo';
  if (owner === userId) {
    throw new Error('El administrador no puede "salir"; use Eliminar grupo.');
  }
  if (!members.includes(userId)) {
    throw new Error('No eres miembro de este grupo.');
  }
  await updateDoc(groupRef, { members: arrayRemove(userId) });
  const userRef = doc(db, 'users', userId);
  await updateDoc(userRef, { groupId: null, groupName: null });
  const activityRef = collection(db, 'groups', id, 'activity');
  await addDoc(activityRef, {
    type: 'member_left',
    userId,
    displayName: displayName ?? 'Un usuario',
    groupName,
    at: Date.now(),
    message: `El usuario ${displayName ?? 'Un usuario'} ha abandonado el grupo ${groupName}.`,
  });
};

/** Elemento de la subcolección activity (avisos para el admin, p. ej. miembro salió). */
export type GroupActivityItem = {
  id: string;
  type: string;
  message: string;
  at: number;
  userId?: string;
  displayName?: string;
  groupName?: string;
};

/** Suscripción en tiempo real a la actividad del grupo (avisos para el admin). No interfiere con notificaciones push. */
export const subscribeToGroupActivity = (
  groupId: string,
  callback: (items: GroupActivityItem[]) => void
) => {
  const q = query(
    collection(db, 'groups', groupId, 'activity'),
    orderBy('at', 'desc')
  );
  return onSnapshot(
    q,
    (snapshot) => {
      try {
        const items: GroupActivityItem[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            type: (data.type as string) ?? '',
            message: (data.message as string) ?? '',
            at: (data.at as number) ?? 0,
            userId: data.userId as string | undefined,
            displayName: data.displayName as string | undefined,
            groupName: data.groupName as string | undefined,
          };
        });
        callback(items);
      } catch (e) {
        try { console.warn('[Firestore] subscribeToGroupActivity next:', (e as Error)?.message); } catch (_) {}
        callback([]);
      }
    },
    (err) => {
      try { console.warn('[Firestore] subscribeToGroupActivity error:', (err as Error)?.message ?? err); } catch (_) {}
      callback([]);
    }
  );
};

/** Eliminar un aviso de la actividad del grupo. Solo el administrador (owner) puede. */
export const deleteGroupActivityItem = async (groupId: string, activityId: string): Promise<void> => {
  const ref = doc(db, 'groups', groupId.trim().toUpperCase(), 'activity', activityId);
  await deleteDoc(ref);
};
