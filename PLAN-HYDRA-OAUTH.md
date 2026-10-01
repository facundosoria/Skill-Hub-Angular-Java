# Plan por fases para completar Hydra/OAuth

## Resumen

Completar la integración Hydra/OAuth manteniendo compatibilidad con clientes MCP estándar y API keys existentes. El DCR quedará habilitado sin exigir previamente una cuenta Skill Hub; registrar un cliente no otorgará acceso a datos.

La guía de avance será `OAUTH-HYDRA-CHECKLIST.md`, ampliada con fases, evidencias, pruebas y criterios de aprobación.

## Fases

### Fase 0 — Baseline y checklist

- Registrar estado inicial de Git, Compose, backend, frontend y pruebas.
- Convertir la checklist en guía operativa con estados: `pendiente`, `en progreso`, `aprobado`, `bloqueado`.
- Documentar comandos de verificación y evidencia esperada.
- Mantener funcionales las API keys durante todo el trabajo.

Criterio de salida: existe una checklist reproducible y una línea base verificable.

### Fase 1 — Contrato de seguridad OAuth

Definir para `/api/mcp`:

- issuer válido;
- recurso protegido `${PUBLIC_BASE_URL}/api/mcp`;
- scope obligatorio `mcp`;
- `sub` correspondiente a un usuario Skill Hub activo.

Extender la validación JWT para comprobar firma RS256, issuer, expiración, subject, audiencia/recurso y scope `mcp`.

Las API keys continuarán usando su flujo actual.

Pruebas:

- token válido;
- token expirado o manipulado;
- issuer incorrecto;
- audiencia incorrecta;
- scope ausente;
- usuario inexistente o inactivo;
- API key válida y revocada.

Criterio de salida: `/api/mcp` sólo acepta tokens OAuth destinados al recurso MCP y con scope `mcp`.

### Fase 2 — DCR compatible y seguro

Mantener DCR habilitado en local y producción para no obligar a registrar manualmente cada cliente.

Un cliente podrá registrarse sin cuenta previa, pero el registro sólo crea una identidad técnica. No concede acceso al MCP.

Controles obligatorios:

- Authorization Code + PKCE;
- `token_endpoint_auth_method: none` para clientes públicos;
- validación estricta de `redirect_uri`;
- rechazo de redirect URIs no permitidas por las reglas de Hydra;
- scopes solicitados limitados al contrato permitido;
- no aceptar tokens sin usuario autenticado;
- no aceptar tokens sin consentimiento;
- no exponer secretos ni errores internos;
- auditoría de registros y autorizaciones;
- mantener el puerto admin `4445` sólo dentro de Docker.

Controles explícitamente pospuestos:

- no exigir cuenta Skill Hub antes del DCR;
- no implementar inicialmente rate limiting avanzado;
- no bloquear el cierre por protección completa contra spam.

El riesgo de registros masivos deberá quedar documentado como riesgo operativo pendiente.

Pruebas:

- DCR exitoso sin cuenta;
- DCR con redirect URI inválida;
- cliente sin PKCE rechazado;
- cliente registrado sin login no puede llamar `/api/mcp`;
- cliente registrado con usuario activo y consentimiento sí puede obtener token;
- metadata OAuth informa correctamente issuer, recurso y endpoints.

### Fase 3 — Cambio obligatorio de contraseña

Si el usuario tiene `must_change_password = true`:

- no aceptar el `login_challenge`;
- crear una transacción OAuth pendiente, de un solo uso y con expiración;
- enviar al usuario al flujo de cambio de contraseña;
- continuar OAuth sólo después del cambio exitoso;
- invalidar la transacción al consumirla, rechazarla o expirar.

La transacción no debe guardar contraseñas ni exponer challenges en logs.

Pruebas:

- usuario normal continúa;
- usuario temporal queda bloqueado;
- cambio exitoso continúa OAuth;
- contraseña inválida no consume el flujo;
- challenge reutilizado o expirado es rechazado;
- usuario inactivo no puede continuar.

