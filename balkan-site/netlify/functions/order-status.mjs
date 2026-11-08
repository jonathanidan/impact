// GET /api/order-status?order=B-XXXXXX&t=<token>  → { status, receiptUrl? }
import { getStore } from '@netlify/blobs';
import { morning, cors, json } from '../lib/morning.mjs';

export default async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  const u = new URL(req.url);
  const orderId = u.searchParams.get('order') || '', t = u.searchParams.get('t') || '';
  const store = getStore('orders');
  const order = /^B-[A-Z0-9]{6}$/.test(orderId) ? await store.get(orderId, { type: 'json' }) : null;
  if (!order || !order.token || order.token !== t) return json({ error: 'not found' }, 404, h);
  if (order.status !== 'paid') return json({ status: order.status }, 200, h);
  if (order.receiptUrl) return json({ status: 'paid', receiptUrl: order.receiptUrl }, 200, h);
  if (!order.documentId) return json({ status: 'paid' }, 200, h);
  try {
    const d = await morning(`/documents/${encodeURIComponent(order.documentId)}/download/links`);
    const receiptUrl = d.he || d.origin || d.en || (typeof d.url === 'string' ? d.url : null);
    if (receiptUrl) { order.receiptUrl = receiptUrl; await store.setJSON(orderId, order); }
    return json({ status: 'paid', receiptUrl }, 200, h);
  } catch (e) {
    console.error(e.message);
    return json({ status: 'paid' }, 200, h);
  }
};

export const config = { path: '/api/order-status' };
