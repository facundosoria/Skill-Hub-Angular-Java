# Conectividad por Tailscale para el monitoreo de infraestructura

Cómo el backend de Skill Hub alcanza Eureka y los actuator de los micros que
**no** viven en las redes Docker de este host (los que corren en la máquina de
otro equipo). Es la pieza que falta para que `/infra` muestre datos reales; el
módulo ya sabe leer la metadata de Eureka y sondear, lo que no tiene es ruta.

## Dos rutas, y no son excluyentes

| Ruta | Sirve para | Qué requiere |
|---|---|---|
| Red Docker de la plataforma | Eureka y los micros que corren dentro de esas redes | Colgar el backend (o el sidecar) de la red externa; se acuerda con quien gobierna la plataforma |
| Tailscale (este documento) | Los micros que corren fuera de esas redes, con su propio sidecar | Key con tag propio, grants en la ACL y el overlay `docker-compose.tailscale.yml` |

En la práctica: lo que se ve por Docker se sondea por Docker, y lo que no, por
tailnet. El catálogo no distingue el modo; la allowlist sí.

## Lo que hay que crear en la tailnet

### 1. El tag

`tag:infra-monitor` **ya existe** en `tagOwners` de la política de la plataforma
(con `autogroup:admin`): no hay que crearlo. Lo que falta es la key y los grants.

Nombres reales de la política, para no inventar tags: los micros llevan
`tag:microservicio`, la plataforma `tag:plataforma` (Eureka `tcp:8761`, gateway
`:8080`, Garage `:3900`), Kafka `tag:kafka` (`:9092`), Vault `tag:vault`
(`:8200`) y el front local `tag:frontend-edge`.

### 2. La key

- **Reusable** (varios nodos pueden usarla) y **NO efímera**: los nodos con key
  efímera se eliminan cuando quedan offline, y este nodo es permanente.
- Tag: `tag:infra-monitor`.
- Expiry: la más larga posible, y **desactivar la expiración de la key del
  device** una vez que el nodo aparece, para que el colector no se caiga de la
  tailnet cada 90 días.
- Vive solo en el `.env` del host (`TS_AUTHKEY`). Nunca al repo, ni al chat.

### 3. Los grants (propuesta, la carga el admin)

    {
      "src": ["tag:infra-monitor"],
      "dst": ["tag:plataforma"],
      "ip":  ["tcp:8761"]
    },
    {
      "src": ["tag:infra-monitor"],
      "dst": ["tag:microservicio"],
      "ip": [
        "tcp:8081",  // api-gateway (app 8080)
        "tcp:8083",  // users-service (app 8082)
        "tcp:8085",  // llm-service (app 8084)
        "tcp:8087",  // course-service (app 8086)
        "tcp:8089",  // theoretical-challenge-service (app 8088)
        "tcp:8091",  // accounting-service (app 8090)
        "tcp:8093",  // sandbox-service (app 8092)
        "tcp:8095",  // practical-challenge-service (app 8094)
        "tcp:8097",  // engine-challenge-service (app 8096)
        "tcp:8099",  // backoffice-service (app 8098)
        "tcp:8101",  // market-service (app 8100)
        "tcp:8103",  // notifications-service (app 8102)
        "tcp:8011"   // roadmap-service (app 8010, fuera de la serie 80xx)
      ]
    }

Notas de por qué así y no de otra forma:

- **Solo puertos de management**, nunca los puertos de aplicación ni Vault ni el
  gateway: el colector no necesita identidad ni tráfico de negocio.
- **Uno por uno y no un rango**, aunque parezca más verboso: `notifications`
  queda en `8103` y `roadmap` en `8011`, los dos fuera de cualquier rango
  prolijo; un rango tipo `8081-8100` los dejaría afuera y además alcanzaría
  puertos de aplicación. Con la lista explícita los `deny` de los tests sí
  pueden cubrir el límite.
- **La convención es DEC-28, `management = app + 1`**, y sale del propio
  proyecto: `registry/services.yml` del `tpi-system-compose` tiene la tabla de
  puertos de aplicación, y `docker-compose.notifications.yml` declara
  `SERVER_PORT 8102` / `MANAGEMENT_PORT 8103`. No hay que derivar nada a ojo ni
  hardcodear la tabla en el módulo: en runtime sale de
  `metadata.management.port` de Eureka.
