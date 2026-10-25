# 0011. Política de testing: coverage mínimo de 90 % con JaCoCo `check` y umbral de vitest

- **Estado:** Propuesto (pasa a Aceptado cuando se mergee el trabajo de coverage de backend y frontend)
- **Fecha:** 2026-10-25

## Contexto

El backend tiene tests de integración con Testcontainers sobre Postgres real
(`McpIntegrationTest`, `RestApiIntegrationTest`, tests de OAuth,
`DepMapIntegrationTest`, `LanguageDetectorTest`) y una suite E2E de OAuth
(`scripts/test-hydra-oauth.sh`). JaCoCo se agregó al `backend/pom.xml` en el
commit `699c0f3` sólo para **reportar** cobertura (`target/site/jacoco`), sin
umbral. El frontend usa el builder `@angular/build:unit-test` con vitest
(`npm test`), también sin umbral.

[AGENTS.md](../../AGENTS.md) ya exige `mvn test` / `npm run build` después de
cada cambio y prohíbe borrar o ajustar tests para ocultar un fallo.

## Decisión

- Coverage mínimo de **90 %** en backend y frontend.
- **Backend:** agregar la ejecución `check` de `jacoco-maven-plugin` con regla
  de 90 %, de modo que `mvn verify` (o la fase que se defina) falle por debajo.
- **Frontend:** configurar el umbral de cobertura de vitest en 90 % para que
  `npm test` con coverage falle por debajo.
- El trabajo se está haciendo en paralelo en otras sesiones; este ADR registra
  la intención y debe actualizarse con la configuración real (métrica: líneas,
  ramas o instrucciones; exclusiones; fase de Maven) cuando se mergee.

## Alternativas consideradas

- **Sólo reportar cobertura sin umbral** (estado actual): no evita regresiones.
- **Umbral menor (70–80 %):** *Razón no registrada — confirmar* por qué 90 %.

## Consecuencias

- Los cambios que bajen la cobertura rompen el build local.
- Sin CI ([0010](0010-deploy-con-rebuild-app-y-backups.md)), el umbral sólo se
  aplica si alguien corre la verificación antes de desplegar. *Confirmar* si
  `rebuild-app.sh` o algún hook va a ejecutarla.
- Hay que definir y documentar exclusiones (DTOs, configuración, código
  generado) para que el 90 % mida código con lógica.

## Referencias

- `backend/pom.xml` (plugin `jacoco-maven-plugin` 0.8.12), commit `699c0f3`.
- `frontend/package.json` (`vitest`), `frontend/angular.json` (target `test`).
- [AGENTS.md](../../AGENTS.md) — sección "Validación".
