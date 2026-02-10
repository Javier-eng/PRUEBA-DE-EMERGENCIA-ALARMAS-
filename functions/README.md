# Cloud Functions para MyDays - Notificaciones Push

Estas funciones aseguran que las notificaciones lleguen **incluso cuando la app está cerrada** (especialmente importante para APK/Android).

## Funciones implementadas

1. **`notifyAdminOnJoinRequest`**: Notifica al admin cuando alguien solicita unirse al grupo
2. **`notifyOnPersonalAlarm`**: Notifica al usuario cuando se crea una alarma personal
3. **`notifyOnGroupAlarm`**: Notifica a **TODOS los miembros** cuando se crea una alarma de grupo
4. **`notifyAdminOnMemberLeft`**: Notifica al admin cuando un miembro abandona el grupo

## Características

- ✅ **Prioridad alta** (`priority: "high"`) para todas las notificaciones
- ✅ **Payload estándar**: todas incluyen `groupId` (vacío `""` si es personal) y `type`
- ✅ **Envío a todos los tokens**: no solo a usuarios con la app abierta
- ✅ **Limpieza automática**: tokens inválidos se eliminan del perfil

## Despliegue

### 1. Instalar dependencias

```bash
cd functions
npm install
```

### 2. Configurar Firebase Admin

Asegúrate de tener las credenciales de Firebase Admin configuradas:

```bash
firebase login
firebase use --add  # Selecciona tu proyecto "alarmas-firebase"
```

### 3. Desplegar funciones

```bash
firebase deploy --only functions
```

O desplegar una función específica:

```bash
firebase deploy --only functions:notifyOnGroupAlarm
```

### 4. Ver logs

```bash
firebase functions:log
```

## Estructura del payload

Todas las notificaciones incluyen en `data`:

```javascript
{
  type: "personal_alarm" | "group_alarm" | "join_request" | "member_left",
  groupId: "ABC123" | "", // Vacío para alarmas personales
  // ... campos específicos según el tipo
}
```

## Verificación

1. Crea una alarma personal → deberías recibir push aunque la app esté cerrada
2. Crea una alarma en un grupo → todos los miembros reciben push
3. Solicita unirte a un grupo → el admin recibe push
4. Abandona un grupo → el admin recibe push

## Notas importantes

- Las funciones se ejecutan en **europe-west1** (ajusta si necesitas otra región)
- Los tokens FCM se guardan automáticamente en `users/{userId}.fcmToken` cuando el usuario inicia sesión
- Si un token es inválido (usuario desinstaló), se limpia automáticamente del perfil
