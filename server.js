'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { parseZoneFile, recordKey } = require('./zonefile');

// Load .env (values already set by the host, like PORT, are never overwritten).
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

const REQUIRED = ['CF_API_TOKEN', 'ADMIN_USER', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing in .env: ${missing.join(', ')}\nRun "npm run setup" first.`);
  process.exit(1);
}

const { CF_API_TOKEN, ADMIN_USER, ADMIN_PASSWORD_HASH, SESSION_SECRET } = process.env;
const PORT = Number(process.env.PORT) || 3000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
let accountId = process.env.CF_ACCOUNT_ID || '';

/* ---------------- Cloudflare API helper ---------------- */

const CF_BASE = 'https://api.cloudflare.com/client/v4';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function cfFetch(method, urlPath, body) {
  const headers = { Authorization: `Bearer ${CF_API_TOKEN}` };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  try {
    return await fetch(CF_BASE + urlPath, { method, headers, body: payload });
  } catch (e) {
    const reason = e.cause?.code || e.cause?.message || e.message;
    console.error(`Cloudflare request failed: ${reason}`);
    throw new HttpError(502, `Could not reach Cloudflare (${reason}). Please try again.`);
  }
}

function cfError(res, data) {
  const msg = data?.errors?.map((e) => e.message).join('; ') || `Cloudflare error (HTTP ${res.status})`;
  // 401 is reserved for "panel session expired", so Cloudflare auth errors become 400/502.
  return new HttpError(res.status >= 400 && res.status < 500 ? 400 : 502, msg);
}

async function cf(method, urlPath, body) {
  const res = await cfFetch(method, urlPath, body);
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!data || !data.success) throw cfError(res, data);
  return data;
}

async function cfText(urlPath) {
  const res = await cfFetch('GET', urlPath);
  const text = await res.text();
  if (!res.ok) {
    let data = null;
    try { data = JSON.parse(text); } catch { /* plain text error */ }
    throw cfError(res, data);
  }
  return text;
}

async function cfAll(urlPath, perPage) {
  const out = [];
  for (let page = 1; ; page++) {
    const sep = urlPath.includes('?') ? '&' : '?';
    const data = await cf('GET', `${urlPath}${sep}per_page=${perPage}&page=${page}`);
    out.push(...data.result);
    const totalPages = data.result_info?.total_pages || 1;
    if (page >= totalPages) break;
  }
  return out;
}

async function getAccountId() {
  if (accountId) return accountId;
  const data = await cf('GET', '/accounts?per_page=5');
  if (!data.result.length) throw new HttpError(400, 'API token cannot see any Cloudflare account. Set CF_ACCOUNT_ID in .env.');
  accountId = data.result[0].id;
  return accountId;
}

// Run async jobs with limited parallelism; never throws, reports per-item result.
async function runPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i]) };
      } catch (e) {
        results[i] = { ok: false, error: e.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* ---------------- Auth helpers ---------------- */

function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored).split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), Buffer.from(salt, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// Simple brute-force protection: 5 wrong logins per IP -> locked for 15 minutes.
const failedLogins = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;

/* ---------------- App ---------------- */

const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': [
      "default-src 'self'",
      "style-src 'self' https://fonts.googleapis.com",
      'font-src https://fonts.gstatic.com',
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ].join('; '),
  });
  next();
});

const jsonSmall = express.json({ limit: '100kb' });
const jsonLarge = express.json({ limit: '3mb' });
app.use((req, res, next) => (req.path.endsWith('/import') ? jsonLarge : jsonSmall)(req, res, next));

app.use(
  session({
    name: 'dnspanel.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: 8 * 60 * 60 * 1000 },
  })
);
app.use(express.static(path.join(__dirname, 'public')));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

// CSRF guard: every state-changing API call must carry a custom header,
// which browsers never send cross-site without a CORS preflight (which we never allow).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'dns-panel') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
});

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const entry = failedLogins.get(ip);
  if (entry && entry.count >= MAX_FAILS && Date.now() < entry.until) {
    return res.status(429).json({ error: 'Too many wrong attempts. Try again in 15 minutes.' });
  }
  const { username = '', password = '' } = req.body || {};
  const ok = safeEqual(username, ADMIN_USER) & verifyPassword(password, ADMIN_PASSWORD_HASH);
  if (!ok) {
    const e = entry && Date.now() < entry.until ? entry : { count: 0, until: 0 };
    e.count += 1;
    e.until = Date.now() + LOCK_MS;
    failedLogins.set(ip, e);
    return res.status(401).json({ error: 'Wrong username or password' });
  }
  failedLogins.delete(ip);
  req.session.regenerate((err) => {
    if (err) return res.status(500).json({ error: 'Login failed' });
    req.session.user = ADMIN_USER;
    res.json({ user: ADMIN_USER });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('dnspanel.sid');
    res.json({ ok: true });
  });
});

// Everything below needs a logged-in user.
app.use('/api', (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
});

app.get('/api/me', (req, res) => res.json({ user: req.session.user }));

const CF_ID = /^[a-f0-9]{32}$/;
app.param('zoneId', (req, res, next, v) => (CF_ID.test(v) ? next() : res.status(400).json({ error: 'Invalid domain id' })));
app.param('recordId', (req, res, next, v) => (CF_ID.test(v) ? next() : res.status(400).json({ error: 'Invalid record id' })));

const zoneView = (z) => ({
  id: z.id,
  name: z.name,
  status: z.status,
  paused: z.paused,
  name_servers: z.name_servers || [],
  original_name_servers: z.original_name_servers || [],
  original_registrar: z.original_registrar || null,
});

const safeFileName = (s) => String(s).replace(/[^a-z0-9.-]/gi, '_');
const today = () => new Date().toISOString().slice(0, 10);

/* Domains (zones) */

app.get('/api/zones', wrap(async (req, res) => {
  const zones = await cfAll('/zones', 50);
  res.json(zones.map(zoneView).sort((a, b) => a.name.localeCompare(b.name)));
}));

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}(?<!-)\.)+[a-z]{2,63}$/;

app.post('/api/zones', wrap(async (req, res) => {
  const name = String(req.body?.name || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (!DOMAIN_RE.test(name)) throw new HttpError(400, 'Enter a valid domain, like example.com');
  const data = await cf('POST', '/zones', { name, account: { id: await getAccountId() }, type: 'full' });
  res.json(zoneView(data.result));
}));

// Cloudflare allows a manual nameserver check only once per hour per domain.
// Remember when we last asked, and never show Cloudflare's rate-limit error to the user.
const CHECK_COOLDOWN_MS = 60 * 60 * 1000;
const lastCheck = new Map();

app.put('/api/zones/:zoneId/activation_check', wrap(async (req, res) => {
  const { zoneId } = req.params;
  const last = lastCheck.get(zoneId) || 0;
  if (Date.now() - last < CHECK_COOLDOWN_MS) {
    return res.json({ ok: true, alreadyChecking: true, nextAt: last + CHECK_COOLDOWN_MS });
  }
  try {
    await cf('PUT', `/zones/${zoneId}/activation_check`);
  } catch (err) {
    if (!/once per hour|rate limit/i.test(err.message)) throw err;
    // Already checked recently (e.g. before a server restart): treat as in progress.
  }
  lastCheck.set(zoneId, Date.now());
  res.json({ ok: true, nextAt: Date.now() + CHECK_COOLDOWN_MS });
}));

/* Live nameserver check (every minute, independent of Cloudflare's hourly limit) */

// Ask public DNS-over-HTTPS resolvers which nameservers the internet sees for a domain.
async function lookupNs(name) {
  const q = encodeURIComponent(name);
  const urls = [
    `https://cloudflare-dns.com/dns-query?name=${q}&type=NS`,
    `https://dns.google/resolve?name=${q}&type=NS`,
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      if (data.Status === 0 || data.Status === 3) {
        return (data.Answer || [])
          .filter((a) => a.type === 2)
          .map((a) => String(a.data).toLowerCase().replace(/\.$/, ''))
          .sort();
      }
    } catch {
      /* try the next resolver */
    }
  }
  throw new HttpError(502, 'Could not look up nameservers right now. Trying again in a minute.');
}

