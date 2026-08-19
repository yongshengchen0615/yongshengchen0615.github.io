const ALLOWED_METHODS = new Set([
  'health',
  'loginWithLiff',
  'getMyCard',
  'logoutSession',
  'adminBootstrap',
  'adminSearchMembers',
  'adminGetMember',
  'adminAdjustPoints'
]);

const MAX_REQUEST_BYTES = 16 * 1024;
const MAX_BACKEND_RESPONSE_BYTES = 128 * 1024;

export default {
  async fetch(request, env) {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    try {
      assertEnv(env);

      if (request.method === 'OPTIONS') {
        return handleOptions(request, env);
      }

      if (url.pathname === '/health' && request.method === 'GET') {
        const result = await callGas(env, requestId, 'health', {});
        return jsonResponse({ ok: true, result }, 200, request, env);
      }

      if (url.pathname !== '/rpc') {
        return jsonResponse({ ok: false, error: 'Not found' }, 404, request, env);
      }

      if (request.method !== 'POST') {
        return jsonResponse({ ok: false, error: 'Method not allowed' }, 405, request, env);
      }

      const origin = request.headers.get('Origin') || '';
      if (origin !== env.ALLOWED_ORIGIN) {
        return jsonResponse({ ok: false, error: 'Origin not allowed' }, 403, request, env);
      }

      const declaredLength = Number(request.headers.get('Content-Length') || 0);
      if (declaredLength > MAX_REQUEST_BYTES) {
        return jsonResponse({ ok: false, error: 'Request too large' }, 413, request, env);
      }

      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
        return jsonResponse({ ok: false, error: 'Request too large' }, 413, request, env);
      }

      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON' }, 400, request, env);
      }

      const method = String(body.method || '');
      if (!ALLOWED_METHODS.has(method) || method === 'health') {
        return jsonResponse({ ok: false, error: 'Unsupported RPC method' }, 400, request, env);
      }

      const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
        ? body.payload
        : {};

      const result = await callGas(env, requestId, method, payload);
      return jsonResponse({ ok: true, result }, 200, request, env);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'proxy_error',
        requestId,
        message: safeLogMessage(error)
      }));
      return jsonResponse(
        { ok: false, error: error instanceof UpstreamApplicationError ? error.message : 'API 暫時無法使用' },
        error instanceof UpstreamApplicationError ? 400 : 502,
        request,
        env
      );
    }
  }
};

class UpstreamApplicationError extends Error {}

async function callGas(env, requestId, method, payload) {
  const response = await fetch(env.GAS_BACKEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8'
    },
    body: JSON.stringify({
      proxySecret: env.API_PROXY_SECRET,
      requestId,
      method,
      payload
    }),
    redirect: 'follow'
  });

  if (!response.ok) {
    throw new Error(`GAS transport failed (${response.status})`);
  }

  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BACKEND_RESPONSE_BYTES) {
    throw new Error('GAS response too large');
  }

  let data;
  try {
    data = JSON.parse(text || '{}');
  } catch {
    throw new Error('GAS returned invalid JSON');
  }

  if (!data || data.ok !== true) {
    throw new UpstreamApplicationError(String(data?.error || 'GAS request failed'));
  }

  return data.result;
}

function handleOptions(request, env) {
  const origin = request.headers.get('Origin') || '';
  if (origin !== env.ALLOWED_ORIGIN) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(env)
  });
}

function jsonResponse(body, status, request, env) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=UTF-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });

  if ((request.headers.get('Origin') || '') === env.ALLOWED_ORIGIN) {
    for (const [key, value] of Object.entries(corsHeaders(env))) headers.set(key, value);
  }

  return new Response(JSON.stringify(body), { status, headers });
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function assertEnv(env) {
  if (!/^https:\/\//.test(String(env.GAS_BACKEND_URL || ''))) {
    throw new Error('Missing GAS_BACKEND_URL');
  }
  if (!/^https:\/\//.test(String(env.ALLOWED_ORIGIN || ''))) {
    throw new Error('Missing ALLOWED_ORIGIN');
  }
  if (String(env.API_PROXY_SECRET || '').length < 32) {
    throw new Error('Missing API_PROXY_SECRET');
  }
}

function safeLogMessage(error) {
  return String(error?.message || error || 'unknown').replace(/[\r\n]/g, ' ').slice(0, 180);
}
