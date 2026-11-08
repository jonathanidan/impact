// Morning calls this after a successful payment (notifyUrl). Morning doesn't sign webhooks,
// so the secret NOTIFY_KEY in the address is what proves the call came from our own setup.
import { getStore } from '@netlify/blobs';

export default async (req) => {
  const url = new URL(req.url);
  const key = url.searchParams.get('key') || '';
  if (!process.env.NOTIFY_KEY || key !== process.env.NOTIFY_KEY) return new Response('forbidden', { status: 403 });
  const orderId = url.searchParams.get('order') || '';
  if (!/^B-[A-Z0-9]{6}$/.test(orderId)) return new Response('bad order', { status: 400 });

  const raw = await req.text();
  let payload = {};
  try { payload = JSON.parse(raw); } catch { payload = Object.fromEntries(new URLSearchParams(raw)); }
  const find = (obj, keys) => { for (const k of keys) { if (obj?.[k]) return obj[k]; } for (const v of Object.values(obj || {})) { if (v && typeof v === 'object') { const f = find(v, keys); if (f) return f; } } return null; };

  const store = getStore('orders');
  const order = (await store.get(orderId, { type: 'json' })) || { orderId };
  order.status = 'paid';
  order.paidAt = new Date().toISOString();
  order.documentId = find(payload, ['documentId', 'document_id', 'docId']) || order.documentId || null;
  order.transactionId = find(payload, ['transactionId', 'transaction_id']) || null;
  order.notify = raw.slice(0, 4000);
  await store.setJSON(orderId, order);
  return new Response('ok');
};

export const config = { path: '/api/morning-notify' };