const NS_CHECK_MS = 60 * 1000;
const nsCache = new Map();

app.get('/api/zones/:zoneId/ns-status', wrap(async (req, res) => {
  const { zoneId } = req.params;
  const cached = nsCache.get(zoneId);
  if (cached && Date.now() - cached.at < NS_CHECK_MS) {
    return res.json({ ...cached.data, nextAt: cached.at + NS_CHECK_MS });
  }

  const zone = zoneView((await cf('GET', `/zones/${zoneId}`)).result);
  const current = await lookupNs(zone.name);
  const expected = zone.name_servers.map((n) => n.toLowerCase()).sort();
  const match = expected.length > 0 && expected.every((ns) => current.includes(ns));

  // Nameservers are changed: ask Cloudflare to activate now (allowed once per hour).
  let activationRequested = false;
  if (match && zone.status === 'pending' && Date.now() - (lastCheck.get(zoneId) || 0) >= CHECK_COOLDOWN_MS) {
    try {
      await cf('PUT', `/zones/${zoneId}/activation_check`);
    } catch {
      /* rate-limited: Cloudflare will still activate on its own */
    }
    lastCheck.set(zoneId, Date.now());
    activationRequested = true;
  }

  const now = Date.now();
  const data = { zone, current, expected, match, activationRequested, checkedAt: now };
  nsCache.set(zoneId, { at: now, data });
  res.json({ ...data, nextAt: now + NS_CHECK_MS });
}));

