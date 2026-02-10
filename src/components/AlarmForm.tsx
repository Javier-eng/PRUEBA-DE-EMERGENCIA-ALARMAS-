import React, { useState } from 'react';
import { sanitizeAlarmLabel } from '../utils/sanitizeAlarmLabel';

export type AlarmFormData = {
  time: string;
  date: string;
  label: string;
};

type AlarmFormProps = {
  onAddAlarm: (data: AlarmFormData) => Promise<void>;
  savingAlarm: boolean;
  alarmError: string | null;
};

const AlarmForm: React.FC<AlarmFormProps> = ({ onAddAlarm, savingAlarm, alarmError }) => {
  const [datetime, setDatetime] = useState('');
  const [label, setLabel] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!datetime || datetime.length < 16) return;
    const [date, timePart] = datetime.split('T');
    const time = (timePart ?? '').slice(0, 5);
    if (!date || !time) return;
    try {
      await onAddAlarm({ date, time, label: sanitizeAlarmLabel(label) });
      setDatetime('');
      setLabel('');
    } catch {
      // Error ya mostrado por alarmError
    }
  };

  return (
    <section className="bg-white rounded-3xl p-6 shadow-md border border-gray-100" aria-label="Crear Nueva Alarma">
      <h4 className="text-lg font-bold text-gray-800 mb-4">Crear Nueva Alarma</h4>
      <form onSubmit={handleSubmit} className="space-y-5">
        {alarmError && (
          <div className="p-3 rounded-xl bg-red-50 text-red-700 text-sm border border-red-200">
            {alarmError}
          </div>
        )}
        <div>
          <label htmlFor="alarm-datetime" className="block text-sm font-bold text-gray-600 mb-2">Fecha y hora</label>
          <input
            id="alarm-datetime"
            type="datetime-local"
            value={datetime}
            onChange={(e) => setDatetime(e.target.value)}
            className="w-full min-h-[48px] px-4 py-3 text-base bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-solid"
          />
        </div>
        <div>
          <label htmlFor="alarm-label" className="block text-sm font-bold text-gray-600 mb-2">Nombre de la alarma</label>
          <input
            id="alarm-label"
            type="text"
            placeholder="Ej. Cita médico"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full min-h-[48px] px-4 py-3 text-base bg-gray-50 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 border-solid placeholder:text-gray-400"
          />
        </div>
        <button
          type="submit"
          disabled={savingAlarm || !datetime}
          className="w-full min-h-[56px] bg-blue-600 text-white py-4 rounded-2xl font-bold text-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg"
        >
          {savingAlarm ? 'Guardando...' : 'Guardar Alarma'}
        </button>
      </form>
    </section>
  );
};

export default AlarmForm;
