export interface Alarm {
  id: string;
  /** Fecha y hora en formato ISO 8601 UTC (ej: "2024-01-15T14:30:00.000Z") */
  datetimeUTC: string;
  /** Campos legacy para compatibilidad (se calculan desde datetimeUTC) */
  time?: string;
  date?: string;
  label: string;
  active: boolean;
  createdBy: string;
  createdAt: number;
}

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  groupId: string | null;
  groupName?: string | null;
  fcmToken?: string;
  /** Zona horaria del usuario (ej: "America/Mexico_City", "Europe/Madrid") */
  timezone?: string;
}

export interface Group {
  id: string;
  name: string;
  members: string[];
  owner: string;
}
