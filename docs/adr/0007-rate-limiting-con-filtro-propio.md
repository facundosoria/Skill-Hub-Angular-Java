# 0007. Rate limiting de login con un filtro propio (`RateLimitFilter`)

- **Estado:** Aceptado
- **Fecha:** 2026-09-19

## Contexto

`POST /api/auth/login` es un objetivo directo de fuerza bruta. La aplicación
corre como una sola instancia de backend detrás de Caddy y, según el entorno,
de nginx o Cloudflare.

## Decisión

Un `jakarta.servlet.Filter` propio,
`backend/src/main/java/com/skillhub/config/RateLimitFilter.java` (commit
`befee59`), que actúa sobre `POST /api/auth/login` y
`POST /api/oauth/accept-login` (ambos validan usuario y contraseña):

- Ambos paths comparten el bucket de la IP, para que alternar entre el login web
  y el OAuth no esquive el bloqueo. El path se normaliza como en Spring MVC
  (`UrlPathHelper`: decodifica, quita `;...` y colapsa `//`), así sus variantes
  también cuentan.
- Cuenta **fallos consecutivos por IP** (respuestas 4xx). Cinco fallos bloquean
  60 s; cada nuevo grupo de cinco duplica la espera hasta un máximo de 1 h.
- Un login exitoso (2xx/3xx) limpia el conteo de fallos y el bloqueo de esa IP,
  pero conserva el nivel de penalización; éste vuelve a cero tras 1 h sin
  fallos.
- Durante el bloqueo responde `429` con `Retry-After`, `Cache-Control: no-store`
  y `{"error": ...}` en el formato de la API.
- La IP sale de `CF-Connecting-IP`, luego del primer valor de
  `X-Forwarded-For` y, si no hay, de `getRemoteAddr()`.
- Estado en un `ConcurrentHashMap` en memoria, con limpieza cuando supera 1000
  IPs: se eliminan las que no están bloqueadas ni fallaron en la última hora.
- **Los registros no se cuentan**: no son intentos de autenticación y compartir
  IP (p. ej. un aula) no debe bloquear altas legítimas (javadoc del filtro).

El mismo criterio de limitador en memoria se repite en
`infra/logs/LogsAccessLimiter.java` para el acceso a logs del gateway.

## Alternativas consideradas

- **Librería (Bucket4j, Resilience4j) o rate limiting en Caddy/nginx:** *Razón
  no registrada — confirmar.*
- **Rate limiting del DCR de Hydra:** pospuesto explícitamente y aceptado como
  riesgo operativo ([HYDRA-OAUTH.md](../../HYDRA-OAUTH.md), "Riesgos residuales";
  [OAUTH-HYDRA-CHECKLIST.md](../../OAUTH-HYDRA-CHECKLIST.md) ítem 7.30). Este
  filtro no lo cubre.

## Consecuencias

- Cero dependencias nuevas y comportamiento fácil de leer y testear.
- El estado se pierde al reiniciar y **no se comparte entre réplicas**: asume
  una sola instancia del backend.
- Confía en los headers `CF-Connecting-IP` / `X-Forwarded-For`. Si el backend
  quedara expuesto sin un proxy que los sobrescriba, un atacante podría
  falsearlos y rotar la IP aparente. *Confirmar* que todos los entornos los
  normalizan en el proxy.
- Sólo protege el login web y el login OAuth; `/api/mcp`, el registro y el DCR
  no tienen límite propio.
- El conteo es por IP: quien tenga una cuenta válida puede intercalar un login
  exitoso propio cada cuatro fallos y no llegar al bloqueo. Cerrarlo requiere
  contar también por usuario.

## Referencias

- `backend/src/main/java/com/skillhub/config/RateLimitFilter.java`.
- `backend/src/main/java/com/skillhub/infra/logs/LogsAccessLimiter.java`.
- Commit `befee59` ("chore: save local workspace changes", que también agregó
  `OriginCheckInterceptor`).
- Relacionado: [0002](0002-autenticacion-sesiones-api-keys-y-oauth-hydra.md).
