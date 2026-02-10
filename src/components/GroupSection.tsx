import React from 'react';
import type { GroupInfo, PendingRequest } from '../services/groupService';
import type { GroupActivityItem } from '../services/groupService';
import PendingRequests from './PendingRequests';

export type ConfirmGroupAction = { groupId: string; groupName: string; isOwner: boolean } | null;

export type AdminPendingBlock = { groupId: string; groupName: string; requests: PendingRequest[] };
export type AdminActivityItem = GroupActivityItem & { groupId: string; groupName: string };

export type GroupSectionProps = {
  myGroups: GroupInfo[];
  currentGroupId: string | null;
  currentUserId: string | null;
  newGroupName: string;
  setNewGroupName: (v: string) => void;
  newGroupInput: string;
  setNewGroupInput: (v: string) => void;
  creatingGroup: boolean;
  createNameError: boolean;
  setCreateNameError: (v: boolean) => void;
  joinError: string | null;
  confirmGroupAction: ConfirmGroupAction;
  setConfirmGroupAction: (a: ConfirmGroupAction) => void;
  deletingGroupId: string | null;
  leavingGroupId: string | null;
  onCreateGroup: () => Promise<void>;
  onJoinGroup: () => Promise<void>;
  onDeleteGroup: (groupId: string) => Promise<void>;
  onLeaveGroup: (groupId: string) => Promise<void>;
  onSelectGroup: (g: { id: string; name: string }) => void;
  /** Banners de admin dentro del recuadro azul: solicitudes y avisos de abandono */
  adminPendingBlocks?: AdminPendingBlock[];
  adminActivityList?: AdminActivityItem[];
  inPersonalView?: boolean;
  onAcceptMember?: (groupId: string, userId: string) => void;
  onRejectMember?: (groupId: string, userId: string) => void;
  onDeleteActivity?: (groupId: string, activityId: string) => void;
  acceptingUserId?: string | null;
  rejectingUserId?: string | null;
  deletingActivityId?: string | null;
  /** Si el usuario está esperando aprobación en un grupo: nombre del grupo para el banner (se muestra dentro del recuadro azul) */
  pendingApprovalGroupName?: string | null;
};

