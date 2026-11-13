// Shared helpers for talking to Morning (Green Invoice).
// All settings come from Netlify environment variables; nothing secret is in the page.

const ENV = (process.env.MORNING_ENV || 'production').toLowerCase();
export const API_BASE = process.env.MORNING_API_BASE ||
  (ENV === 'sandbox' ? 'https://sandbox.d.greeninvoice.co.il/api/v1' : 'https://api.greeninvoice.co.il/api/v1');
const AUTH_URL = process.env.MORNING_TOKEN_URL ||
  (ENV === 'sandbox' ? 'https://api.sandbox.morning.dev/idp/v1/oauth/token' : 'https://api.morning.co/idp/v1/oauth/token');

// Prices live here, on the server, so nobody can change them in the browser.
export const PRICE = 150, SHIP = 40, PER_BOX = 6, MAX_QTY = 20;
export const TEST_PRICE = 5; // 0 bottles = test payment. Turn off with ALLOW_TEST_ORDER=false.

let cached = null; // { token, exp }

export async function getToken() {
  if (cached && Date.now() < cached.exp) return cached.token;
  // trim: a space or line break copied along with the key makes Morning reject it
  const id = (process.env.MORNING_API_ID || '').trim(), secret = (process.env.MORNING_API_SECRET || '').trim();
  if (!id || !secret) throw new Error('Missing MORNING_API_ID / MORNING_API_SECRET');

  // Morning moved token issuing in 2026. Try the new OAuth endpoint, then the older one.
  // Morning's 2026 docs and real integrations disagree on the field names, so try each known form.
  const J = 'application/json', F = 'application/x-www-form-urlencoded';
  const attempts = [
    [AUTH_URL, J, { grant_type: 'client_credentials', client_id: id, client_secret: secret }],
    [AUTH_URL, J, { grant_type: 'client_credentials', id, secret }],
    [AUTH_URL, F, { grant_type: 'client_credentials', client_id: id, client_secret: secret }],
    [API_BASE + '/account/token', J, { id, secret, grant_type: 'client_credentials' }],
  ];
  const errors = [];
  for (const [url, type, body] of attempts) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': type, Accept: 'application/json' },
        body: type === J ? JSON.stringify(body) : new URLSearchParams(body).toString() });
      const d = await r.json().catch(() => ({}));
      const token = d.accessToken || d.access_token || d.token;
      if (r.ok && token) {
        cached = { token, exp: Date.now() + 50 * 60 * 1000 }; // tokens last ~1 hour
        return token;
      }
      errors.push(`${url} → ${r.status} ${d.errorMessage || d.message || d.error_description || d.error || ''}`.trim() + ` [${type === F ? 'form' : Object.keys(body).join(',')}]`);
    } catch (e) { errors.push(`${url} → ${e.message}`);
      continue; }
  }
  throw new Error(`Morning login failed (v3, ${ENV}, key id …${id.slice(-4)}): ` + errors.join(' | '));
}

export async function morning(path, { method = 'GET', body } = {}) {
  const token = await getToken();
  const r = await fetch(API_BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  // Morning can answer 2xx with success:false, so check both.
  if (!r.ok || data.success === false || data.errorCode) {
    const err = new Error(`Morning ${path} failed: ${r.status} ${data.errorCode || ''} ${data.errorMessage || data.message || ''}`.trim());
    err.details = data;
    throw err;
  }
  return data;
}

// CORS: let the Lotar WordPress page call these functions.
export function cors(req) {
  const allowed = (process.env.ALLOWED_ORIGINS || 'https://lotar-association.com,https://www.lotar-association.com')
    .split(',').map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get('origin');
  const h = { 'Vary': 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  return h;
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}

export function siteUrl(req) {
  return (process.env.SITE_URL || process.env.URL || new URL(req.url).origin).replace(/\/$/, '');
}