/* Export (BIND zone file) */

function sendZoneFile(res, fileName, text) {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${safeFileName(fileName)}"`);
  res.set('Cache-Control', 'no-store');
  res.send(text);
}

app.get('/api/zones/:zoneId/export', wrap(async (req, res) => {
  const { zoneId } = req.params;
  const zone = (await cf('GET', `/zones/${zoneId}`)).result;
  const text = await cfText(`/zones/${zoneId}/dns_records/export`);
  sendZoneFile(res, `${zone.name}.txt`, text);
}));

app.get('/api/export-all', wrap(async (req, res) => {
  const zones = await cfAll('/zones', 50);
  zones.sort((a, b) => a.name.localeCompare(b.name));
  const parts = [`; All domains - exported ${new Date().toISOString()}\n; ${zones.length} domain(s)\n`];
  const results = await runPool(zones, 3, (z) => cfText(`/zones/${z.id}/dns_records/export`));
  zones.forEach((z, i) => {
    const r = results[i];
    parts.push(`\n; ==================== ${z.name} ====================\n`);
    parts.push(r.ok ? r.value : `; Export failed: ${r.error}\n`);
  });
  sendZoneFile(res, `all-domains-${today()}.txt`, parts.join(''));
}));

/* Import (BIND zone file) */

app.post('/api/zones/:zoneId/import', wrap(async (req, res) => {
  const { zoneId } = req.params;
  const zoneText = String(req.body?.zoneText || '');
  const dryRun = req.body?.dryRun !== false;
  const proxied = Boolean(req.body?.proxied);
  if (!zoneText.trim()) throw new HttpError(400, 'The zone file is empty');
  if (zoneText.length > 2_000_000) throw new HttpError(400, 'The zone file is too large (max 2 MB)');

  const zone = (await cf('GET', `/zones/${zoneId}`)).result;
  const records = parseZoneFile(zoneText, zone.name);
  if (records.length > 5000) throw new HttpError(400, 'Too many lines (max 5000 records per import)');

  const existing = await cfAll(`/zones/${zoneId}/dns_records`, 500);
  const existingKeys = new Set(existing.map((r) => recordKey(r.type, r.name, r.content, r.priority)));
  const seen = new Set();
  for (const r of records) {
    if (r.status !== 'new') continue;
    if (existingKeys.has(r.key)) {
      r.status = 'exists';
      r.note = 'Already in this domain';
    } else if (seen.has(r.key)) {
      r.status = 'exists';
      r.note = 'Duplicate line in the file';
    }
    seen.add(r.key);
  }

  const publicRecords = records.map(({ line, name, type, ttl, content, status, note }) => ({ line, name, type, ttl, content, status, note }));
  if (dryRun) return res.json({ zone: zone.name, records: publicRecords });

  const toImport = records.filter((r) => r.status === 'new');
  if (!toImport.length) return res.json({ added: 0, records: publicRecords });

  const body = `$ORIGIN ${zone.name}.\n${toImport.map((r) => r.zoneLine).join('\n')}\n`;
  const form = new FormData();
  form.append('file', new Blob([body], { type: 'text/plain' }), 'import.txt');
  form.append('proxied', proxied ? 'true' : 'false');
  const data = await cf('POST', `/zones/${zoneId}/dns_records/import`, form);
  res.json({ added: data.result?.recs_added ?? toImport.length, records: publicRecords });
}));

