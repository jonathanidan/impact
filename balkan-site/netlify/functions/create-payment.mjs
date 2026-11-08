// POST /api/create-payment
// Validates the order, recalculates the price, and asks Morning for a payment form with the buyer's details filled in.
import { getStore } from '@netlify/blobs';
import { morning, cors, json, siteUrl, PRICE, SHIP, PER_BOX, MAX_QTY, TEST_PRICE } from '../lib/morning.mjs';

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

function validIsraeliId(v) {
  if (!/^\d{5,9}$/.test(v)) return false;
  const s = v.padStart(9, '0'); let t = 0;
  for (let i = 0; i < 9; i++) { const d = +s[i] * (i % 2 + 1); t += d > 9 ? d - 9 : d; }
  return t % 10 === 0;
}

export default async (req) => {
  const h = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, h);

  let b;
  try { b = await req.json(); } catch { return json({ error: 'בקשה לא תקינה' }, 400, h); }

  const qty = parseInt(b.qty, 10);
  const o = {
    name: clean(b.name, 80), email: clean(b.email, 100), phone: clean(b.phone, 20),
    taxId: clean(b.taxId, 9), city: clean(b.city, 60), address: clean(b.address, 140), notes: clean(b.notes, 300),
  };
  const phone = o.phone.replace(/[\s\-()]/g, '').replace(/^\+?972/, '0');
  const allowTest = process.env.ALLOW_TEST_ORDER !== 'false';
  if (!Number.isInteger(qty) || qty < (allowTest ? 0 : 1) || qty > MAX_QTY) return json({ error: 'כמות לא תקינה' }, 400, h);
  if (o.name.length < 2) return json({ error: 'נא למלא שם מלא או שם חברה' }, 400, h);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(o.email)) return json({ error: 'נא למלא מייל תקין' }, 400, h);
  if (!/^0\d{8,9}$/.test(phone)) return json({ error: 'נא למלא מספר טלפון ישראלי תקין' }, 400, h);
  if (!validIsraeliId(o.taxId)) return json({ error: 'נא למלא ת״ז / ח״פ תקין' }, 400, h);
  if (o.city.length < 2 || o.address.length < 3) return json({ error: 'נא למלא כתובת מלאה' }, 400, h);

  const isTest = qty === 0;
  const boxes = isTest ? 0 : Math.ceil(qty / PER_BOX);
  const total = isTest ? TEST_PRICE : qty * PRICE + boxes * SHIP;
  const rand = crypto.randomUUID().replace(/-/g, '');
  const orderId = 'B-' + rand.slice(0, 6).toUpperCase();
  const token = crypto.randomUUID();
  const site = siteUrl(req);
  const back = `${site}/thanks.html?order=${orderId}&t=${token}`;
  const vatType = Number(process.env.MORNING_VAT_TYPE ?? 1); // 1 = prices include VAT; 2 = exempt

  const body = {
    description: `וויסקי בלקין · ${isTest ? 'הזמנת בדיקה' : 'הזמנה'} ${orderId}`,
    type: Number(process.env.MORNING_DOC_TYPE || 400), // 400 = קבלה (עמותה). 320 = חשבונית מס קבלה.
    lang: 'he',
    currency: 'ILS',
    vatType,
    amount: total,
    maxPayments: 1,
    client: {
      name: o.name, emails: [o.email], phone, address: o.address, city: o.city, country: 'IL',
      taxId: o.taxId, add: true,
    },
    remarks: [`מספר הזמנה: ${orderId}`, `משלוח: ${o.address}, ${o.city} · טל׳ ${phone}`, o.notes ? `הערות: ${o.notes}` : ''].filter(Boolean).join('\n'),
    successUrl: back + '&status=success',
    failureUrl: back + '&status=failure',
    notifyUrl: `${site}/api/morning-notify?order=${orderId}&key=${encodeURIComponent(process.env.NOTIFY_KEY || '')}`,
    custom: orderId,
  };
  if (process.env.MORNING_SEND_INCOME !== 'false') {
    body.income = isTest
      ? [{ description: 'הזמנת בדיקה · וויסקי בלקין', quantity: 1, price: TEST_PRICE, currency: 'ILS', vatType }]
      : [
          { description: 'וויסקי בלקין · M&H סינגל מאלט 700 מ״ל', quantity: qty, price: PRICE, currency: 'ILS', vatType },
          { description: `משלוח עד הבית (חבילה של עד ${PER_BOX} בקבוקים)`, quantity: boxes, price: SHIP, currency: 'ILS', vatType },
        ];
  }
  if (process.env.MORNING_PLUGIN_ID) body.pluginId = process.env.MORNING_PLUGIN_ID;
  if (process.env.MORNING_GROUP) body.group = Number(process.env.MORNING_GROUP);

  const store = getStore('orders');
  try {
    const d = await morning('/payments/form', { method: 'POST', body });
    const url = typeof d.url === 'string' ? d.url : (d.url?.he || d.url?.origin);
    if (!url) throw new Error('Morning returned no payment URL');
    await store.setJSON(orderId, { orderId, token, status: 'pending', test: isTest, created: new Date().toISOString(), qty, boxes, total, ...o, phone });
    return json({ orderId, token, url, total }, 200, h);
  } catch (e) {
    console.error(e.message, JSON.stringify(e.details || {}));
    await store.setJSON(orderId, { orderId, status: 'error', created: new Date().toISOString(), error: e.message, qty, total, ...o, phone }).catch(() => {});
    return json({ error: 'לא הצלחנו ליצור את התשלום. נסו שוב בעוד רגע, או התקשרו לדניאל: 054-345-1232.', debug: process.env.SHOW_DEBUG === 'true' ? e.message : undefined }, 502, h);
  }
};

export const config = { path: '/api/create-payment' };
