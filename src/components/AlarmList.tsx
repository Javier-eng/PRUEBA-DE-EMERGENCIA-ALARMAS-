import React, { useState } from 'react';
import type { Alarm } from '../types';
import { utcToLocal } from '../utils/timezone';

type AlarmListProps = {
  alarms: Alarm[];
  title: string;
  onToggle: (alarmId: string, active: boolean) => void;
  onDelete: (alarmId: string) => void;
};

const AlarmList: React.FC<AlarmListProps> = ({ alarms, title, onToggle, onDelete }) => {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const handleDeleteClick = (alarmId: string) => {
    if (confirmDeleteId === alarmId) {
      // Segunda confirmación: borrar
      onDelete(alarmId);
      setConfirmDeleteId(null);
    } else {
      // Primera confirmación: mostrar botón de confirmar
      setConfirmDeleteId(alarmId);
      // Auto-cancelar después de 5 segundos
      setTimeout(() => setConfirmDeleteId(null), 5000);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center justify-between gap-2 text-left mb-3 group"
        aria-expanded={!collapsed}
      >
        <h4 className="text-lg font-bold text-gray-800">{title}</h4>
        <span
          className={`shrink-0 text-gray-500 transition-transform ${collapsed ? '' : 'rotate-90'}`}
          aria-hidden
        >
          ▶
        </span>
      </button>
      {!collapsed && (
      <div className="grid gap-4">
        {alarms.length === 0 ? (
          <div className="text-center py-10 text-gray-400 bg-white rounded-2xl border border-gray-100">
            <p className="italic">No hay alarmas. Usa el formulario de arriba para guardar una.</p>
          </div>
        ) : (
          alarms.map((alarm) => {
            // Convertir UTC a hora local para mostrar
            const localDateTime = alarm.datetimeUTC 
              ? utcToLocal(alarm.datetimeUTC)
              : { date: alarm.date || '', time: alarm.time || '' }; // Fallback para alarmas antiguas
            
            return (
              <div
                key={alarm.id}
                className={`p-5 rounded-2xl flex items-center justify-between transition-all border ${alarm.active ? 'bg-white shadow-sm border-gray-100' : 'bg-gray-50 border-gray-100 opacity-70'}`}
              >
                <div>
                  <div className="text-2xl font-black text-gray-800 leading-none">{localDateTime.time}</div>
                  <div className="text-xs font-semibold text-blue-600 uppercase mt-1 tracking-wide">{localDateTime.date}</div>
                  <div className="text-sm font-medium text-gray-500 mt-1">{alarm.label}</div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onToggle(alarm.id, !alarm.active)}
                    className={`w-12 h-7 rounded-full p-0.5 transition-colors ${alarm.active ? 'bg-blue-600' : 'bg-gray-300'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full transition-transform ${alarm.active ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                  {confirmDeleteId === alarm.id ? (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg border border-gray-200 transition-colors"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteClick(alarm.id)}
                        className="px-3 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg border border-red-700 transition-colors"
                      >
                        Confirmar borrar
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleDeleteClick(alarm.id)}
                      className="px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
                    >
                      Borrar
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
      )}
    </div>
  );
};

export default AlarmList;
