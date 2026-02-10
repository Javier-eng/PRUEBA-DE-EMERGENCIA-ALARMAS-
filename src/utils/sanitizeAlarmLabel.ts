/**
 * Sanitiza el nombre de la alarma para evitar problemas con caracteres especiales,
 * espacios excesivos y asegurar que siempre haya un valor válido.
 */

const MAX_LABEL_LENGTH = 100;
const DEFAULT_LABEL = 'Nueva Alarma';

/**
 * Sanitiza el label de una alarma:
 * - Elimina espacios al inicio y final
 * - Reemplaza múltiples espacios por uno solo
 * - Limita la longitud
 * - Asegura que no esté vacío (usa fallback)
 */
export function sanitizeAlarmLabel(label: string | null | undefined): string {
  if (!label || typeof label !== 'string') return DEFAULT_LABEL;
  
  // Trim y reemplazar múltiples espacios por uno solo
  let sanitized = label.trim().replace(/\s+/g, ' ');
  
  // Limitar longitud (cortar y añadir ... si es muy largo)
  if (sanitized.length > MAX_LABEL_LENGTH) {
    sanitized = sanitized.substring(0, MAX_LABEL_LENGTH - 3) + '...';
  }
  
  // Si después de sanitizar está vacío, usar fallback
  if (!sanitized || sanitized.length === 0) {
    return DEFAULT_LABEL;
  }
  
  return sanitized;
}