- **El destino `tag:microservicio`** cubre los micros de todos los equipos. La
  alternativa acotada es un tag de opt-in por equipo, o entradas de `hosts` por
  IP, que se rompen si el nodo se recrea y cambia de IP.

## Cómo se activa en el stack

    docker compose -p <proyecto> --env-file .env \
      -f docker-compose.yml -f docker-compose.tailscale.yml up -d

El overlay agrega el servicio `mesh` y pone al `backend` a compartir su
namespace de red. Consecuencias que hay que tener presentes:

- **El backend pasa a depender del sidecar**: si la key es inválida o la tailnet
  no está, el contenedor `mesh` no queda healthy y el backend no arranca. Por eso
  el overlay es opt-in y no está en el `docker-compose.yml` base.
- **DNS**: el overlay deja `127.0.0.11` (resolver embebido de Docker, para `db`,
  `hydra`, `web`) primero y `100.100.100.100` (MagicDNS, para nombres de la
  tailnet) segundo. Si algo no resuelve, el orden o la lista se ajusta en el
  overlay, no en el compose base.
- **Sin puertos publicados**: el sidecar solo da salida.

## Qué host de Eureka usar, y por qué no `hostName`

En el registry real conviven tres formas de `hostName` para el mismo tipo de
nodo: nombre de servicio Docker (`backoffice-service`), FQDN de la tailnet
(`course-service.tail767776.ts.net`) y **ID de contenedor** (`4b07046d4859`,
`0ae1bc485967`, vistos en `users-service` y `notifications-service`). Un ID de
contenedor no resuelve desde el namespace del sidecar: si el módulo arma el
destino con `hostName`, esos dos micros quedan en DOWN sin estarlo.

La plataforma ya resolvió esto en su propio Prometheus
(`tpi-system-compose/monitoring/prometheus.yml`, job `eureka`): descubre por
Eureka y arma el destino con **`ip_addr` + `metadata.management.port`**,
quedándose con las instancias cuyo `ip_addr` empieza en `100.` (la tailnet).
Es el precedente a copiar: el registry anuncia la IP de la tailnet porque los
micros entran con `prefer-ip-address: true` y `preferred-networks: ["100."]`.

Entonces hay dos cambios de código en el módulo, los dos chicos y con test:

1. `ProbeTargetResolver`: preferir `ip_addr` sobre `hostName` al construir el
   destino (con `hostName` como fallback para las instancias que no lo traigan).
2. Allowlist: aceptar direcciones de tailnet. Hoy acepta nombres exactos y
   comodines de sufijo; alcanza con admitir un prefijo (`100.`) o un CIDR
   (`100.64.0.0/10`), igual que el `regex: "100\\..+"` del Prometheus.

Mientras eso no esté, en `INFRA_ALLOWED_HOSTS` van las IP de tailnet de los
micros una por una (estables mientras el device exista, frágiles si se recrea).

El puerto de management tampoco se hardcodea: sale de `metadata.management.port`
de Eureka, y la allowlist de puertos lo tiene que incluir.

## Verificación cuando esté encendido

Se corre con la respuesta viva, no con la suposición:

1. `docker compose exec mesh tailscale status` → el nodo `Running` con
   `tag:infra-monitor`.
2. Resolución: desde el namespace compartido, `getent hosts db` (Docker) y
   `getent hosts tpi-plataforma.<tailnet>.ts.net` (MagicDNS) tienen que resolver.
3. `wget -qO- http://<ip-tailnet-plataforma>:8761/eureka/apps` responde el
   registry real.
4. Para un micro remoto: `wget -qO- http://<ip-tailnet-micro>:<management>/actuator/health`
   responde 200 desde el mismo namespace. Ese es el paso que confirma que el
   actuator del micro es alcanzable por tailnet y no solo el límite del ACL.
5. Control negativo: el mismo `wget` contra el puerto de **aplicación** del micro
   tiene que fallar.
6. Un micro que en Eureka aparece con `hostName` de ID de contenedor tiene que
   salir UP igual: es la prueba de que el destino se armó con `ip_addr`.