const GroupSection: React.FC<GroupSectionProps> = ({
  myGroups,
  currentGroupId,
  currentUserId,
  newGroupName,
  setNewGroupName,
  newGroupInput,
  setNewGroupInput,
  creatingGroup,
  createNameError,
  setCreateNameError,
  joinError,
  confirmGroupAction,
  setConfirmGroupAction,
  deletingGroupId,
  leavingGroupId,
  onCreateGroup,
  onJoinGroup,
  onDeleteGroup,
  onLeaveGroup,
  onSelectGroup,
  adminPendingBlocks = [],
  adminActivityList = [],
  inPersonalView = false,
  onAcceptMember,
  onRejectMember,
  onDeleteActivity,
  acceptingUserId = null,
  rejectingUserId = null,
  deletingActivityId = null,
  pendingApprovalGroupName = null,
}) => {
  const hasAnyPending = adminPendingBlocks.some((b) => b.requests.length > 0);
  const hasAnyActivity = adminActivityList.length > 0;
  const showAdminBanners = hasAnyPending || hasAnyActivity;
  const showPendingApproval = Boolean(pendingApprovalGroupName);

  return (
    <>
      {/* 1) Crear grupo, Unirse y (opcional) banners de solicitudes/avisos — recuadro azul */}
      <div className="bg-blue-600 rounded-3xl p-8 text-white shadow-lg">
        <h3 className="text-2xl font-bold mb-2">
          {myGroups.length > 0 ? 'Crear o unirse a otro grupo' : 'Tu grupo'}
        </h3>
        <p className="opacity-90 mb-4">
          {myGroups.length > 0
            ? 'Puedes crear un nuevo grupo o unirte a uno con su ID de 6 letras.'
            : 'Dale un nombre al grupo (ej. Familia García) y créalo. Luego comparte el ID de 6 letras para que otros se unan.'}
        </p>
        <div className="mb-4">
          <label className="block text-sm font-semibold opacity-90 mb-2">Nombre del grupo</label>
          <input
            type="text"
            placeholder="Ej. Familia García"
            value={newGroupName}
            onChange={(e) => {
              setNewGroupName(e.target.value);
              if (createNameError) setCreateNameError(false);
            }}
            className="w-full px-4 py-3 rounded-2xl text-gray-800 placeholder:text-gray-500"
            aria-invalid={createNameError}
            aria-describedby={createNameError ? 'create-name-error' : undefined}
          />
          {createNameError && (
            <p id="create-name-error" className="mt-2 text-sm text-red-300 font-medium" role="alert">
              Por favor, introduce un nombre para el grupo.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onCreateGroup}
          disabled={creatingGroup || !newGroupName.trim()}
          className="w-full py-3 px-6 rounded-2xl font-bold transition-colors shadow-sm disabled:cursor-not-allowed mb-6 disabled:opacity-70 disabled:bg-gray-400 disabled:text-gray-200 enabled:bg-white enabled:text-blue-600 enabled:hover:bg-blue-50"
        >
          {creatingGroup ? 'Creando grupo...' : 'Crear grupo'}
        </button>
        <div className="border-t border-white/30 pt-6">
          <p className="text-sm font-semibold mb-3 opacity-90">¿Tienes un ID de grupo?</p>
          <p className="opacity-90 mb-3 text-sm">Introduce el <strong>ID de 6 letras</strong> (código tipo ABC123) para unirte.</p>
          {joinError && (
            <div className="mb-3 p-3 rounded-xl bg-red-500/30 text-white text-sm">{joinError}</div>
          )}
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              placeholder="ID de 6 letras, ej: ABC123"
              value={newGroupInput}
              onChange={(e) => setNewGroupInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onJoinGroup()}
              className="flex-1 px-5 py-3 rounded-2xl text-gray-800 focus:outline-none focus:ring-2 focus:ring-white/50 uppercase"
            />
            <button
              type="button"
              onClick={onJoinGroup}
              disabled={!newGroupInput.trim()}
              className="bg-white text-blue-600 px-8 py-3 rounded-2xl font-bold hover:bg-blue-50 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Unirse
            </button>
          </div>
        </div>

        {/* Banner: esperando aprobación del administrador (dentro del recuadro azul) */}
        {showPendingApproval && (
          <div className="border-t border-white/30 pt-6 mt-6">
            <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 text-center">
              <p className="text-lg font-bold text-amber-800">Esperando aprobación del administrador</p>
              <p className="text-sm text-amber-700 mt-2">
                Tu solicitud para unirte a <strong>{pendingApprovalGroupName}</strong> está pendiente. Cuando el creador del grupo la acepte, podrás ver y crear alarmas.
              </p>
            </div>
          </div>
        )}

        {/* Banners de solicitudes de entrada y avisos de abandono (dentro del recuadro azul) */}
        {showAdminBanners && (
          <div className="border-t border-white/30 pt-6 mt-6">
            <p className="text-sm font-semibold opacity-90 mb-3">Solicitudes y avisos de tus grupos</p>
            <div className="rounded-2xl bg-white/10 backdrop-blur p-4 space-y-4">
              {adminPendingBlocks.map(
                (block) =>
                  block.requests.length > 0 &&
                  onAcceptMember &&
                  onRejectMember && (
                    <div key={block.groupId} className="rounded-xl bg-white text-gray-800 p-4">
                      <PendingRequests
                        requests={block.requests}
                        groupName={inPersonalView ? block.groupName : undefined}
                        onAccept={(userId) => onAcceptMember(block.groupId, userId)}
                        onReject={(userId) => onRejectMember(block.groupId, userId)}
                        acceptingUserId={acceptingUserId ?? null}
                        rejectingUserId={rejectingUserId ?? null}
                      />
                    </div>
                  )
              )}
              {hasAnyActivity && onDeleteActivity && (
                <div className="rounded-xl bg-white text-gray-800 p-4">
                  <p className="text-sm font-semibold text-slate-700 mb-2">Avisos de abandono</p>
                  <ul className="space-y-2">
                    {adminActivityList.slice(0, 30).map((item) => (
                      <li key={`${item.groupId}-${item.id}`} className="text-sm text-slate-600 flex items-start gap-2 flex-wrap">
                        <span className="text-amber-600 shrink-0" aria-hidden>•</span>
                        {inPersonalView && <span className="font-medium text-slate-700 shrink-0">{item.groupName}:</span>}
                        <span className="min-w-0 flex-1">{item.type === 'member_left' ? item.message : item.message || `Aviso (${item.type})`}</span>
                        <button
                          type="button"
                          onClick={() => onDeleteActivity(item.groupId, item.id)}
                          disabled={deletingActivityId === item.id}
                          className="shrink-0 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          aria-label={`Eliminar aviso: ${item.message}`}
                        >
                          {deletingActivityId === item.id ? 'Eliminando...' : 'Eliminar'}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 2) Listado de grupos (donde soy admin o miembro) — clic para ver alarmas */}
      {myGroups.length > 0 && (
        <section className="bg-white rounded-3xl p-6 shadow-md border border-gray-100" aria-label="Mis grupos">
          <h3 className="text-lg font-bold text-gray-800 mb-4">Mis grupos</h3>
          <p className="text-sm text-gray-600 mb-4">Pulsa en un grupo para ver sus alarmas. Puedes ser administrador de uno y miembro de otros.</p>
          <ul className="space-y-4">
            {/* Opción para volver a alarmas personales */}
            <li
              className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl border-2 transition-colors ${
                currentGroupId === null ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200 bg-gray-50/50'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelectGroup({ id: '', name: 'Mis alarmas personales' })}
                className="min-w-0 flex-1 text-left hover:opacity-90"
              >
                <p className="font-semibold text-gray-800">👤 Mis alarmas personales</p>
                <p className="text-sm text-gray-600 mt-1">Ver solo mis alarmas (sin grupo)</p>
                <span className="text-xs text-blue-600 font-medium mt-1 inline-block">Ver mis alarmas →</span>
              </button>
            </li>
            {myGroups.map((g) => {
              const isOwner = currentUserId !== null && g.owner === currentUserId;
              const confirmThis = confirmGroupAction?.groupId === g.id;
              const isDeleting = deletingGroupId === g.id;
              const isLeaving = leavingGroupId === g.id;
              const busy = isDeleting || isLeaving;
              return (
                <li
                  key={g.id}
                  className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-2xl border-2 transition-colors ${currentGroupId === g.id ? 'border-blue-500 bg-blue-50/50' : 'border-amber-200 bg-amber-50/50'}`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectGroup({ id: g.id, name: g.name })}
                    className="min-w-0 flex-1 text-left hover:opacity-90"
                  >
                    <p className="font-semibold text-gray-800">{g.name}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      ID: <span className="font-mono font-bold text-amber-700 text-base">{g.id}</span>
                      {isOwner && <span className="ml-2 text-xs font-medium text-amber-700">(Admin)</span>}
                    </p>
                    <span className="text-xs text-blue-600 font-medium mt-1 inline-block">Ver alarmas de este grupo →</span>
                  </button>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {confirmThis ? (
                      <>
                        <span className="text-sm font-medium text-gray-600">
                          {confirmGroupAction?.isOwner ? '¿Eliminar grupo?' : '¿Salir del grupo?'}
                        </span>
                        <button
                          type="button"
                          onClick={() => (confirmGroupAction?.isOwner ? onDeleteGroup(g.id) : onLeaveGroup(g.id))}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold text-sm hover:bg-red-700 disabled:opacity-60"
                        >
                          {isDeleting ? 'Eliminando...' : isLeaving ? 'Saliendo...' : confirmGroupAction?.isOwner ? 'Sí, eliminar' : 'Sí, salir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmGroupAction(null)}
                          disabled={busy}
                          className="px-3 py-1.5 rounded-lg bg-gray-200 text-gray-700 font-semibold text-sm hover:bg-gray-300 disabled:opacity-60"
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => navigator.clipboard.writeText(g.id)}
                          className="px-4 py-2 rounded-xl bg-amber-500 text-white font-semibold text-sm hover:bg-amber-600 transition-colors"
                        >
                          Copiar ID
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmGroupAction({ groupId: g.id, groupName: g.name, isOwner })}
                          className="px-4 py-2 rounded-xl bg-red-100 text-red-700 font-semibold text-sm hover:bg-red-200 transition-colors border border-red-200"
                          aria-label={isOwner ? `Eliminar grupo ${g.name}` : `Salir del grupo ${g.name}`}
                        >
                          {isOwner ? 'Eliminar Grupo' : 'Salir del Grupo'}
                        </button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
};

export default GroupSection;
