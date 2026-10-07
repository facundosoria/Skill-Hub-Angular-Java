# Decisiones actualizadas: nodos frontend

Este documento reemplaza la sección «Pendientes» del handoff original.

- **Key compartida:** hay una sola auth key de Tailscale para todos los grupos. Un admin la entrega y rota fuera de banda; no se almacena en el repositorio ni se implementa su distribución en la aplicación.
- **Identidad:** sólo el tag `tag:frontend-edge`, asignado por la ACL server-side, es confiable para reconocer nodos. El hostname se muestra como identidad declarada no verificada; se parsea por convención, pero no prueba identidad.
- **Estado:** el backend consulta la API de Tailscale cada 2 minutos. Los nodos con el tag se conservan en la base; los ausentes de una respuesta exitosa pasan a `OFFLINE` y nunca se borran.
- **Errores y configuración:** sin token/tailnet la fuente figura como `no_configurado` y `available` es `false`. Si falla la API, se registra el error y se conserva el estado persistido sin marcar todos los nodos como caídos.
- **Privacidad:** el DTO no expone IPs, dominios de Tailscale, IDs de dispositivos ni el token.
- **Beacons:** los beacons de build/commit quedan pospuestos; no están implementados.