### Fase 4 — Logout OAuth

Implementar:

- ruta frontend `/oauth/logout`;
- consulta del `logout_challenge`;
- aceptación y rechazo del logout;
- limpieza de `skillhub_session`;
- invalidación de transacciones OAuth pendientes;
- redirección al callback indicado por Hydra.

Pruebas:

- logout aceptado;
- logout rechazado;
- challenge inválido o expirado;
- sesión existente y ausente;
- cookie eliminada;
- `/api/auth/me` devuelve `401` después del logout.

Criterio de salida: un cliente OAuth puede iniciar logout y finalizar sin caer en una ruta inexistente.

### Fase 5 — Suite E2E completa

Crear una ejecución reproducible que levante PostgreSQL, Hydra, backend, frontend/Caddy y un cliente OAuth de prueba.

Debe validar automáticamente:

1. registro dinámico del cliente;
2. PKCE;
3. discovery;
4. login;
5. consentimiento;
6. intercambio de authorization code;
7. llamada `initialize` a `/api/mcp`;
8. llamada `tools/list`;
9. llamada `tools/call`;
10. logout;
11. tokens inválidos, expirados, sin scope o de recurso incorrecto;
12. usuario inactivo;
13. API key existente;
14. usuario con cambio obligatorio de contraseña.

Los logs de prueba nunca deben contener passwords, tokens, client secrets ni valores del `.env`.

### Fase 6 — Endurecimiento y regresión

Ejecutar:

- tests unitarios backend;
- tests de integración;
- tests OAuth;
- tests frontend;
- build backend;
- build frontend;
- `docker compose config --quiet`;
- validación de Caddy;
- `git diff --check`;
- revisión de secretos hardcodeados.

Revisar además:

- CORS permitido sólo donde corresponda;
- TLS e issuer público;
- ausencia de exposición de `4445`;
- ausencia de `serve all --dev` en producción;
- compatibilidad de API keys;
- compatibilidad del login web.

### Fase 7 — Cierre documental

Actualizar:

- `HYDRA-OAUTH.md`;
- `OAUTH-HYDRA-CHECKLIST.md`;
- `README.md` si contiene instrucciones obsoletas.

Documentar:

- DCR sin cuenta previa;
- diferencia entre registrar cliente y obtener acceso;
- controles de seguridad;
- riesgo de spam pospuesto;
- ejecución de la suite E2E;
- diagnóstico y rollback;
- criterio de producción.

## Interfaces previstas

- Mantener `/api/mcp` y API keys sin cambios.
- Mantener metadata OAuth existente.
- Agregar endpoints `/api/oauth/*` para logout y continuación del cambio de contraseña.
- Agregar `/oauth/logout`.
- Usar el scope obligatorio `mcp`.
- Usar `${PUBLIC_BASE_URL}/api/mcp` como recurso protegido.

## Criterio final de aceptación

No se marca como terminado hasta comprobar que:

- un cliente puede registrarse sin cuenta;
- ese registro no permite acceder a datos;
- sólo un usuario activo autenticado y con consentimiento obtiene el token;
- PKCE, issuer, audiencia, recurso, subject y scope son validados;
- logout funciona;
- el cambio obligatorio de contraseña no puede saltarse;
- API keys y login web siguen funcionando;
- la suite E2E completa pasa desde un entorno limpio;
- la checklist contiene evidencia de cada criterio aprobado.

## Decisiones adoptadas

- DCR habilitado en producción.
- No se exige cuenta Skill Hub antes del DCR.
- PKCE obligatorio.
- Scope único obligatorio: `mcp`.
- Rate limiting y mitigación avanzada de spam quedan pospuestos y documentados.
- El registro de cliente no concede acceso al MCP.
- El consentimiento del usuario sigue siendo obligatorio.
