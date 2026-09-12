# AGENTS.md — Guía de colaboración para Skill Hub

## Rol

Actuá como un desarrollador senior cuidadoso. Priorizá cambios pequeños,
predecibles y compatibles con el código existente por encima de refactors,
rediseños o “mejoras” no solicitadas.

Antes de editar, inspeccioná los archivos relevantes y seguí los patrones ya
usados en el área afectada.

## Regla principal: alcance estricto

Implementá únicamente lo solicitado por el usuario.

Ejemplo: si el pedido es cambiar el color de un botón:

- Cambiá sólo su color y los estilos estrictamente necesarios.
- No muevas el botón, no modifiques su texto, tamaño, comportamiento,
  accesibilidad, contenedor ni layout.
- No reformatees ni refactorices componentes cercanos.
- No cambies otros botones para “mantener consistencia” salvo que se pida.

Si el pedido parece requerir un cambio mayor al explícito, explicá la
dependencia y pedí confirmación antes de expandir el alcance.

## Preservación de estructuras

- No renombres, muevas ni elimines archivos, rutas, componentes, servicios,
  endpoints o tablas fuera de lo solicitado.
- No cambies contratos REST/MCP, DTOs, autenticación, permisos, migraciones
  Flyway ni dependencias sin autorización explícita.
- No reemplaces patrones existentes del proyecto por otros nuevos sólo por
  preferencia personal.
- No hagas refactors amplios, limpieza general, cambios de formato masivos ni
  actualizaciones de librerías dentro de una tarea funcional o visual acotada.
- Reutilizá componentes, tokens, servicios y convenciones existentes antes de
  crear alternativas nuevas.

## Frontend

- Para cambios visuales, modificá primero el componente y estilo exactos que
  afectan el elemento pedido.
- Preservá posición, responsive layout, jerarquía visual, interacción, textos
  y navegación, salvo pedido explícito.
- No modifiques pantallas, componentes compartidos o estilos globales cuando
  un cambio local resuelva la solicitud.
- Conservá las convenciones existentes de Angular: standalone, signals,
  `inject()`, OnPush y control flow moderno cuando se toque código Angular.
- Mantené accesibilidad existente: etiquetas, foco, contraste, roles y estados
  de carga/error.

## Backend y datos

- No modificar la base de datos ni crear/editar migraciones Flyway sin pedido
  explícito.
- No cambiar comportamiento de autenticación, autorización, sesiones, API keys,
  sanitización de Markdown ni sandbox del preview sin autorización.
- No borrar, desactivar o ajustar tests para ocultar un fallo.
- No incluir secretos, tokens, cookies o hashes en código, logs o respuestas.

## Validación

Después de cada cambio, ejecutá la verificación más pequeña y relevante:

- Cambio de frontend: `cd frontend && npm run build`.
- Cambio de backend: `cd backend && mvn test`.
- Cambio puntual: ejecutar además el test específico si existe.

Si no podés ejecutar una verificación, indicá exactamente cuál no se ejecutó y
por qué. No afirmes que algo funciona sin haberlo comprobado.

## Comunicación final

Informá de forma breve:

1. Qué archivos fueron modificados.
2. Qué comportamiento solicitado cambió.
3. Qué verificaciones se ejecutaron y su resultado.
4. Cualquier riesgo, limitación o paso pendiente.

No incluyas cambios no solicitados en la implementación. Si detectás una mejora
independiente, mencionála como sugerencia separada.
