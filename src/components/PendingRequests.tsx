import React from 'react';
import type { PendingRequest } from '../services/groupService';

type PendingRequestsProps = {
  requests: PendingRequest[];
  onAccept: (userId: string) => void;
  onReject: (userId: string) => void;
  acceptingUserId: string | null;
  rejectingUserId: string | null;
  /** Opcional: nombre del grupo (p. ej. en vista global con varios grupos) */
  groupName?: string;
};

const PendingRequests: React.FC<PendingRequestsProps> = ({
  requests,
  onAccept,
  onReject,
  acceptingUserId,
  rejectingUserId,
  groupName,
}) => {
  if (requests.length === 0) return null;

  return (
    <section
      className="bg-white rounded-3xl p-6 shadow-md border border-gray-100"
      aria-label={groupName ? `Solicitudes de acceso: ${groupName}` : 'Solicitudes de acceso'}
    >
      <h3 className="text-lg font-bold text-gray-800 mb-2">
        Solicitudes de acceso{groupName ? ` — ${groupName}` : ''}
      </h3>
      <p className="text-sm text-gray-600 mb-4">Acepta o rechaza a quienes quieren unirse al grupo.</p>
      <ul className="space-y-3">
        {requests.map((r) => (
          <li
            key={r.userId}
            className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-gray-200 bg-gray-50"
          >
            <div className="flex items-center gap-3 min-w-0">
              <img
                src={r.photoURL || 'https://picsum.photos/40/40'}
                alt=""
                className="w-10 h-10 rounded-full border border-gray-200 shrink-0"
              />
              <span className="font-medium text-gray-800 truncate">{r.displayName}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onAccept(r.userId)}
                disabled={acceptingUserId !== null || rejectingUserId !== null}
                className="px-4 py-2 rounded-xl bg-green-600 text-white font-semibold text-sm hover:bg-green-700 disabled:opacity-50"
              >
                {acceptingUserId === r.userId ? 'Aceptando...' : 'Aceptar'}
              </button>
              <button
                type="button"
                onClick={() => onReject(r.userId)}
                disabled={acceptingUserId !== null || rejectingUserId !== null}
                className="px-4 py-2 rounded-xl bg-red-100 text-red-700 font-semibold text-sm hover:bg-red-200 disabled:opacity-50"
              >
                {rejectingUserId === r.userId ? 'Rechazando...' : 'Rechazar'}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default PendingRequests;
