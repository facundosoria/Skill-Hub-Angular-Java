# Checklist de implementación Hydra/OAuth

Seguimiento de los pendientes detectados en la revisión de Hydra/OAuth para el
endpoint MCP. Marcar una tarea sólo cuando su criterio de aceptación haya sido
verificado.

## Estado actual

- **Última revisión:** 2026-09-29
- **Estado:** implementación base disponible; pendientes de cierre
- **Fuente relacionada:** `docker-compose.yml`, `backend/src/main/java/com/skillhub/oauth/`, `frontend/src/app/features/auth/` y `frontend/Caddyfile`

## Pendientes

### 1. Completar consentimiento OAuth

- [x] Crear la ruta frontend `/oauth/consent`.
- [x] Mostrar el `consent_challenge` y los scopes solicitados.
- [x] Conectar la pantalla con `POST /api/oauth/accept-consent`.
- [x] Redirigir al `redirectTo` devuelto por Hydra.
- [ ] Verificar el flujo con un cliente OAuth/MCP real.

**Criterio de listo:** un cliente que no use `skip_consent` puede completar login, consentimiento y volver correctamente a su callback.

### 2. Completar logout OAuth

- [ ] Definir el comportamiento esperado para `/oauth/logout`.
- [ ] Crear la ruta o handler correspondiente.
- [ ] Resolver el `logout_challenge` con Hydra cuando corresponda.
- [ ] Verificar que el logout no exponga ni conserve datos de sesión.

**Criterio de listo:** Hydra puede completar un logout iniciado por un cliente sin terminar en una ruta inexistente.

### 3. Agregar pruebas end-to-end de Hydra/OAuth

- [ ] Levantar Hydra y PostgreSQL en un entorno reproducible de pruebas.
- [ ] Registrar o provisionar un cliente OAuth de prueba.
- [ ] Probar authorization code + PKCE.
- [ ] Probar login y consentimiento.
- [ ] Probar intercambio del código por token.
- [ ] Probar llamada autenticada a `/api/mcp` con JWT.
- [ ] Probar token expirado, inválido, usuario inactivo y API key existente.

**Criterio de listo:** el flujo completo pasa automáticamente y cubre los casos positivos y negativos principales.

### 4. Validar audiencia, recurso y scopes del token

- [ ] Confirmar los claims reales que emite Hydra para el flujo MCP.
- [ ] Definir la audiencia/recurso autorizado para `/api/mcp`.
- [ ] Validar `aud` y/o el claim de recurso en el backend.
- [ ] Definir y validar los scopes mínimos requeridos por MCP.
- [ ] Agregar pruebas para tokens emitidos para otro cliente o recurso.

**Criterio de listo:** `/api/mcp` rechaza tokens firmados por Hydra que no hayan sido emitidos para este recurso o que no tengan los permisos requeridos.

### 5. Respetar el cambio obligatorio de contraseña en OAuth

- [ ] Detectar cuentas con `must_change_password` durante `acceptLogin`.
- [ ] Evitar emitir autorización OAuth para una contraseña temporal.
- [ ] Diseñar la continuación del flujo después del cambio de contraseña.
- [ ] Verificar que una cuenta activa con contraseña definitiva siga funcionando.

**Criterio de listo:** ninguna cuenta con cambio obligatorio pendiente puede obtener un token OAuth antes de completar el cambio de contraseña.

### 6. Endurecer la configuración para producción

- [ ] Definir una política de clientes, redirect URIs y registro dinámico.
- [ ] Decidir si DCR pública es realmente necesaria; restringirla o desactivarla si no lo es.
- [ ] Reemplazar `SERVE_PUBLIC_CORS_ALLOWED_ORIGINS: "*"` por orígenes explícitos.
- [ ] Revisar el uso de `serve all --dev` para producción.
- [ ] Confirmar secretos, TLS, issuer público y URLs de callback reales.
- [ ] Verificar que el puerto admin `4445` no sea accesible desde fuera de Docker.

**Criterio de listo:** la configuración de producción está documentada, revisada y no deja registro público, CORS abierto o modo desarrollo sin justificación.

### 7. Cerrar y dejar trazable la implementación

- [ ] Revisar todos los cambios locales relacionados con Hydra/OAuth.
- [ ] Confirmar que no haya secretos, tokens ni valores de producción hardcodeados.
- [ ] Ejecutar las verificaciones disponibles y registrar sus resultados.
- [ ] Resolver o documentar los fallos de entorno de las pruebas.
- [ ] Actualizar README/documentación operativa con el procedimiento de despliegue.
- [ ] Crear el commit de cierre cuando los pendientes anteriores estén completos.

**Criterio de listo:** el estado del repositorio, las verificaciones y las limitaciones conocidas quedan documentados y reproducibles.

## Registro de avances

| Fecha | Tarea | Cambio realizado | Verificación | Estado |
|---|---|---|---|---|
| 2026-09-29 | Checklist inicial | Se documentaron los siete pendientes | Revisión de código y `docker compose config --quiet` | Pendiente |
| 2026-09-29 | Consentimiento OAuth | Se agregó consulta segura de scopes, aprobación/rechazo y ruta Angular | TypeScript, compilación Java, `OAuthControllerTest` y `git diff --check` | Implementación lista; falta prueba real |
