/**
 * Utilidades para manejo de zonas horarias
 * Todas las alarmas se guardan en UTC y se convierten a hora local para mostrar
 */

/**
 * Obtiene la zona horaria del navegador del usuario
 * @returns IANA timezone string (ej: "America/Mexico_City", "Europe/Madrid")
 */
export const getUserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback si el navegador no soporta Intl.DateTimeFormat
    const offset = -new Date().getTimezoneOffset() / 60;
    return `UTC${offset >= 0 ? '+' : ''}${offset}`;
  }
};

/**
 * Convierte una fecha/hora local a UTC en formato ISO 8601
 * @param dateString - Fecha en formato YYYY-MM-DD
 * @param timeString - Hora en formato HH:mm
 * @returns String ISO 8601 UTC (ej: "2024-01-15T14:30:00.000Z")
 */
export const localToUTC = (dateString: string, timeString: string): string => {
  // Crear fecha local combinando date y time
  const localDate = new Date(`${dateString}T${timeString}:00`);
  
  // Convertir a UTC y retornar en formato ISO 8601
  return localDate.toISOString();
};

/**
 * Convierte una fecha/hora UTC (ISO 8601) a hora local del usuario
 * @param utcISOString - Fecha/hora en formato ISO 8601 UTC (ej: "2024-01-15T14:30:00.000Z")
 * @returns Objeto con date (YYYY-MM-DD) y time (HH:mm) en hora local
 */
export const utcToLocal = (utcISOString: string): { date: string; time: string } => {
  const utcDate = new Date(utcISOString);
  
  // Obtener año, mes, día en hora local
  const year = utcDate.getFullYear();
  const month = String(utcDate.getMonth() + 1).padStart(2, '0');
  const day = String(utcDate.getDate()).padStart(2, '0');
  
  // Obtener hora y minutos en hora local
  const hours = String(utcDate.getHours()).padStart(2, '0');
  const minutes = String(utcDate.getMinutes()).padStart(2, '0');
  
  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
};

/**
 * Formatea una fecha UTC para mostrar en la interfaz
 * @param utcISOString - Fecha/hora en formato ISO 8601 UTC
 * @returns String formateado para mostrar (ej: "15 Ene 2024, 14:30")
 */
export const formatAlarmDateTime = (utcISOString: string): string => {
  const utcDate = new Date(utcISOString);
  const local = utcToLocal(utcISOString);
  
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const monthIndex = utcDate.getMonth();
  const day = utcDate.getDate();
  const year = utcDate.getFullYear();
  
  return `${day} ${months[monthIndex]} ${year}, ${local.time}`;
};
