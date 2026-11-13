// GET /api/morning-info?key=<NOTIFY_KEY>
// Diagnostic: shows which payment terminals (plugins) Morning sees on this account and whether they're approved for websites.
import { morning, json, API_BASE } from '../lib/morning.mjs';

export default async (req) => {
  const u = new URL(req.url);
  if (!process.env.NOTIFY_KEY || u.searchParams.get('key') !== process.env.NOTIFY_KEY) return json({ error: 'forbidden' }, 403);
  const type = Number(process.env.MORNING_DOC_TYPE || 400);
  const out = { env: process.env.MORNING_ENV || 'production', apiBase: API_BASE, docType: type };
  try {
    const info = await morning(`/documents/info?type=${type}`);
    out.paymentPlugins = info.paymentPlugins ?? info.plugins ?? null;
    if (!out.paymentPlugins) out.raw = info;
  } catch (e) { out.error = e.message; out.details = e.details; }
  return json(out);
};

export const config = { path: '/api/morning-info' };
