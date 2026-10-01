# Suite E2E OAuth de Hydra

La suite crea un proyecto Docker Compose aislado (`skillhub-e2e`) con PostgreSQL,
Hydra, backend, frontend/Caddy y un cliente OAuth Node sin dependencias externas.
Usa los puertos host `15432` (PostgreSQL), `18444` (Hydra público) y `18087`
(frontend/Caddy); no reutiliza ni detiene los contenedores del compose normal.

## Ejecución

Desde la raíz del repositorio:

```bash
scripts/test-hydra-oauth.sh
```

El script genera un `.env` efímero en `/tmp` con secretos aleatorios, valida la
configuración, levanta el stack con `docker compose -p skillhub-e2e`, ejecuta el
cliente contra Caddy y finalmente ejecuta `docker compose -p skillhub-e2e down -v`.
Los secretos, contraseñas, tokens, challenges y respuestas sensibles no se
imprimen. La salida contiene sólo `PASS`/`FAIL`, tiempos y contadores.

## Cobertura

| Paso | Flujo | Criterio |
|---|---|---|
| 5.1 | Stack aislado y cliente reproducible | 7.24 |
| 5.2 | Registro dinámico público sin cuenta | 7.17 |
| 5.3 | PKCE S256 y rechazo sin PKCE al finalizar authorize o en token exchange | 7.20 |
| 5.4 | Discovery OAuth/protected resource | 7.20 |
| 5.5 | Login de usuario activo por endpoint web | 7.19 |
| 5.6 | Consentimiento explícito | 7.19, 7.32 |
| 5.7 | Authorization code + intercambio PKCE | 7.19 |
| 5.8 | `initialize` OAuth en `/api/mcp` | 7.24 |
| 5.9 | `tools/list` OAuth | 7.24 |
| 5.10 | `tools/call` OAuth | 7.24 |
| 5.11 | Logout OAuth, callback y cookie | 7.21 |
| 5.12 | Token inválido/expirado/sin scope/recurso | 7.20 |
| 5.13 | Usuario inactivo rechazado | 7.19 |
| 5.14 | API key existente | 7.23 |
| 5.15 | Cambio obligatorio: no token antes, sí después | 7.22 |
| 5.16 | Escaneo de logs contra secretos generados | 7.24 |

La ejecución verificada el 2026-10-01 terminó con `RESULT PASS checks=15
failures=0`, código 0 y logs sin secretos. El detalle de regresión está en
`/tmp/claude-1000/-home-rcoleman-Repos-Skill-Hub-Angular-Java/e0921be0-51db-48a2-93f3-17ef13c055dc/scratchpad/report-P6.md`.

## Diagnóstico seguro

Si falla el arranque, consultar `docker compose -p skillhub-e2e ps` y los logs
del proyecto antes de repetir. El script conserva los logs sólo en un temporal,
los escanea sin mostrarlos y limpia contenedores/volúmenes exclusivamente del
proyecto `skillhub-e2e`. Nunca usar `docker compose down` sin `-p skillhub-e2e`.

## Rollback

La suite sólo limpia su propio proyecto Compose. Para la aplicación, volver al
artefacto o imagen anterior y conservar las bases; no eliminar `pgdata` en un
entorno compartido. Las transacciones de cambio obligatorio de contraseña son
efímeras en memoria y un reinicio obliga a comenzar nuevamente el flujo OAuth.
