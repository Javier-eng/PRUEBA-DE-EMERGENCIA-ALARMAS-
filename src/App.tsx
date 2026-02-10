import React, { useState, useEffect, useRef } from 'react';
import type { Alarm } from './types';
import { useAuth } from './contexts/AuthContext';
import {
  subscribeToGroupAlarms,
  subscribeToUserAlarms,
  addAlarmToGroup,
  addAlarmToUser,
  toggleAlarm,
  toggleUserAlarm,
  deleteAlarm,
  deleteUserAlarm,
} from './services/alarmService';
import {
  createGroup,
  joinGroupRequest,
  deleteGroup,
  leaveGroup,
  subscribeToMyGroups,
  subscribeToGroup,
  subscribeToGroupActivity,
  deleteGroupActivityItem,
  subscribeToMyPendingStatus,
  subscribeToPendingRequests,
  acceptMember,
  rejectMember,
  clearMyGroup,
  getGroupMembers,
} from './services/groupService';
import type { GroupInfo, PendingRequest, GroupActivityItem } from './services/groupService';
import { loadPersonalAlarms } from './services/databaseService';
import { utcToLocal, localToUTC } from './utils/timezone';
import { sanitizeAlarmLabel } from './utils/sanitizeAlarmLabel';
import { syncAlarmsToServiceWorker } from './utils/syncAlarmsToSW';
import GroupSection, { type ConfirmGroupAction } from './components/GroupSection';
import AlarmForm from './components/AlarmForm';
import AlarmList from './components/AlarmList';
const LAST_VIEW_KEY = 'alarmas-app-last-view';