/* DNS records */

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
const PROXYABLE = ['A', 'AAAA', 'CNAME'];

function buildRecord(body = {}) {
  const type = String(body.type || '').toUpperCase();
  if (!RECORD_TYPES.includes(type)) throw new HttpError(400, `Record type must be one of: ${RECORD_TYPES.join(', ')}`);
  const name = String(body.name || '').trim();
  const content = String(body.content || '').trim();
  if (!name) throw new HttpError(400, 'Name is required');
  if (!content) throw new HttpError(400, 'Content / value is required');
  if (content.length > 4096) throw new HttpError(400, 'Content is too long');

  let ttl = Number(body.ttl);
  if (!(ttl === 1 || (Number.isInteger(ttl) && ttl >= 60 && ttl <= 86400))) ttl = 1;

  const record = { type, name, content, ttl };
  if (PROXYABLE.includes(type)) {
    record.proxied = Boolean(body.proxied);
    if (record.proxied) record.ttl = 1;
  }
  if (type === 'MX') {
    const p = Number(body.priority);
    record.priority = Number.isInteger(p) && p >= 0 && p <= 65535 ? p : 10;
  }
  return record;
}

const recordView = (r) => ({
  id: r.id,
  type: r.type,
  name: r.name,
  content: r.content,
  ttl: r.ttl,
  proxied: r.proxied,
  proxiable: r.proxiable,
  priority: r.priority,
});

function idList(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new HttpError(400, 'No records selected');
  if (ids.length > 1000) throw new HttpError(400, 'Too many records selected (max 1000)');
  if (!ids.every((id) => CF_ID.test(id))) throw new HttpError(400, 'Invalid record id');
  return [...new Set(ids)];
}

const bulkSummary = (results, ids) => ({
  done: results.filter((r) => r.ok).length,
  failed: results.map((r, i) => (r.ok ? null : { id: ids[i], error: r.error })).filter(Boolean),
});

app.get('/api/zones/:zoneId/records', wrap(async (req, res) => {
  const records = await cfAll(`/zones/${req.params.zoneId}/dns_records`, 500);
  res.json(records.map(recordView));
}));

app.post('/api/zones/:zoneId/records', wrap(async (req, res) => {
  const data = await cf('POST', `/zones/${req.params.zoneId}/dns_records`, buildRecord(req.body));
  res.json(recordView(data.result));
}));

app.post('/api/zones/:zoneId/records/bulk-delete', wrap(async (req, res) => {
  const { zoneId } = req.params;
  const ids = idList(req.body?.ids);
  const results = await runPool(ids, 5, (id) => cf('DELETE', `/zones/${zoneId}/dns_records/${id}`));
  res.json(bulkSummary(results, ids));
}));

app.post('/api/zones/:zoneId/records/bulk-proxy', wrap(async (req, res) => {
  const { zoneId } = req.params;
  const ids = idList(req.body?.ids);
  const proxied = Boolean(req.body?.proxied);
  const results = await runPool(ids, 5, (id) => cf('PATCH', `/zones/${zoneId}/dns_records/${id}`, { proxied }));
  res.json(bulkSummary(results, ids));
}));

app.put('/api/zones/:zoneId/records/:recordId', wrap(async (req, res) => {
  const { zoneId, recordId } = req.params;
  const data = await cf('PUT', `/zones/${zoneId}/dns_records/${recordId}`, buildRecord(req.body));
  res.json(recordView(data.result));
}));

// Quick proxy on/off for one record.
app.patch('/api/zones/:zoneId/records/:recordId', wrap(async (req, res) => {
  const { zoneId, recordId } = req.params;
  if (typeof req.body?.proxied !== 'boolean') throw new HttpError(400, 'proxied must be true or false');
  const data = await cf('PATCH', `/zones/${zoneId}/dns_records/${recordId}`, { proxied: req.body.proxied });
  res.json(recordView(data.result));
}));

app.delete('/api/zones/:zoneId/records/:recordId', wrap(async (req, res) => {
  const { zoneId, recordId } = req.params;
  await cf('DELETE', `/zones/${zoneId}/dns_records/${recordId}`);
  res.json({ ok: true });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Server error' : err.message });
});

app.listen(PORT, () => console.log(`DNS Panel running on http://localhost:${PORT}`));
