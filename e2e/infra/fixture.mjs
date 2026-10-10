// Minimal, dependency-free source fixture for the isolated infra smoke stack.
//
// It plays the two sources the monitor reads:
//   * Eureka registry  -> GET /eureka/apps
//   * Actuator probes  -> GET /actuator/health and /actuator/prometheus
//
// The state is flipped through GET /_control?mode=up|down|absent|registry_error
// so the smoke can drive UP -> failure -> recovery without touching any real
// service. This file is only used by the smoke compose project and never by the
// application.
import http from 'node:http';

const state = { mode: 'up' };
const PORT = Number(process.env.FIXTURE_PORT || 8080);
const SERVICE = 'USERS-SERVICE';
const HOST = process.env.FIXTURE_HOST || 'infra-fixture';
const MGMT_PORT = String(process.env.FIXTURE_MGMT_PORT || 8080);

function eureka() {
  if (state.mode === 'absent') return { applications: {} };
  const status = state.mode === 'down' ? 'DOWN' : 'UP';
  return {
    applications: {
      application: {
        name: SERVICE,
        instance: [
          {
            instanceId: 'users-1',
            hostName: HOST,
            app: SERVICE,
            status,
            port: { $: 8080 },
            metadata: { 'management.port': MGMT_PORT },
          },
        ],
      },
    },
  };
}

function send(res, status, contentType, body) {
  res.writeHead(status, { 'content-type': contentType });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/eureka/apps')) {
    if (state.mode === 'registry_error') return send(res, 500, 'application/json', '{}');
    return send(res, 200, 'application/json', JSON.stringify(eureka()));
  }
  if (url.pathname.startsWith('/actuator/health')) {
    const status = state.mode === 'down' ? 'DOWN' : 'UP';
    return send(res, 200, 'application/json', JSON.stringify({ status }));
  }
  if (url.pathname.startsWith('/actuator/prometheus')) {
    return send(res, 200, 'text/plain', 'process_uptime_seconds 1000.0\n');
  }
  if (url.pathname.startsWith('/_control')) {
    const mode = url.searchParams.get('mode');
    if (mode) state.mode = mode;
    return send(res, 200, 'application/json', JSON.stringify(state));
  }
  return send(res, 404, 'text/plain', 'not found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[infra-fixture] listening on ${PORT}`);
});