const App: React.FC = () => {
  const { user, profile, loading, loginError, login, logout, setProfile, clearLoginError } = useAuth();
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [newGroupInput, setNewGroupInput] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [loginInProgress, setLoginInProgress] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [createNameError, setCreateNameError] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [savingAlarm, setSavingAlarm] = useState(false);
  const [alarmError, setAlarmError] = useState<string | null>(null);
  const [justCreatedGroupId, setJustCreatedGroupId] = useState<string | null>(null);
  const [ventanaGroup, setVentanaGroup] = useState<{ id: string; name: string } | null>(null);
  const lastViewRestoredRef = useRef(false);
  const [myGroups, setMyGroups] = useState<GroupInfo[]>([]);
  const [confirmGroupAction, setConfirmGroupAction] = useState<ConfirmGroupAction>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [leavingGroupId, setLeavingGroupId] = useState<string | null>(null);
  const [groupData, setGroupData] = useState<{ members: string[]; owner: string } | null>(null);
  const [isPendingInGroup, setIsPendingInGroup] = useState<boolean | null>(null);
  const [pendingByGroupId, setPendingByGroupId] = useState<Record<string, PendingRequest[]>>({});
  const [activityByGroupId, setActivityByGroupId] = useState<Record<string, GroupActivityItem[]>>({});
  const [deletingActivityId, setDeletingActivityId] = useState<string | null>(null);
  const [acceptingUserId, setAcceptingUserId] = useState<string | null>(null);
  const [rejectingUserId, setRejectingUserId] = useState<string | null>(null);

  useEffect(() => {
    if (user?.uid) {
      const unsub = subscribeToMyGroups(user.uid, setMyGroups);
      return () => unsub();
    }
    setMyGroups([]);
  }, [user?.uid]);

  // Vista inicial siempre 'Mis alarmas personales'. No restaurar grupo desde localStorage al abrir.
  useEffect(() => {
    if (!user?.uid || lastViewRestoredRef.current) return;
    setVentanaGroup(null);
    lastViewRestoredRef.current = true;
  }, [user?.uid]);

  // Persistir vista actual al cambiar (para uso futuro; la vista al abrir es siempre personal)
  useEffect(() => {
    if (!user?.uid || !lastViewRestoredRef.current) return;
    try {
      if (!ventanaGroup) {
        localStorage.setItem(LAST_VIEW_KEY, JSON.stringify({ lastView: 'personal' as const }));
      } else {
        localStorage.setItem(
          LAST_VIEW_KEY,
          JSON.stringify({ lastView: 'group' as const, groupId: ventanaGroup.id, groupName: ventanaGroup.name })
        );
      }
    } catch (_) {}
  }, [user?.uid, ventanaGroup]);

  // Escuchar mensajes del Service Worker y eventos FCM (navegación desde notificaciones)
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'navigate') {
        const { groupId, action } = event.data;
        if (action === 'show_pending' && groupId) {
          // Seleccionar el grupo y mostrar solicitudes pendientes
          const group = myGroups.find((g) => g.id === groupId);
          if (group) {
            setVentanaGroup({ id: group.id, name: group.name });
          }
        }
      }
    };

    const handleFCMNavigate = (event: CustomEvent) => {
      const { groupId } = event.detail;
      if (groupId) {
        const group = myGroups.find((g) => g.id === groupId);
        if (group) {
          setVentanaGroup({ id: group.id, name: group.name });
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
    window.addEventListener('fcm-navigate', handleFCMNavigate as EventListener);
    
    return () => {
      navigator.serviceWorker.removeEventListener('message', handleServiceWorkerMessage);
      window.removeEventListener('fcm-navigate', handleFCMNavigate as EventListener);
    };
  }, [myGroups]);

  // Grupo actual: solo lo que el usuario tiene seleccionado (ventanaGroup). Se persiste al cerrar para restaurar al reabrir.
  const currentGroupId = ventanaGroup?.id ?? null;
  const currentGroupName = ventanaGroup?.name ?? (currentGroupId ? `Grupo ${currentGroupId}` : null);

  // ¿El usuario está aprobado en el grupo actual? (está en group.members). Solo entonces se muestran las alarmas.
  const isApprovedInCurrentGroup =
    Boolean(currentGroupId && user?.uid && groupData?.members.includes(user.uid));

  // Si tiene grupo, no es miembro y ya sabemos que no está pendiente -> fue rechazado, limpiar su grupo.
  useEffect(() => {
    if (!currentGroupId || !user?.uid || !groupData || isPendingInGroup !== false) return;
    const isMember = groupData.members.includes(user.uid);
    if (!isMember) {
      clearMyGroup(user.uid).then(() => {
        setProfile((prev) => (prev ? { ...prev, groupId: null, groupName: null } : prev));
        setVentanaGroup(null);
      });
    }
  }, [currentGroupId, user?.uid, groupData, isPendingInGroup, setProfile]);

  // Suscribirse al grupo actual (para saber members y si somos owner).
  useEffect(() => {
    if (!currentGroupId) {
      setGroupData(null);
      return;
    }
    const unsub = subscribeToGroup(currentGroupId, (data) => {
      setGroupData(data ? { members: data.members, owner: data.owner } : null);
    });
    return () => unsub();
  }, [currentGroupId]);

  // Suscribirse a "¿estoy en pending?" en el grupo actual. null = aún no sabemos.
  // Estado "pendiente de aprobación": grupo actual o, en vista personal, el grupo del perfil (para mostrar el banner en Mis alarmas personales)
  const groupIdForPendingCheck = currentGroupId ?? profile?.groupId ?? null;
  useEffect(() => {
    if (!groupIdForPendingCheck || !user?.uid) {
      setIsPendingInGroup(null);
      return;
    }
    const unsub = subscribeToMyPendingStatus(groupIdForPendingCheck, user.uid, (pending) => setIsPendingInGroup(pending));
    return () => unsub();
  }, [groupIdForPendingCheck, user?.uid]);

  // En vista personal: si ya no está pendiente y no es miembro del grupo del perfil, fue rechazado → limpiar perfil
  useEffect(() => {
    if (currentGroupId || !profile?.groupId || isPendingInGroup !== false || !user?.uid) return;
    getGroupMembers(profile.groupId).then((members) => {
      if (members == null || !members.includes(user.uid)) {
        clearMyGroup(user.uid).then(() => {
          setProfile((prev) => (prev ? { ...prev, groupId: null, groupName: null } : prev));
        });
      }
    });
  }, [currentGroupId, profile?.groupId, isPendingInGroup, user?.uid, setProfile]);

  const isOwnerOfCurrentGroup = Boolean(currentGroupId && user?.uid && groupData?.owner === user.uid);

  // Suscripción global: solicitudes pendientes y avisos de abandono de TODOS los grupos donde el usuario es administrador (owner).
  useEffect(() => {
    if (!user?.uid) {
      setPendingByGroupId({});
      setActivityByGroupId({});
      return;
    }
    const adminGroups = myGroups.filter((g) => g.owner === user.uid);
    setPendingByGroupId((prev) => {
      const next: Record<string, PendingRequest[]> = {};
      adminGroups.forEach((g) => {
        next[g.id] = prev[g.id] ?? [];
      });
      return next;
    });
    setActivityByGroupId((prev) => {
      const next: Record<string, GroupActivityItem[]> = {};
      adminGroups.forEach((g) => {
        next[g.id] = prev[g.id] ?? [];
      });
      return next;
    });
    const unsubs: (() => void)[] = [];
    adminGroups.forEach((g) => {
      unsubs.push(
        subscribeToPendingRequests(g.id, (requests) => {
          setPendingByGroupId((prev) => ({ ...prev, [g.id]: requests }));
        })
      );
      unsubs.push(
        subscribeToGroupActivity(g.id, (items) => {
          setActivityByGroupId((prev) => ({ ...prev, [g.id]: items }));
        })
      );
    });
    return () => unsubs.forEach((u) => u());
  }, [user?.uid, myGroups]);

  // Cargar datos iniciales al iniciar la app usando getDocs (una sola vez al iniciar)
  useEffect(() => {
    if (!user?.uid) {
      setAlarms([]);
      return;
    }

    const loadInitialAlarms = async () => {
      try {
        const personalAlarms = await loadPersonalAlarms(user.uid);
        if (!currentGroupId) {
          setAlarms(personalAlarms);
        }
      } catch (error) {
        console.error('Error al cargar alarmas iniciales:', error);
        // Continuar con suscripciones en tiempo real aunque falle la carga inicial
      }
    };

    // Solo cargar alarmas personales al inicio si no hay grupo seleccionado
    if (!currentGroupId) {
      loadInitialAlarms();
    }
  }, [user?.uid, currentGroupId]); // Ejecutar cuando cambia el usuario o el grupo

  // Alarmas: suscripción en tiempo real (además de la carga inicial). En error de Listen no se vacía el estado.
  useEffect(() => {
    if (currentGroupId && isApprovedInCurrentGroup) {
      const unsub = subscribeToGroupAlarms(currentGroupId, setAlarms);
      return () => unsub();
    }
    if (!currentGroupId && user?.uid) {
      const unsub = subscribeToUserAlarms(user.uid, setAlarms);
      return () => unsub();
    }
    setAlarms([]);
  }, [currentGroupId, isApprovedInCurrentGroup, user?.uid]);

  // Prioridad notificación: mantener copia de alarmas en el SW por si el stream Listen falla
  useEffect(() => {
    syncAlarmsToServiceWorker(alarms);
  }, [alarms]);

  // ==========================================================================
  // MÓDULO ESTABLE — Disparo de alarma (notificación visual + bip)
  // Añadir nuevas funciones (email, analytics, etc.) en funciones/archivos
  // separados y dentro de try-catch para que NUNCA bloqueen este flujo.
  // ==========================================================================
  useEffect(() => {
    if (!alarms.length || Notification?.permission !== 'granted') return;
    
    const timeouts: number[] = [];
    const now = Date.now();

    for (const alarm of alarms) {
        if (!alarm.active) continue;
        
        let alarmAt: number;
        if (alarm.datetimeUTC) {
          alarmAt = new Date(alarm.datetimeUTC).getTime();
        } else if (alarm.date && alarm.time) {
          alarmAt = new Date(`${alarm.date}T${alarm.time}`).getTime();
        } else {
          continue;
        }
        
        if (alarmAt <= now) continue;
        const delay = alarmAt - now;
        
        const localDateTime = alarm.datetimeUTC 
          ? utcToLocal(alarm.datetimeUTC)
          : { date: alarm.date || '', time: alarm.time || '' };
        
        const id = window.setTimeout(() => {
          const titulo = sanitizeAlarmLabel(alarm.label); // Sanitizado para evitar problemas con caracteres especiales
          const body = `${localDateTime.date} a las ${localDateTime.time}`;
          const clearBanner = () => (window as unknown as { __clearBanner?: () => void }).__clearBanner?.();

          // CRÍTICO: No modificar este bloque, asegura compatibilidad con Android.
          // Solo registration.showNotification(); NUNCA new Notification().
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready
              .then((reg) => {
                if (!reg.active || reg.active.state !== 'activated') return;
                const opts: NotificationOptions & { vibrate?: number[] } = {
                  body,
                  icon: '/vite.svg',
                  requireInteraction: true,
                  tag: alarm.id || 'alarm',
                  vibrate: [200, 100, 200, 100, 200],
                  data: { alarmId: alarm.id },
                };
                return reg.showNotification(titulo, opts);
              })
              .catch(() => {})
              .finally(clearBanner);
          } else {
            clearBanner();
          }

          // CRÍTICO: No modificar este bloque, asegura compatibilidad con Android.
          // Bip + tono del móvil; errores aquí no deben bloquear nada.
          try {
            if (typeof window !== 'undefined' && window.AudioContext) {
              const ctx = new window.AudioContext();
              const osc = ctx.createOscillator();
              const gain = ctx.createGain();
              osc.connect(gain);
              gain.connect(ctx.destination);
              osc.frequency.value = 880;
              osc.type = 'sine';
              gain.gain.setValueAtTime(0.15, ctx.currentTime);
              gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
              osc.start(ctx.currentTime);
              osc.stop(ctx.currentTime + 0.15);
            }
          } catch {
            // Bip opcional; no propagar
          }
        }, delay);
        timeouts.push(id);
    }

    return () => timeouts.forEach(clearTimeout);
  }, [alarms]);

  const handleLogin = async () => {
    setLoginInProgress(true);
    clearLoginError();
    try {
      await login();
    } finally {
      setLoginInProgress(false);
    }
  };

  const handleCreateGroup = async () => {
    if (!user) return;
    const trimmed = newGroupName.trim();
    if (!trimmed) {
      setCreateNameError(true);
      return;
    }
    setCreateNameError(false);
    setCreatingGroup(true);
    setJoinError(null);
    const timeoutId = window.setTimeout(() => setCreatingGroup(false), 15000);
    try {
      const { groupId, groupName } = await createGroup(user.uid, trimmed);
      setJustCreatedGroupId(groupId);
      setVentanaGroup({ id: groupId, name: groupName });
      setProfile((prev) =>
        prev
          ? { ...prev, groupId, groupName }
          : {
              uid: user.uid,
              email: user.email ?? null,
              displayName: user.displayName ?? null,
              photoURL: user.photoURL ?? null,
              groupId,
              groupName,
            }
      );
      setNewGroupName('');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Solo considerar offline si realmente es un error de red (no permisos u otros)
      const isOffline = /offline|unavailable|network|connection|failed to fetch|networkerror/i.test(msg)
        && !/permission|denied|unauthorized/i.test(msg);
      const isPermissionDenied = /permission|denied|insufficient/i.test(msg);
      setJoinError(
        isOffline
          ? 'Sin conexión. Comprueba tu internet e inténtalo de nuevo.'
          : isPermissionDenied
            ? 'Error de permisos en Firestore. Abre Firebase Console → Firestore → Reglas y pega las reglas del archivo firestore.rules.'
            : msg
      );
      console.error('Error al crear grupo:', e);
    } finally {
      window.clearTimeout(timeoutId);
      setCreatingGroup(false);
    }
  };

  const handleJoinGroup = async () => {
    if (!user || !newGroupInput.trim()) return;
    setJoinError(null);
    try {
      const { groupName } = await joinGroupRequest(
        user.uid,
        newGroupInput.trim(),
        user.displayName ?? null,
        user.photoURL ?? null
      );
      const id = newGroupInput.trim().toUpperCase();
      setVentanaGroup({ id, name: groupName });
      setProfile((prev) => (prev ? { ...prev, groupId: id, groupName } : null));
      setNewGroupInput('');
    } catch (e) {
      setJoinError((e as Error).message ?? 'No se pudo solicitar acceso al grupo');
    }
  };

  const handleSelectGroup = (g: { id: string; name: string }) => {
    // Si el id está vacío, significa que quiere volver a alarmas personales (solo cambiamos la vista; no borramos profile.groupId para poder seguir mostrando el banner de "esperando aprobación" si aplica)
    if (!g.id) {
      setVentanaGroup(null);
    } else {
      setVentanaGroup({ id: g.id, name: g.name });
    }
  };

  const handleAcceptMember = async (groupId: string, userId: string) => {
    if (!user) return;
    setAcceptingUserId(userId);
    try {
      await acceptMember(user.uid, groupId, userId);
    } catch (e) {
      setJoinError((e as Error).message ?? 'Error al aceptar');
    } finally {
      setAcceptingUserId(null);
    }
  };

  const handleRejectMember = async (groupId: string, userId: string) => {
    if (!user) return;
    setRejectingUserId(userId);
    try {
      await rejectMember(user.uid, groupId, userId);
    } catch (e) {
      setJoinError((e as Error).message ?? 'Error al rechazar');
    } finally {
      setRejectingUserId(null);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!user) return;
    setDeletingGroupId(groupId);
    setConfirmGroupAction(null);
    try {
      await deleteGroup(user.uid, groupId);
      if (ventanaGroup?.id === groupId) setVentanaGroup(null);
      if (justCreatedGroupId === groupId) setJustCreatedGroupId(null);
      setProfile((prev) => (prev?.groupId === groupId ? { ...prev, groupId: null, groupName: null } : prev));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setJoinError(msg);
      console.error('Error al eliminar grupo:', e);
    } finally {
      setDeletingGroupId(null);
    }
  };

  const handleLeaveGroup = async (groupId: string) => {
    if (!user) return;
    setConfirmGroupAction(null);
    setLeavingGroupId(groupId);
    // Actualización optimista: quitar banner y grupo del perfil de inmediato
    if (ventanaGroup?.id === groupId) setVentanaGroup(null);
    setProfile((prev) => (prev?.groupId === groupId ? { ...prev, groupId: null, groupName: null } : prev));
    try {
      await leaveGroup(user.uid, groupId, profile?.displayName ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setJoinError(msg);
      console.error('Error al salir del grupo:', e);
    } finally {
      setLeavingGroupId(null);
    }
  };

  const handleDeleteActivity = async (groupId: string, activityId: string) => {
    setDeletingActivityId(activityId);
    try {
      await deleteGroupActivityItem(groupId, activityId);
    } catch (e) {
      console.error('Error al eliminar aviso:', e);
      setJoinError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingActivityId(null);
    }
  };

  const handleAddAlarm = async (data: { time: string; date: string; label: string }) => {
    if (!user || !data.time || !data.date) return;
    setSavingAlarm(true);
    setAlarmError(null);
    const timeoutId = window.setTimeout(() => setSavingAlarm(false), 12000);
    try {
      // Convertir fecha/hora local a UTC (ISO 8601)
      const datetimeUTC = localToUTC(data.date, data.time);
      
      // Validar que data.label sea string (no objeto ni Event)
      const rawLabel = typeof data.label === 'string' ? data.label : String(data.label || '');
      
      // Asegurar que siempre incluya el uid del usuario
      const sanitizedLabel = sanitizeAlarmLabel(rawLabel);
      
      // Validación final: asegurar que label es string primitivo (no objeto anidado)
      const finalLabel = typeof sanitizedLabel === 'string' ? sanitizedLabel : 'Nueva Alarma';
      
      const alarmData: Omit<Alarm, 'id'> = {
        datetimeUTC, // Guardar en UTC (ISO 8601)
        // Mantener campos legacy para compatibilidad con datos antiguos
        time: String(data.time || ''),
        date: String(data.date || ''),
        label: finalLabel, // Asegurar que siempre es string primitivo
        active: true,
        createdBy: String(user.uid), // Siempre string
        createdAt: Date.now(),
      };
      
      // Log comparativo: objeto que se envía a Firebase (debe ser idéntico para automático y manual)
      console.log('[App] ===== COMPARATIVA OBJETO ALARMA =====');
      console.log('[App] Label original del input:', data.label, 'Tipo:', typeof data.label, 'Es string?', typeof data.label === 'string');
      console.log('[App] Label después de validación:', rawLabel, 'Tipo:', typeof rawLabel);
      console.log('[App] Label sanitizado:', sanitizedLabel, 'Tipo:', typeof sanitizedLabel);
      console.log('[App] Label final que se guarda:', finalLabel, 'Tipo:', typeof finalLabel);
      console.log('[App] Objeto completo que se guardará en Firestore:', JSON.stringify(alarmData, null, 2));
      console.log('[App] Estructura del objeto:', {
        tieneDatetimeUTC: 'datetimeUTC' in alarmData,
        tieneTime: 'time' in alarmData,
        tieneDate: 'date' in alarmData,
        tieneLabel: 'label' in alarmData,
        tipoLabel: typeof alarmData.label,
        tieneActive: 'active' in alarmData,
        tieneCreatedBy: 'createdBy' in alarmData,
        tieneCreatedAt: 'createdAt' in alarmData,
      });
      
      if (currentGroupId) {
        await addAlarmToGroup(currentGroupId, alarmData);
      } else {
        await addAlarmToUser(user.uid, alarmData);
      }
      
      // Keep-alive: ping al SW inmediatamente tras crear alarma para mantenerlo activo
      // Esto evita que Chrome suspenda el SW antes de que llegue la notificación (soluciona fallo alterno)
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        try {
          const channel = new MessageChannel();
          channel.port1.onmessage = (event) => {
            if (event.data?.type === 'KEEP_ALIVE_ACK') {
              console.log('[App] Keep-alive ping exitoso tras crear alarma');
            }
          };
          navigator.serviceWorker.controller.postMessage({ type: 'KEEP_ALIVE' }, [channel.port2]);
        } catch (err) {
          console.warn('[App] Error enviando keep-alive ping:', err);
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAlarmError(msg);
      console.error('Error al guardar alarma:', err);
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
      setSavingAlarm(false);
    }
  };

  const handleToggleAlarm = (alarmId: string, active: boolean) => {
    if (currentGroupId) toggleAlarm(currentGroupId, alarmId, active);
    else if (user) toggleUserAlarm(user.uid, alarmId, active);
  };

  const handleDeleteAlarm = (alarmId: string) => {
    if (currentGroupId) deleteAlarm(currentGroupId, alarmId);
    else if (user) deleteUserAlarm(user.uid, alarmId);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600">
        <div className="text-white text-center">
          <div className="w-10 h-10 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="font-medium">Cargando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-500 to-purple-600 p-4">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-sm w-full text-center">
          <h1 className="text-3xl font-extrabold text-gray-800 mb-2">MyDays Test</h1>
          <p className="text-gray-500 mb-6">Alarmas familiares compartidas</p>
          {loginError && (
            <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-700 text-sm text-left">{loginError}</div>
          )}
          <button
            type="button"
            onClick={handleLogin}
            disabled={loginInProgress}
            className="w-full bg-white border-2 border-gray-100 py-3 px-6 rounded-xl flex items-center justify-center gap-3 hover:bg-gray-50 transition-all shadow-sm disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {loginInProgress ? (
              <span className="font-semibold text-gray-700">Abriendo Google...</span>
            ) : (
              <>
                <img
                  src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                  className="w-6 h-6"
                  alt="Google"
                />
                <span className="font-semibold text-gray-700">Entrar con Google</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Bloque 1: Nombre de usuario + opción Salir */}
      <header className="bg-white border-b sticky top-0 z-10 px-4 py-4 sm:px-8 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <img
            src={user.photoURL || 'https://picsum.photos/40/40'}
            className="w-10 h-10 rounded-full border"
            alt="Profile"
          />
          <div>
            <h2 className="text-lg font-bold leading-none">{profile?.displayName || 'Cargando...'}</h2>
            <p className="text-sm text-gray-500 mt-0.5">Mi cuenta</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => (window as unknown as { __toggleErrorConsole?: () => void }).__toggleErrorConsole?.()}
            className="text-sm text-gray-500 font-medium px-3 py-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            Logs técnicos
          </button>
          <button
            type="button"
            onClick={() => logout()}
            className="text-sm text-red-500 font-medium px-4 py-2 hover:bg-red-50 rounded-lg transition-colors"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Bloque 2: Nombre del grupo en el que se comparte el listado (solo si hay grupo) */}
      {currentGroupId && currentGroupName && (
        <div className="bg-indigo-600 text-white px-4 py-3 sm:px-8">
          <p className="text-sm font-medium opacity-90">Compartiendo en</p>
          <p className="text-lg font-bold">{currentGroupName}</p>
          <p className="text-xs font-mono mt-0.5 opacity-80">ID: {currentGroupId}</p>
        </div>
      )}

      <main className="max-w-2xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Mensaje si el usuario solicitó entrar y está pendiente de aprobación */}
        {/* 1) Crear nueva alarma (solo si no hay grupo o estamos aprobados en el grupo) */}
        {(!currentGroupId || isApprovedInCurrentGroup) && (
          <AlarmForm
            onAddAlarm={handleAddAlarm}
            savingAlarm={savingAlarm}
            alarmError={alarmError}
          />
        )}
        {/* 2) Listado de alarmas (solo si no hay grupo o estamos aprobados) */}
        {(!currentGroupId || isApprovedInCurrentGroup) && (
          <AlarmList
            alarms={alarms}
            title={currentGroupId ? `Alarmas de ${currentGroupName ?? currentGroupId}` : 'Mis alarmas'}
            onToggle={handleToggleAlarm}
            onDelete={handleDeleteAlarm}
          />
        )}

        {/* Recuadro azul: crear/unirse + banners de solicitudes y avisos (dentro del mismo bloque) */}
        <GroupSection
          adminPendingBlocks={(() => {
            const getGroupName = (id: string) => myGroups.find((g) => g.id === id)?.name ?? id;
            const adminGroups = myGroups.filter((g) => g.owner === user?.uid);
            const inPersonalView = !currentGroupId;
            const groupsToShowPending = inPersonalView
              ? adminGroups.filter((g) => (pendingByGroupId[g.id]?.length ?? 0) > 0)
              : currentGroupId && isOwnerOfCurrentGroup
                ? [{ id: currentGroupId, name: getGroupName(currentGroupId) }]
                : [];
            return inPersonalView
              ? groupsToShowPending.map((g) => ({ groupId: g.id, groupName: g.name, requests: pendingByGroupId[g.id] ?? [] }))
              : currentGroupId
                ? [{ groupId: currentGroupId, groupName: getGroupName(currentGroupId), requests: pendingByGroupId[currentGroupId] ?? [] }]
                : [];
          })()}
          adminActivityList={(() => {
            const getGroupName = (id: string) => myGroups.find((g) => g.id === id)?.name ?? id;
            const adminGroups = myGroups.filter((g) => g.owner === user?.uid);
            const inPersonalView = !currentGroupId;
            return inPersonalView
              ? adminGroups.flatMap((g) => (activityByGroupId[g.id] ?? []).map((item) => ({ ...item, groupId: g.id, groupName: g.name })))
              : currentGroupId && (activityByGroupId[currentGroupId]?.length ?? 0) > 0
                ? (activityByGroupId[currentGroupId] ?? []).map((item) => ({ ...item, groupId: currentGroupId, groupName: getGroupName(currentGroupId) }))
                : [];
          })()}
          inPersonalView={!currentGroupId}
          onAcceptMember={handleAcceptMember}
          onRejectMember={handleRejectMember}
          onDeleteActivity={handleDeleteActivity}
          acceptingUserId={acceptingUserId}
          rejectingUserId={rejectingUserId}
          deletingActivityId={deletingActivityId}
          pendingApprovalGroupName={
            (currentGroupId && !isApprovedInCurrentGroup && isPendingInGroup)
              ? currentGroupName
              : !currentGroupId && profile?.groupId && isPendingInGroup
                ? (profile?.groupName ?? null)
                : null
          }
          myGroups={myGroups}
          currentGroupId={currentGroupId}
          currentUserId={user?.uid ?? null}
          newGroupName={newGroupName}
          setNewGroupName={setNewGroupName}
          newGroupInput={newGroupInput}
          setNewGroupInput={setNewGroupInput}
          creatingGroup={creatingGroup}
          createNameError={createNameError}
          setCreateNameError={setCreateNameError}
          joinError={joinError}
          confirmGroupAction={confirmGroupAction}
          setConfirmGroupAction={setConfirmGroupAction}
          deletingGroupId={deletingGroupId}
          leavingGroupId={leavingGroupId}
          onCreateGroup={handleCreateGroup}
          onJoinGroup={handleJoinGroup}
          onDeleteGroup={handleDeleteGroup}
          onLeaveGroup={handleLeaveGroup}
          onSelectGroup={handleSelectGroup}
        />
      </main>
    </div>
  );
};

export default App;
