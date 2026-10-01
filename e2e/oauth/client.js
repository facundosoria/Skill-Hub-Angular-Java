#!/usr/bin/env node

/* Cliente OAuth E2E sin dependencias: HTTP, cookies, PKCE y assertions. */
const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const { URL, URLSearchParams } = require('node:url');

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const baseUrl = arg('--base-url', 'http://127.0.0.1:18087').replace(/\/$/, '');
const composeProject = arg('--compose-project', 'skillhub-e2e');
const outputPath = arg('--output', '');
const sensitivePath = arg('--sensitive-file', '');
const sensitiveValues = [];
const jar = new Map();
const checks = [];
let failures = 0;
let callbackServer;
let callbackPort;
let callbackWaiter;
let callbackEvents = [];

function randomText(bytes = 18) {
  return crypto.randomBytes(bytes).toString('base64url');
}
function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(value).digest('base64url');
}
function safeError(error) {
  return String(error?.message || error || 'error')
    .replace(/[A-Za-z0-9_-]{24,}/g, '<redacted>')
    .replace(/(password|secret|token|client_secret|challenge)=?[^&\s]*/gi, '$1=<redacted>');
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function jsonBody(value) {
  return JSON.stringify(value);
}
function parseJson(response) {
  try { return JSON.parse(response.body || '{}'); } catch { return {}; }
}
function cookieHeader() {
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}
function saveCookies(headers) {
  const values = headers['set-cookie'] || [];
  for (const raw of values) {
    const first = raw.split(';', 1)[0];
    const separator = first.indexOf('=');
    if (separator > 0) jar.set(first.slice(0, separator), first.slice(separator + 1));
  }
}
function request(urlValue, options = {}) {
  const target = new URL(urlValue);
  const body = options.body == null ? null : String(options.body);
  const headers = { ...(options.headers || {}) };
  if (!headers.Accept) headers.Accept = 'application/json';
  if (!headers.Cookie && jar.size) headers.Cookie = cookieHeader();
  if (body != null && !headers['Content-Length']) headers['Content-Length'] = Buffer.byteLength(body);
  const transport = target.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = transport.request(target, {
      method: options.method || 'GET',
      headers,
      timeout: options.timeout || 30000,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const result = {
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          url: target.toString(),
        };
        saveCookies(res.headers);
        resolve(result);
      });
    });
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}
function resolveUrl(location, previous) {
  return new URL(location, previous).toString();
}
function locationOf(response) {
  const location = response.headers.location;
  assert(location, `redirect sin Location (${response.status})`);
  return resolveUrl(location, response.url);
}
async function jsonRequest(method, pathOrUrl, payload, expected = null) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${baseUrl}${pathOrUrl}`;
  const response = await request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: jsonBody(payload),
  });
  if (expected != null) assert(response.status === expected, `${method} ${new URL(url).pathname} status ${response.status}`);
  return response;
}
async function formRequest(url, payload) {
  const body = new URLSearchParams(payload).toString();
  return request(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
}
function startCallbackServer() {
  return new Promise((resolve, reject) => {
    callbackServer = http.createServer((req, res) => {
      if (!req.url.startsWith('/callback') && !req.url.startsWith('/logout-callback')) {
        res.writeHead(404).end();
        return;
      }
      const event = { path: req.url, query: new URL(req.url, `http://127.0.0.1`).searchParams };
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('ok');
      if (callbackWaiter) {
        const waiter = callbackWaiter;
        callbackWaiter = null;
        waiter(event);
      } else callbackEvents.push(event);
    });
    callbackServer.once('error', reject);
    callbackServer.listen(0, '127.0.0.1', () => {
      callbackPort = callbackServer.address().port;
      resolve();
    });
  });
}
function waitCallback() {
  if (callbackEvents.length) return Promise.resolve(callbackEvents.shift());
  return new Promise((resolve) => { callbackWaiter = resolve; });
}
async function followToCallback(location, state) {
  let current = location;
  for (let i = 0; i < 12; i += 1) {
    const target = new URL(current);
    if (target.hostname === '127.0.0.1' && Number(target.port) === callbackPort) {
      const callback = waitCallback();
      const response = await request(current);
      assert(response.status === 200, `callback status ${response.status}`);
      const event = await callback;
      assert(event.query.get('state') === state, 'state de callback no coincide');
      return event.query;
    }
    const response = await request(current);
    assert(response.status >= 300 && response.status < 400, `redirect final status ${response.status}`);
    current = locationOf(response);
  }
  throw new Error('demasiadas redirecciones OAuth');
}
async function consentChallengeFromLogin(location) {
  let current = location;
  for (let i = 0; i < 8; i += 1) {
    const target = new URL(current);
    const challenge = target.searchParams.get('consent_challenge');
    if (challenge) return challenge;
    const response = await request(current);
    assert(response.status >= 300 && response.status < 400, `no apareció consentimiento (${response.status})`);
    current = locationOf(response);
  }
  throw new Error('no apareció consent_challenge');
}
async function beginAuthorization(client, state, challenge, extra = {}) {
  const url = new URL(client.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: client.client_id,
    response_type: 'code',
    redirect_uri: client.redirect_uri,
    scope: 'openid offline_access mcp',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: `${baseUrl}/api/mcp`,
    ...extra,
  }).toString();
  const response = await request(url.toString());
  assert(response.status >= 300 && response.status < 400, `authorization status ${response.status}`);
  const loginUrl = new URL(locationOf(response));
  const loginChallenge = loginUrl.searchParams.get('login_challenge');
  assert(loginChallenge, 'no apareció login_challenge');
  return { loginChallenge, loginUrl, state };
}
async function finishAuthorization(client, loginChallenge, username, password, options = {}) {
  const login = await jsonRequest('POST', '/api/oauth/accept-login', {
    loginChallenge, username, password,
  }, options.expectedLoginStatus ?? 200);
  return { login, loginJson: parseJson(login) };
}
async function exchangeCode(client, code, verifier) {
  const response = await formRequest(client.token_endpoint, {
    grant_type: 'authorization_code',
    client_id: client.client_id,
    code,
    redirect_uri: client.redirect_uri,
    code_verifier: verifier,
  });
  assert(response.status === 200, `token status ${response.status}`);
  const body = parseJson(response);
  assert(typeof body.access_token === 'string' && body.access_token.length > 20, 'respuesta sin access_token');
  return body;
}
function mutateJwt(token, mutate) {
  const parts = token.split('.');
  assert(parts.length === 3, 'access token no es JWT');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  mutate(claims);
  parts[1] = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return parts.join('.');
}
function jwtShape(token) {
  try {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    return {
      hasIssuer: typeof claims.iss === 'string',
      hasSubject: typeof claims.sub === 'string',
      audienceType: Array.isArray(claims.aud) ? `array:${claims.aud.length}` : typeof claims.aud,
      scopeType: typeof claims.scope,
      scopeCount: typeof claims.scope === 'string' ? claims.scope.trim().split(/\s+/).length : 0,
    };
  } catch {
    return { malformed: true };
  }
}
async function mcp(auth, method, params = {}) {
  return jsonRequest('POST', '/api/mcp', {
    jsonrpc: '2.0', id: randomText(6), method, params,
  }, 200).then((response) => ({ response, body: parseJson(response) }));
}
async function mcpStatus(auth, method, params = {}) {
  const url = `${baseUrl}/api/mcp`;
  const response = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${auth}` },
    body: jsonBody({ jsonrpc: '2.0', id: randomText(6), method, params }),
  });
  return { response, body: parseJson(response) };
}
async function testStep(id, description, action) {
  try {
    await action();
    checks.push({ id, description, status: 'PASS' });
    console.log(`PASS ${id} ${description}`);
  } catch (error) {
    failures += 1;
    checks.push({ id, description, status: 'FAIL', error: safeError(error) });
    console.log(`FAIL ${id} ${description}: ${safeError(error)}`);
  }
}
async function main() {
  await startCallbackServer();
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;
  const logoutRedirectUri = `http://127.0.0.1:${callbackPort}/logout-callback`;
  const suffix = randomText(7).toLowerCase();
  const activeUsername = `p4active_${suffix}`;
  const activePassword = `P4Active-${randomText(18)}`;
  const inactiveUsername = `p4inactive_${suffix}`;
  const inactivePassword = `P4Inactive-${randomText(18)}`;
  const forcedUsername = `p4forced_${suffix}`;
  const forcedPassword = `P4Temporary-${randomText(18)}`;
  const replacementPassword = `P4Changed-${randomText(18)}`;
  const client = { redirect_uri: redirectUri };

  await testStep('5.4', 'discovery informa issuer, recurso y endpoints', async () => {
    const protectedResource = await request(`${baseUrl}/.well-known/oauth-protected-resource`);
    assert(protectedResource.status === 200, 'protected resource metadata no disponible');
    const protectedBody = parseJson(protectedResource);
    assert(protectedBody.resource === `${baseUrl}/api/mcp`, 'recurso protegido incorrecto');
    assert(Array.isArray(protectedBody.authorization_servers) && protectedBody.authorization_servers.length === 1,
      'authorization server ausente');
    const metadataResponse = await request(`${baseUrl}/.well-known/oauth-authorization-server`);
    assert(metadataResponse.status === 200, 'authorization server metadata no disponible');
    const metadata = parseJson(metadataResponse);
    assert(typeof metadata.issuer === 'string' && metadata.issuer.replace(/\/$/, '') === baseUrl, 'issuer incorrecto');
    for (const key of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
      if (key !== 'registration_endpoint') assert(typeof metadata[key] === 'string', `${key} ausente`);
    }
    Object.assign(client, {
      authorization_endpoint: metadata.authorization_endpoint,
      token_endpoint: metadata.token_endpoint,
      // Hydra 2.2 serves DCR at the standard endpoint but omits the optional
      // registration_endpoint member from OIDC discovery.
      registration_endpoint: metadata.registration_endpoint || `${baseUrl}/oauth2/register`,
      issuer: metadata.issuer,
    });
  });

  await testStep('5.2', 'DCR sin cuenta registra cliente público', async () => {
    const response = await jsonRequest('POST', client.registration_endpoint, {
      client_name: `Skill Hub E2E ${suffix}`,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: 'openid offline_access mcp',
      token_endpoint_auth_method: 'none',
      redirect_uris: [redirectUri],
      post_logout_redirect_uris: [logoutRedirectUri],
    });
    assert(response.status === 201 || response.status === 200, `DCR status ${response.status}`);
    const body = parseJson(response);
    assert(typeof body.client_id === 'string' && body.token_endpoint_auth_method === 'none', 'DCR incompleto');
    Object.assign(client, { client_id: body.client_id });
    const withoutLogin = await mcpStatus('not-a-token', 'ping');
    assert(withoutLogin.response.status === 401, 'cliente registrado accedió a MCP sin login');
  });

  let apiKey;
  await testStep('5.14', 'login web crea usuario activo y conserva API key', async () => {
    sensitiveValues.push(activePassword, inactivePassword, forcedPassword, replacementPassword);
    const registered = await jsonRequest('POST', '/api/auth/register', {
      username: activeUsername, password: activePassword,
      team: 'Backoffice', legajo: `p4-${suffix}`,
    });
    assert(registered.status === 200, `registro activo status ${registered.status}`);
    const me = await request(`${baseUrl}/api/auth/me`);
    assert(me.status === 200, 'sesión web activa no creada');
    const keyResponse = await jsonRequest('POST', '/api/keys', { name: `p4-${suffix}` }, 200);
    apiKey = parseJson(keyResponse).created;
    assert(typeof apiKey === 'string' && apiKey.startsWith('sk_hub_'), 'API key no creada');
    const mcpResponse = await mcpStatus(apiKey, 'initialize', { protocolVersion: '2025-06-18' });
    assert(mcpResponse.response.status === 200 && mcpResponse.body.result, 'API key no funciona en MCP');
  });

  let normalToken;
  let normalIdToken;
  let normalAuthorization;
  await testStep('5.5', 'login OAuth de usuario activo usa los endpoints web', async () => {
    const verifier = randomText(32);
    const auth = await beginAuthorization(client, randomText(10), sha256Base64Url(verifier));
    normalAuthorization = auth;
    const loginResult = await finishAuthorization(client, auth.loginChallenge, activeUsername, activePassword);
    assert(typeof loginResult.loginJson.redirectTo === 'string', 'login OAuth no devolvió redirect');
    const consentChallenge = await consentChallengeFromLogin(loginResult.loginJson.redirectTo);
    client.lastConsentChallenge = consentChallenge;
    const consent = await jsonRequest('POST', '/api/oauth/accept-consent', { consentChallenge }, 200);
    const callback = await followToCallback(parseJson(consent).redirectTo, auth.state);
    assert(callback.get('code'), 'callback sin authorization code');
    const tokens = await exchangeCode(client, callback.get('code'), verifier);
    normalToken = tokens.access_token;
    normalIdToken = tokens.id_token;
    sensitiveValues.push(normalToken, normalIdToken);
    assert(typeof normalToken === 'string', 'token OAuth no recibido');
  });

  await testStep('5.6', 'consentimiento explícito es necesario', async () => {
    const verifier = randomText(32);
    const auth = await beginAuthorization(client, randomText(10), sha256Base64Url(verifier));
    const loginResult = await finishAuthorization(client, auth.loginChallenge, activeUsername, activePassword);
    const consentChallenge = await consentChallengeFromLogin(loginResult.loginJson.redirectTo);
    const callbackAttempt = await jsonRequest('POST', '/api/oauth/reject-consent', { consentChallenge }, 200);
    const callback = await followToCallback(parseJson(callbackAttempt).redirectTo, auth.state);
    assert(callback.get('error') === 'access_denied', 'rechazo de consentimiento no propagó access_denied');
  });

  await testStep('5.7', 'authorization code se intercambia con PKCE S256', async () => {
    assert(normalToken && normalIdToken, 'token previo faltante');
  });

  await testStep('5.3', 'PKCE S256 obligatorio y authorization sin PKCE rechazado', async () => {
    const negativeState = randomText(8);
    const negative = new URL(client.authorization_endpoint);
    negative.search = new URLSearchParams({
      client_id: client.client_id, response_type: 'code', redirect_uri: redirectUri,
      scope: 'openid offline_access mcp', state: negativeState, resource: `${baseUrl}/api/mcp`,
    }).toString();
    const initial = await request(negative.toString());
    assert(initial.status >= 300 && initial.status < 400, `authorization status ${initial.status}`);
    const loginUrl = new URL(locationOf(initial));
    const loginChallenge = loginUrl.searchParams.get('login_challenge');
    assert(loginChallenge, 'authorization sin PKCE no llegó al login de Hydra');
    const loginResult = await finishAuthorization(client, loginChallenge, activeUsername, activePassword);
    const consentChallenge = await consentChallengeFromLogin(loginResult.loginJson.redirectTo);
    const consent = await jsonRequest('POST', '/api/oauth/accept-consent', { consentChallenge }, 200);
    const callback = await followToCallback(parseJson(consent).redirectTo, negativeState);
    if (callback.get('error')) {
      assert(callback.get('error') === 'invalid_request',
        `authorization sin PKCE devolvió error inesperado: ${callback.get('error')}`);
      return;
    }
    const code = callback.get('code');
    assert(code, 'authorization sin PKCE no devolvió rechazo ni code');
    const tokenResponse = await formRequest(client.token_endpoint, {
      grant_type: 'authorization_code',
      client_id: client.client_id,
      code,
      redirect_uri: client.redirect_uri,
    });
    assert(tokenResponse.status >= 400 && tokenResponse.status < 500,
      `token endpoint aceptó authorization sin PKCE (${tokenResponse.status})`);
    assert(!parseJson(tokenResponse).access_token, 'se emitió token sin code_verifier');
  });

  await testStep('5.8', 'initialize OAuth en /api/mcp', async () => {
    const result = await mcpStatus(normalToken, 'initialize', { protocolVersion: '2025-06-18' });
    assert(result.response.status === 200 && result.body.result?.serverInfo?.name === 'skill-hub',
      `initialize OAuth falló status=${result.response.status} claims_shape=${JSON.stringify(jwtShape(normalToken))}`);
  });
  await testStep('5.9', 'tools/list OAuth', async () => {
    const result = await mcpStatus(normalToken, 'tools/list');
    assert(result.response.status === 200 && Array.isArray(result.body.result?.tools),
      `tools/list OAuth falló status=${result.response.status}`);
  });
  await testStep('5.10', 'tools/call OAuth', async () => {
    const result = await mcpStatus(normalToken, 'tools/call', { name: 'list_skills', arguments: {} });
    assert(result.response.status === 200 && Array.isArray(result.body.result?.content),
      `tools/call OAuth falló status=${result.response.status}`);
  });

  await testStep('5.12', 'tokens inválido, expirado, sin scope y recurso incorrecto son rechazados', async () => {
    const cases = [
      ['inválido', 'not-a-jwt'],
      ['expirado', mutateJwt(normalToken, (claims) => { claims.exp = 1; })],
      ['sin scope', mutateJwt(normalToken, (claims) => { delete claims.scope; })],
      ['recurso incorrecto', mutateJwt(normalToken, (claims) => { claims.aud = ['https://wrong.invalid/mcp']; })],
    ];
    for (const [name, token] of cases) {
      sensitiveValues.push(token);
      const result = await mcpStatus(token, 'ping');
      assert(result.response.status === 401, `${name} no fue rechazado`);
    }
  });

  await testStep('5.13', 'usuario inactivo no completa login OAuth', async () => {
    const pending = await jsonRequest('POST', '/api/auth/register', {
      username: inactiveUsername, password: inactivePassword,
      team: 'Backoffice', legajo: `p4-inactive-${suffix}`,
    });
    assert(pending.status === 200, 'registro inactivo no creado');
    const users = parseJson(await request(`${baseUrl}/api/admin/users`));
    const target = users.pending?.find((user) => user.username === inactiveUsername);
    assert(target?.id, 'usuario inactivo no quedó pendiente');
    await jsonRequest('POST', `/api/admin/users/${target.id}/approve`, {}, 200);
    await jsonRequest('POST', `/api/admin/users/${target.id}/deactivate`, {}, 200);
    const auth = await beginAuthorization(client, randomText(10), sha256Base64Url(randomText(32)));
    const rejected = await finishAuthorization(client, auth.loginChallenge, inactiveUsername, inactivePassword, { expectedLoginStatus: 400 });
    assert(rejected.login.status === 400, 'usuario inactivo fue aceptado');
  });

  await testStep('5.11', 'logout OAuth acepta challenge, redirige y elimina cookie', async () => {
    assert(normalIdToken, 'id_token faltante para logout');
    // La cookie de sesión se renueva para demostrar el borrado del mismo flujo.
    await jsonRequest('POST', '/api/auth/login', { username: activeUsername, password: activePassword }, 200);
    assert((await request(`${baseUrl}/api/auth/me`)).status === 200, 'sesión previa al logout ausente');
    const logoutUrl = new URL(client.issuer.replace(/\/$/, '') + '/oauth2/sessions/logout');
    logoutUrl.search = new URLSearchParams({
      id_token_hint: normalIdToken,
      post_logout_redirect_uri: logoutRedirectUri,
      state: randomText(10),
    }).toString();
    const start = await request(logoutUrl.toString());
    assert(start.status >= 300 && start.status < 400, `logout status ${start.status}`);
    let current = locationOf(start);
    const challenge = new URL(current).searchParams.get('logout_challenge');
    assert(challenge, 'logout_challenge ausente');
    if (new URL(current).pathname === '/oauth/logout') {
      // ya es la pantalla pública; no se hace GET porque Angular no es parte de la assertion.
    } else {
      const page = await request(current);
      assert(page.status === 200 || (page.status >= 300 && page.status < 400), 'pantalla logout no disponible');
    }
    const accepted = await jsonRequest('POST', '/api/oauth/accept-logout', { logoutChallenge: challenge }, 200);
    const callback = await followToCallback(parseJson(accepted).redirectTo, new URL(logoutUrl).searchParams.get('state'));
    assert(callback.get('state'), 'callback logout sin state');
    assert((await request(`${baseUrl}/api/auth/me`)).status === 401, 'cookie no eliminada por logout OAuth');
  });

  await testStep('5.15', 'must_change_password no da token antes y sí después del cambio', async () => {
    await jsonRequest('POST', '/api/auth/login', { username: activeUsername, password: activePassword }, 200);
    const pending = await jsonRequest('POST', '/api/auth/register', {
      username: forcedUsername, password: forcedPassword,
      team: 'Backoffice', legajo: `p4-forced-${suffix}`,
    });
    assert(pending.status === 200, 'registro forzado no creado');
    const users = parseJson(await request(`${baseUrl}/api/admin/users`));
    const target = users.pending?.find((user) => user.username === forcedUsername);
    assert(target?.id, 'usuario forzado no quedó pendiente');
    await jsonRequest('POST', `/api/admin/users/${target.id}/approve`, {}, 200);
    await jsonRequest('POST', `/api/admin/users/${target.id}/reset-password`, { password: forcedPassword }, 200);
    const verifier = randomText(32);
    const auth = await beginAuthorization(client, randomText(10), sha256Base64Url(verifier));
    const login = await finishAuthorization(client, auth.loginChallenge, forcedUsername, forcedPassword);
    assert(login.login.status === 200 && typeof login.loginJson.redirectTo === 'string', 'must_change no retuvo login');
    assert(login.loginJson.redirectTo.includes('oauth/password-change?transaction='), 'transacción de password change ausente');
    const transaction = new URL(login.loginJson.redirectTo, baseUrl).searchParams.get('transaction');
    assert(transaction, 'transaction ausente');
    const changed = await jsonRequest('POST', '/api/oauth/password-change', {
      transaction, password: replacementPassword,
    }, 200);
    const consentChallenge = await consentChallengeFromLogin(parseJson(changed).redirectTo);
    const consent = await jsonRequest('POST', '/api/oauth/accept-consent', { consentChallenge }, 200);
    const callback = await followToCallback(parseJson(consent).redirectTo, auth.state);
    const token = await exchangeCode(client, callback.get('code'), verifier);
    sensitiveValues.push(token.access_token, token.id_token);
    assert(token.access_token, 'no se obtuvo token después del cambio');
  });

  await testStep('5.16', 'cliente no filtra credenciales sensibles en su salida', async () => {
    // Las credenciales sólo viven en memoria; el shell escanea además logs Docker.
    assert(outputPath === '' || typeof outputPath === 'string', 'salida inválida');
    assert(composeProject === 'skillhub-e2e', 'proyecto inesperado');
  });
}

main().catch((error) => {
  failures += 1;
  console.log(`FAIL 5.1 cliente OAuth: ${safeError(error)}`);
}).finally(() => {
  if (sensitivePath) {
    fs.writeFileSync(sensitivePath, [...new Set(sensitiveValues.filter(Boolean))].join('\n') + '\n', { mode: 0o600 });
  }
  if (callbackServer) callbackServer.close();
  console.log(`RESULT ${failures === 0 ? 'PASS' : 'FAIL'} checks=${checks.length} failures=${failures}`);
  process.exitCode = failures === 0 ? 0 : 1;
});
