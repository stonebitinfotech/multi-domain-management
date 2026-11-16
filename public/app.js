'use strict';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS'];
const PROXYABLE = ['A', 'AAAA', 'CNAME'];
const TTLS = [
  [1, 'Auto'], [60, '1 min'], [300, '5 min'], [600, '10 min'], [1800, '30 min'],
  [3600, '1 hour'], [7200, '2 hours'], [18000, '5 hours'], [43200, '12 hours'], [86400, '1 day'],
];
const CONTENT_INFO = {
  A: ['IPv4 address', '203.0.113.10', 'The IP address of your server or hosting.'],
  AAAA: ['IPv6 address', '2001:db8::1', 'The IPv6 address of your server.'],
  CNAME: ['Target', 'myapp.hostingsite.com', 'Another domain name this name should point to.'],
  MX: ['Mail server', 'mx1.mailprovider.com', 'Given by your email provider (Google Workspace, Zoho, Hostinger Mail…).'],
  TXT: ['Text value', 'v=spf1 include:_spf.google.com ~all', 'Used for SPF, DKIM, DMARC and site verification.'],
  NS: ['Nameserver', 'ns1.example.net', 'Hands a subdomain over to other nameservers.'],
};
// Names that usually belong to mail / FTP / server services, which break when proxied.
const SERVICE_NAME = /^(mail|smtp|imap|pop3?|ftp|sftp|cpanel|whm|webmail|webdisk|autodiscover|autoconfig|ssh|vpn|mx\d*|direct|server|vps)(\.|$)/i;

const state = {
  zones: [],
  zone: null,
  records: [],
  recordsLoaded: false,
  selected: new Set(),
  typeFilter: '',
  editing: null,
  recType: 'A',
  importStep: 1,
  importCount: 0,
};

/* ================= helpers ================= */

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  download: '<path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/>',
  upload: '<path d="M12 16V5m0 0-4 4m4-4 4 4M5 20h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  cloud: '<path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.2 4.5 4.5 0 0 0 7 18z"/>',
  'cloud-off': '<path d="M7 18h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.2 4.5 4.5 0 0 0 7 18z"/><path d="M3 3l18 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  alert: '<path d="M12 9v4m0 4h.01"/><path d="M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  shield: '<path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6z"/><path d="m9 12 2 2 4-4"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
};

function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `ic ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] || '';
  return svg;
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v !== false && v != null) node.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) node.append(c);
  return node;
}

async function api(method, url, body) {
  const headers = { 'X-Requested-With': 'dns-panel' };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    showLogin();
    throw new Error('Session expired. Please sign in again.');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

async function download(url, fallbackName) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (res.status === 401) { showLogin(); throw new Error('Session expired. Please sign in again.'); }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Error ${res.status}`);
  }
  const name = (res.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/)?.[1] || fallbackName;
  const blob = await res.blob();
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return name;
}

function toast(msg, type = 'success') {
  const iconName = { success: 'check', error: 'alert', info: 'info' }[type];
  const t = el('div', { class: `toast ${type}` }, el('span', { class: 'toast-icon' }, icon(iconName)), el('span', {}, msg));
  $('#toasts').append(t);
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, type === 'error' ? 6000 : 3200);
}

function showError(node, msg) {
  node.textContent = msg || '';
  node.hidden = !msg;
}

function busy(btn, on, label) {
  if (on) {
    btn.dataset.html = btn.innerHTML;
    btn.replaceChildren(el('span', { class: 'spinner' }), label || 'Please wait…');
    btn.disabled = true;
  } else if (btn.dataset.html !== undefined) {
    btn.innerHTML = btn.dataset.html;
    delete btn.dataset.html;
    btn.disabled = false;
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ttlLabel(ttl) {
  const found = TTLS.find(([v]) => v === ttl);
  if (found) return found[1];
  if (ttl % 3600 === 0) return `${ttl / 3600} h`;
  if (ttl % 60 === 0) return `${ttl / 60} min`;
  return `${ttl}s`;
}

function shortName(fqdn, zone = state.zone?.name) {
  if (!zone) return fqdn;
  if (fqdn === zone) return '@';
  return fqdn.endsWith(`.${zone}`) ? fqdn.slice(0, -(zone.length + 1)) : fqdn;
}

function toFqdn(input) {
  const z = state.zone.name;
  const n = input.trim().toLowerCase().replace(/\.$/, '');
  if (!n || n === '@') return z;
  if (n === z || n.endsWith(`.${z}`)) return n;
  return `${n}.${z}`;
}

function hue(text) {
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function avatar(name, size = '') {
  const a = el('div', { class: `avatar ${size}`.trim() }, (name[0] || '?').toUpperCase());
  a.style.setProperty('--h', hue(name));
  return a;
}

function fillAvatar(node, name) {
  node.textContent = (name[0] || '?').toUpperCase();
  node.style.setProperty('--h', hue(name));
}

function statusPill(status) {
  const map = { active: ['ok', 'Active'], pending: ['warn', 'Pending'], moved: ['muted', 'Moved'], deactivated: ['muted', 'Deactivated'] };
  const [cls, label] = map[status] || ['muted', status];
  return el('span', { class: `status ${cls}` }, el('span', { class: 'dot' }), label);
}

function cloudBadge(node, on) {
  node.replaceChildren(icon('cloud', on ? 'filled' : ''));
  node.classList.toggle('on', on);
}

function copyBtn(text, label = 'Copy') {
  return el('button', {
    class: 'icon-btn xs copy', type: 'button', title: label, 'aria-label': label,
    onclick: async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied to clipboard');
      } catch {
        toast('Could not copy', 'error');
      }
    },
  }, icon('copy'));
}

function confirmBox({ title, message, ok = 'Delete', danger = true }) {
  const d = $('#confirm-dialog');
  $('#confirm-title').textContent = title;
  $('#confirm-msg').textContent = message;
  $('#confirm-ok').textContent = ok;
  $('#confirm-ok').className = `btn ${danger ? 'danger' : 'primary'}`;
  $('#confirm-icon').replaceChildren(icon(danger ? 'trash' : 'alert'));
  $('#confirm-icon').className = `confirm-icon ${danger ? 'danger' : 'warn'}`;
  d.returnValue = '';
  d.showModal();
  return new Promise((resolve) => d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true }));
}

/* ================= theme ================= */

function effectiveTheme() {
  const set = document.documentElement.dataset.theme;
  if (set) return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyThemeIcon() {
  $('#theme-btn').replaceChildren(icon(effectiveTheme() === 'dark' ? 'sun' : 'moon'));
}

try {
  const saved = localStorage.getItem('theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.dataset.theme = saved;
} catch { /* storage blocked */ }

$('#theme-btn').addEventListener('click', () => {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch { /* storage blocked */ }
  applyThemeIcon();
});

/* ================= background refresh ================= */

// While any domain is still pending, refresh statuses every 5 minutes so nobody has to click.
setInterval(() => {
  if (!$('#app-view').hidden && state.zones.some((z) => z.status === 'pending')) loadZones(true);
}, 5 * 60 * 1000);

/* ================= auth ================= */

function showLogin() {
  stopNsWatch();
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-form [name=username]').focus();
}

function showApp(user) {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#who').textContent = user;
  fillAvatar($('#user-avatar'), user);
  applyThemeIcon();
  showOverview();
  loadZones();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const btn = $('button[type=submit]', f);
  showError($('#login-error'), '');
  busy(btn, true, 'Signing in…');
  try {
    const { user } = await api('POST', '/api/login', { username: f.username.value, password: f.password.value });
    f.reset();
    showApp(user);
  } catch (err) {
    showError($('#login-error'), err.message);
  } finally {
    busy(btn, false);
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  state.zone = null;
  showLogin();
});

/* ================= domains ================= */

async function loadZones(silent = false) {
  if (!silent) {
    $('#zone-list').replaceChildren(...Array.from({ length: 4 }, () =>
      el('li', { class: 'zone-skel' }, el('span', { class: 'skel circle' }), el('span', { class: 'skel line' }))));
  }
  try {
    state.zones = await api('GET', '/api/zones');
    renderZones();
    if (state.zone) {
      const fresh = state.zones.find((z) => z.id === state.zone.id);
      if (fresh) {
        state.zone = fresh;
        renderZoneHeader();
      }
    } else {
      renderOverview();
    }
  } catch (err) {
    if (!silent) $('#zone-list').replaceChildren(el('li', { class: 'side-empty error-text' }, err.message));
  }
}

function renderZones() {
  const q = $('#zone-search').value.trim().toLowerCase();
  const list = state.zones.filter((z) => z.name.includes(q));
  $('#zone-count').textContent = state.zones.length || '';
  if (!list.length) {
    $('#zone-list').replaceChildren(el('li', { class: 'side-empty' },
      state.zones.length ? 'No domain matches your search' : 'No domains yet'));
    return;
  }
  $('#zone-list').replaceChildren(...list.map((z) =>
    el('li', {},
      el('button', {
        type: 'button',
        class: `zone-item${state.zone?.id === z.id ? ' active' : ''}`,
        onclick: () => selectZone(z.id),
      },
      avatar(z.name, 'sm'),
      el('span', { class: 'zone-item-name' }, z.name),
      el('span', { class: `status-dot ${z.status === 'active' ? 'ok' : 'warn'}`, title: z.status })))));
}

$('#zone-search').addEventListener('input', renderZones);

function showOverview() {
  stopNsWatch();
  state.zone = null;
  document.body.classList.remove('zone-open');
  $('#zone-view').hidden = true;
  $('#overview-view').hidden = false;
  renderZones();
  renderOverview();
}

$('#overview-btn').addEventListener('click', showOverview);

function statCard(iconName, label, value, tone = '') {
  return el('div', { class: `stat ${tone}`.trim() },
    el('span', { class: 'stat-icon' }, icon(iconName)),
    el('div', {}, el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label' }, label)));
}

function renderOverview() {
  const zones = state.zones;
  const active = zones.filter((z) => z.status === 'active').length;
  const pending = zones.filter((z) => z.status === 'pending');

  const steps = [
    ['Add your domain', 'Click "Add domain". Your current DNS records are copied automatically.'],
    ['Change nameservers', 'At GoDaddy / Namecheap / Hostinger, set the 2 nameservers the panel shows you.'],
    ['Manage everything here', 'Once active, add, edit, import and export records for every domain from this panel.'],
  ];

  $('#overview-view').replaceChildren(
    el('div', { class: 'hero' },
      el('div', {},
        el('p', { class: 'eyebrow' }, 'Overview'),
        el('h1', {}, 'All your domains, one place'),
        el('p', { class: 'muted' }, 'Manage DNS for domains registered anywhere — powered by Cloudflare\'s global network.')),
      el('div', { class: 'hero-actions' },
        el('button', { class: 'btn', type: 'button', onclick: exportAll }, icon('download'), 'Export all'),
        el('button', { class: 'btn primary', type: 'button', onclick: openZoneDialog }, icon('plus'), 'Add domain'))),

    el('div', { class: 'stats' },
      statCard('globe', 'Domains', zones.length, 'blue'),
      statCard('shield', 'Active', active, 'green'),
      statCard('clock', 'Waiting for nameservers', pending.length, 'amber')),

    pending.length
      ? el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, 'Needs your attention'), el('span', { class: 'muted small' }, 'Change nameservers at the registrar')),
        el('ul', { class: 'pending-list' }, pending.map((z) =>
          el('li', {},
            el('button', { type: 'button', class: 'pending-item', onclick: () => selectZone(z.id) },
              avatar(z.name, 'sm'),
              el('span', { class: 'grow' }, el('b', {}, z.name), el('small', { class: 'muted' }, ` → ${z.name_servers.join(', ')}`)),
              statusPill(z.status))))))
      : null,

    el('div', { class: 'grid2' },
      el('div', { class: 'card' },
        el('div', { class: 'card-head' }, el('h3', {}, 'How it works')),
        el('ol', { class: 'how' }, steps.map(([t, d], i) =>
          el('li', {}, el('span', { class: 'how-num' }, String(i + 1)), el('div', {}, el('b', {}, t), el('p', { class: 'muted small' }, d)))))),
      el('div', { class: 'card proxy-teaser' },
        el('div', { class: 'card-head' }, el('h3', {}, 'What is proxy?')),
        el('div', { class: 'teaser-row' },
          el('div', { class: 'cloud-badge on' }, icon('cloud', 'filled')),
          el('p', {}, el('b', {}, 'Proxied'), ' — traffic goes through Cloudflare: hides your server IP, adds free SSL, speed and DDoS protection. For websites.')),
        el('div', { class: 'teaser-row' },
          el('div', { class: 'cloud-badge' }, icon('cloud')),
          el('p', {}, el('b', {}, 'DNS only'), ' — points straight to your server. For email, FTP and other services.')),
        el('button', { class: 'btn sm', type: 'button', onclick: openProxyHelp }, 'Learn more')))
  );
}

function selectZone(id) {
  const zone = state.zones.find((z) => z.id === id);
  if (!zone) return;
  const changed = state.zone?.id !== id;
  state.zone = zone;
  document.body.classList.add('zone-open');
  $('#overview-view').hidden = true;
  $('#zone-view').hidden = false;
  if (changed) {
    $('#record-search').value = '';
    state.typeFilter = '';
    state.selected.clear();
    state.records = [];
    state.recordsLoaded = false;
  }
  renderZones();
  renderZoneHeader();
  loadRecords();
}

$('#back-btn').addEventListener('click', showOverview);

function renderZoneHeader() {
  const z = state.zone;
  fillAvatar($('#zone-avatar'), z.name);
  $('#zone-name').textContent = z.name;
  $('#zone-status').replaceChildren(statusPill(z.status));
  $('#zone-sub').textContent = z.status === 'active'
    ? 'DNS is served by Cloudflare. Changes go live within seconds.'
    : 'Waiting for nameserver change at your registrar.';
  renderNsBox();
}

let nsWatch = null;
let nsTick = null;
function stopNsWatch() {
  clearInterval(nsWatch);
  clearInterval(nsTick);
  nsWatch = null;
  nsTick = null;
}

function renderNsBox() {
  stopNsWatch();
  const z = state.zone;
  const box = $('#ns-box');
  if (z.status === 'active') {
    box.hidden = true;
    return;
  }

  const checkBtn = el('button', { class: 'btn sm', type: 'button' }, icon('refresh'), 'Check now');
  const result = el('div', { class: 'ns-live' });
  let nextAt = 0;

  const tick = () => {
    if (checkBtn.dataset.html !== undefined) return; // busy
    const s = Math.ceil((nextAt - Date.now()) / 1000);
    checkBtn.disabled = s > 0;
    checkBtn.replaceChildren(icon('refresh'), s > 0 ? `Check again in ${s}s` : 'Check now');
  };

  const run = async (manual) => {
    if (Date.now() < nextAt || checkBtn.dataset.html !== undefined) return;
    busy(checkBtn, true, 'Checking…');
    try {
      const r = await api('GET', `/api/zones/${z.id}/ns-status`);
      nextAt = r.nextAt;
      if (r.zone.status === 'active') {
        const i = state.zones.findIndex((x) => x.id === z.id);
        if (i >= 0) state.zones[i] = r.zone;
        if (state.zone?.id === z.id) state.zone = r.zone;
        toast(`${z.name} is now active! 🎉`);
        renderZones();
        if (state.zone?.id === z.id) renderZoneHeader();
        return;
      }
      renderNsResult(result, r);
      if (manual && !r.match) toast('Not changed yet — checking again every minute.', 'info');
    } catch (err) {
      nextAt = Date.now() + 60000;
      if (manual) toast(err.message, 'error');
    } finally {
      busy(checkBtn, false);
      tick();
    }
  };

  checkBtn.addEventListener('click', () => run(true));

  box.className = 'ns-box';
  box.replaceChildren(
    el('div', { class: 'ns-box-head' },
      el('span', { class: 'ns-icon' }, icon('clock')),
      el('div', {},
        el('b', {}, 'One step left: change the nameservers'),
        el('p', { class: 'muted small' }, 'Log in to ', el('b', {}, z.original_registrar || 'the website where you bought this domain'),
          ' and replace the nameservers with these two. It takes 1–24 hours to become active.'))),
    el('div', { class: 'ns-grid' }, z.name_servers.map((ns, i) =>
      el('div', { class: 'ns-chip' }, el('span', { class: 'muted small' }, `Nameserver ${i + 1}`), el('code', {}, ns), copyBtn(ns, 'Copy nameserver')))),
    result,
    el('div', { class: 'check-row' }, checkBtn, el('span', { class: 'muted small' }, 'Checks automatically every minute while this page is open.'))
  );
  box.hidden = false;

  run(false);
  nsWatch = setInterval(() => {
    if (state.zone?.id === z.id && !$('#zone-view').hidden) run(false);
    else stopNsWatch();
  }, 60000);
  nsTick = setInterval(tick, 1000);
}

function renderNsResult(box, r) {
  const someNew = r.current.some((ns) => r.expected.includes(ns));
  let head;
  if (r.match) {
    head = el('div', { class: 'ns-result ok' }, icon('check'),
      el('div', {}, el('b', {}, 'Nameservers are updated! '),
        'Cloudflare is activating your domain — usually a few minutes, sometimes a few hours.'));
  } else if (someNew) {
    head = el('div', { class: 'ns-result warn' }, icon('alert'),
      el('div', {}, el('b', {}, 'Only partly changed. '), 'Make sure BOTH nameservers are replaced (remove the old ones).'));
  } else {
    head = el('div', { class: 'ns-result warn' }, icon('clock'),
      el('div', {}, el('b', {}, 'Not changed yet. '),
        'The internet still sees the old nameservers. After you change them it can take a few minutes to a few hours to show here.'));
  }
  const time = new Date(r.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  box.replaceChildren(
    head,
    el('div', { class: 'ns-live-list' },
      el('span', { class: 'muted small' }, `Live nameservers · checked ${time}`),
      ...(r.current.length ? r.current : ['none found']).map((ns) =>
        el('code', { class: r.expected.includes(ns) ? 'ok' : 'old' }, ns))));
}

/* ================= add domain ================= */

function openZoneDialog() {
  $('#zone-form').reset();
  $('#zone-step1').hidden = false;
  $('#zone-step2').hidden = true;
  $('#zone-save').hidden = false;
  $('#zone-cancel').textContent = 'Cancel';
  showError($('#zone-error'), '');
  $('#zone-dialog').showModal();
  $('#zone-input').focus();
}

$('#add-zone-btn').addEventListener('click', openZoneDialog);

$('#zone-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#zone-save');
  showError($('#zone-error'), '');
  busy(btn, true, 'Adding…');
  try {
    const zone = await api('POST', '/api/zones', { name: $('#zone-input').value });
    $('#zone-step1').hidden = true;
    $('#zone-step2').replaceChildren(
      el('div', { class: 'success-head' }, el('span', { class: 'success-icon' }, icon('check')),
        el('div', {}, el('b', {}, `${zone.name} was added`), el('p', { class: 'muted small' }, 'Now set these nameservers at your domain registrar:'))),
      el('div', { class: 'ns-grid' }, zone.name_servers.map((ns, i) =>
        el('div', { class: 'ns-chip' }, el('span', { class: 'muted small' }, `Nameserver ${i + 1}`), el('code', {}, ns), copyBtn(ns, 'Copy nameserver')))),
      el('div', { class: 'callout info' }, icon('info'),
        el('div', {}, 'Check that the copied records are correct (especially email / MX) ', el('b', {}, 'before'), ' changing nameservers, so your website and email keep working.')));
    $('#zone-step2').hidden = false;
    btn.hidden = true;
    $('#zone-cancel').textContent = 'Done';
    await loadZones(true);
    selectZone(zone.id);
  } catch (err) {
    showError($('#zone-error'), err.message);
  } finally {
    busy(btn, false);
  }
});

/* ================= records ================= */

function skeletonRows() {
  return Array.from({ length: 6 }, () => el('tr', { class: 'skel-row' },
    ...[18, 46, 120, 220, 50, 80, 40].map((w) => el('td', {}, el('span', { class: 'skel line', style: null, 'data-w': w })))));
}

async function loadRecords(silent = false) {
  const zoneId = state.zone.id;
  if (!silent) {
    $('#record-body').replaceChildren(...skeletonRows());
    $$('#record-body .skel[data-w]').forEach((s) => (s.style.width = `${s.dataset.w}px`));
    $('#stats').replaceChildren();
    $('#type-chips').replaceChildren();
  }
  try {
    const records = await api('GET', `/api/zones/${zoneId}/records`);
    if (state.zone?.id !== zoneId) return; // switched domain meanwhile
    state.records = records.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
    state.recordsLoaded = true;
    for (const id of state.selected) if (!records.some((r) => r.id === id)) state.selected.delete(id);
    renderRecords();
  } catch (err) {
    $('#record-body').replaceChildren(el('tr', {}, el('td', { colspan: 7 }, el('div', { class: 'empty error-text' }, icon('alert'), err.message))));
  }
}

function filteredRecords() {
  const q = $('#record-search').value.trim().toLowerCase();
  return state.records.filter((r) =>
    (!state.typeFilter || r.type === state.typeFilter) &&
    (!q || r.name.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)));
}

function renderStats() {
  const recs = state.records;
  const proxied = recs.filter((r) => r.proxied).length;
  const types = new Set(recs.map((r) => r.type)).size;
  $('#stats').replaceChildren(
    statCard('layers', 'Total records', recs.length, 'blue'),
    statCard('cloud', 'Proxied', proxied, 'orange'),
    statCard('globe', 'DNS only', recs.length - proxied, 'slate'),
    statCard('grid', 'Record types', types, 'violet'));
}

function renderChips() {
  const counts = {};
  for (const r of state.records) counts[r.type] = (counts[r.type] || 0) + 1;
  const types = Object.keys(counts).sort((a, b) => (TYPES.indexOf(a) + 1 || 99) - (TYPES.indexOf(b) + 1 || 99));
  const chip = (value, label, count) => el('button', {
    type: 'button',
    class: `chip${state.typeFilter === value ? ' active' : ''}`,
    onclick: () => {
      state.typeFilter = value;
      renderRecords();
    },
  }, label, el('span', { class: 'chip-count' }, String(count)));
  $('#type-chips').replaceChildren(chip('', 'All', state.records.length), ...types.map((t) => chip(t, t, counts[t])));
}

function renderBulkBar() {
  const n = state.selected.size;
  $('#bulk-bar').hidden = n === 0;
  $('#bulk-count').textContent = `${plural(n, 'record')} selected`;
  const rows = filteredRecords();
  const all = $('#select-all');
  const selectedVisible = rows.filter((r) => state.selected.has(r.id)).length;
  all.checked = rows.length > 0 && selectedVisible === rows.length;
  all.indeterminate = selectedVisible > 0 && selectedVisible < rows.length;
}

function renderRecords() {
  renderStats();
  renderChips();
  const rows = filteredRecords();

  if (!rows.length) {
    const empty = state.records.length
      ? el('div', { class: 'empty' }, icon('search'), el('b', {}, 'No matching records'), el('span', { class: 'muted small' }, 'Try another search or type.'))
      : el('div', { class: 'empty' }, icon('layers'), el('b', {}, 'No DNS records yet'),
        el('span', { class: 'muted small' }, 'Add one by one, or import a zone file from your old provider.'),
        el('div', { class: 'empty-actions' },
          el('button', { class: 'btn', type: 'button', onclick: openImport }, icon('upload'), 'Import'),
          el('button', { class: 'btn primary', type: 'button', onclick: () => openRecordDialog() }, icon('plus'), 'Add record')));
    $('#record-body').replaceChildren(el('tr', {}, el('td', { colspan: 7 }, empty)));
    renderBulkBar();
    return;
  }

  $('#record-body').replaceChildren(...rows.map(recordRow));
  renderBulkBar();
}

function recordRow(r) {
  const selected = state.selected.has(r.id);
  const name = shortName(r.name);

  const cb = el('input', { type: 'checkbox', 'aria-label': `Select ${r.type} ${name}` });
  cb.checked = selected;
  cb.addEventListener('change', () => {
    if (cb.checked) state.selected.add(r.id);
    else state.selected.delete(r.id);
    cb.closest('tr').classList.toggle('selected', cb.checked);
    renderBulkBar();
  });

  let proxyCell;
  if (PROXYABLE.includes(r.type)) {
    const btn = el('button', {
      type: 'button',
      class: `proxy-toggle${r.proxied ? ' on' : ''}`,
      title: r.proxied ? 'Proxied — click to switch to DNS only' : 'DNS only — click to proxy through Cloudflare',
    }, icon('cloud', r.proxied ? 'filled' : ''), r.proxied ? 'Proxied' : 'DNS only');
    btn.addEventListener('click', () => toggleProxy(r, btn));
    proxyCell = btn;
  } else {
    proxyCell = el('span', { class: 'proxy-na', title: `${r.type} records are always DNS only` }, 'DNS only');
  }

  return el('tr', { class: selected ? 'selected' : '' },
    el('td', { class: 'cb' }, cb),
    el('td', { 'data-label': 'Type' }, el('span', { class: `type-pill t-${r.type}` }, r.type)),
    el('td', { 'data-label': 'Name' },
      el('div', { class: 'rec-name' }, name),
      name !== r.name ? el('div', { class: 'rec-fqdn' }, r.name) : null),
    el('td', { 'data-label': 'Content', class: 'content-td' },
      el('div', { class: 'content-cell' },
        r.type === 'MX' ? el('span', { class: 'prio', title: 'Priority' }, String(r.priority)) : null,
        el('span', { class: 'value mono', title: r.content }, r.content),
        copyBtn(r.content, 'Copy value'))),
    el('td', { 'data-label': 'TTL', class: 'muted' }, ttlLabel(r.ttl)),
    el('td', { 'data-label': 'Proxy' }, proxyCell),
    el('td', { class: 'row-actions' },
      TYPES.includes(r.type)
        ? el('button', { class: 'icon-btn', type: 'button', title: 'Edit', 'aria-label': 'Edit', onclick: () => openRecordDialog(r) }, icon('edit'))
        : null,
      el('button', { class: 'icon-btn danger', type: 'button', title: 'Delete', 'aria-label': 'Delete', onclick: () => deleteRecord(r) }, icon('trash'))));
}

$('#record-search').addEventListener('input', renderRecords);

$('#select-all').addEventListener('change', (e) => {
  for (const r of filteredRecords()) {
    if (e.target.checked) state.selected.add(r.id);
    else state.selected.delete(r.id);
  }
  renderRecords();
});

$('#bulk-clear').addEventListener('click', () => {
  state.selected.clear();
  renderRecords();
});

async function toggleProxy(r, btn) {
  const next = !r.proxied;
  if (next && SERVICE_NAME.test(shortName(r.name))) {
    const ok = await confirmBox({
      title: 'Turn on proxy?',
      message: `"${shortName(r.name)}" looks like an email / FTP / server record. These usually stop working when proxied. Turn proxy on anyway?`,
      ok: 'Turn on',
      danger: false,
    });
    if (!ok) return;
  }
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const updated = await api('PATCH', `/api/zones/${state.zone.id}/records/${r.id}`, { proxied: next });
    Object.assign(r, updated);
    toast(next ? `Proxy on for ${shortName(r.name)}` : `${shortName(r.name)} is now DNS only`);
    renderRecords();
  } catch (err) {
    toast(err.message, 'error');
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

$$('[data-bulk]').forEach((b) => b.addEventListener('click', () => bulk(b.dataset.bulk, b)));

async function bulk(action, btn) {
  const ids = [...state.selected];
  if (!ids.length) return;
  let body;
  let url;
  if (action === 'delete') {
    const ok = await confirmBox({
      title: `Delete ${plural(ids.length, 'record')}?`,
      message: 'They are removed from DNS right away and this cannot be undone. Tip: use Export first to keep a backup.',
    });
    if (!ok) return;
    url = 'bulk-delete';
    body = { ids };
  } else {
    const proxied = action === 'proxy-on';
    const target = ids.filter((id) => {
      const r = state.records.find((x) => x.id === id);
      return r && PROXYABLE.includes(r.type) && Boolean(r.proxied) !== proxied;
    });
    if (!target.length) {
      toast(proxied ? 'Selected records are already proxied (or cannot be proxied).' : 'Selected records are already DNS only.', 'info');
      return;
    }
    url = 'bulk-proxy';
    body = { ids: target, proxied };
  }

  $$('#bulk-bar button').forEach((b) => (b.disabled = true));
  busy(btn, true, 'Working…');
  try {
    const r = await api('POST', `/api/zones/${state.zone.id}/records/${url}`, body);
    const verb = action === 'delete' ? 'deleted' : 'updated';
    if (r.failed.length) toast(`${r.done} ${verb}, ${r.failed.length} failed: ${r.failed[0].error}`, 'error');
    else toast(`${plural(r.done, 'record')} ${verb}`);
    state.selected.clear();
    await loadRecords(true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    busy(btn, false);
    $$('#bulk-bar button').forEach((b) => (b.disabled = false));
  }
}

async function deleteRecord(r) {
  const ok = await confirmBox({
    title: 'Delete this record?',
    message: `${r.type}  ${shortName(r.name)}  →  ${r.content}`,
  });
  if (!ok) return;
  try {
    await api('DELETE', `/api/zones/${state.zone.id}/records/${r.id}`);
    toast('Record deleted');
    state.selected.delete(r.id);
    loadRecords(true);
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ================= record dialog ================= */

function setRecType(type) {
  state.recType = type;
  $$('#rec-types button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  syncRecordFields();
}

function syncRecordFields() {
  const type = state.recType;
  const [label, placeholder, hint] = CONTENT_INFO[type];
  $('#rec-content-label').textContent = label;
  $('#rec-content').placeholder = placeholder;
  $('#rec-content-hint').textContent = hint;
  $('#rec-priority-wrap').hidden = type !== 'MX';

  const proxyable = PROXYABLE.includes(type);
  $('#rec-proxy-wrap').hidden = !proxyable;
  const proxied = proxyable && $('#rec-proxied').checked;
  cloudBadge($('#rec-cloud'), proxied);
  $('#rec-proxy-wrap').classList.toggle('on', proxied);
  $('#rec-proxy-title').textContent = proxied ? 'Proxied' : 'DNS only';
  $('#rec-proxy-desc').textContent = proxied
    ? 'Visitors go through Cloudflare: hides your server IP, adds SSL, caching and DDoS protection.'
    : 'Points straight to your server. Use this for email, FTP and other non-website services.';
  $('#rec-ttl').disabled = proxied;
  if (proxied) $('#rec-ttl').value = '1';

  const warn = proxied && SERVICE_NAME.test($('#rec-name').value.trim());
  const w = $('#rec-warning');
  w.hidden = !warn;
  if (warn) w.replaceChildren(icon('alert'), el('div', {}, el('b', {}, 'This looks like an email / FTP / server record. '), 'These usually stop working when proxied — keep it DNS only unless you are sure.'));
}

function updateNameHint() {
  const v = $('#rec-name').value.trim();
  const z = state.zone.name;
  $('#rec-name-hint').replaceChildren(
    !v || v === '@'
      ? el('span', {}, 'Root domain: ', el('b', {}, z))
      : el('span', {}, 'Full name: ', el('b', {}, toFqdn(v))),
    el('span', { class: 'muted' }, '  ·  Use @ for the root, or a word like www, mail, blog'));
  syncRecordFields();
}

function openRecordDialog(record = null) {
  state.editing = record;
  $('#record-title').textContent = record ? 'Edit record' : 'Add record';
  $('#record-save').textContent = record ? 'Save changes' : 'Add record';
  showError($('#record-error'), '');
  $('#rec-suffix').textContent = `.${state.zone.name}`;
  $('#rec-name').value = record ? shortName(record.name) : '';
  $('#rec-content').value = record?.content || '';
  $('#rec-priority').value = record?.priority ?? 10;
  $('#rec-proxied').checked = record ? Boolean(record.proxied) : false;
  $('#rec-ttl').value = String(TTLS.some(([v]) => v === record?.ttl) ? record.ttl : 1);
  setRecType(record?.type || 'A');
  updateNameHint();
  $('#record-dialog').showModal();
  $('#rec-name').focus();
}

$('#add-record-btn').addEventListener('click', () => openRecordDialog());
$('#rec-proxied').addEventListener('change', syncRecordFields);
$('#rec-name').addEventListener('input', updateNameHint);

$('#record-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#record-save');
  const type = state.recType;
  const body = {
    type,
    name: toFqdn($('#rec-name').value || '@'),
    content: $('#rec-content').value.trim(),
    ttl: Number($('#rec-ttl').value),
    proxied: PROXYABLE.includes(type) && $('#rec-proxied').checked,
  };
  if (type === 'MX') body.priority = Number($('#rec-priority').value);

  showError($('#record-error'), '');
  busy(btn, true, 'Saving…');
  try {
    const base = `/api/zones/${state.zone.id}/records`;
    if (state.editing) await api('PUT', `${base}/${state.editing.id}`, body);
    else await api('POST', base, body);
    $('#record-dialog').close();
    toast(state.editing ? 'Record updated' : 'Record added');
    loadRecords(true);
  } catch (err) {
    showError($('#record-error'), err.message);
  } finally {
    busy(btn, false);
  }
});

/* ================= export ================= */

$('#export-btn').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  busy(btn, true, 'Exporting…');
  try {
    const name = await download(`/api/zones/${state.zone.id}/export`, `${state.zone.name}.txt`);
    toast(`Downloaded ${name}`);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    busy(btn, false);
  }
});

async function exportAll() {
  if (!state.zones.length) {
    toast('No domains to export yet', 'info');
    return;
  }
  toast(`Exporting ${plural(state.zones.length, 'domain')}…`, 'info');
  try {
    const name = await download('/api/export-all', 'all-domains.txt');
    toast(`Downloaded ${name}`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

$('#export-all-btn').addEventListener('click', exportAll);

/* ================= import ================= */

function setImportStep(step) {
  state.importStep = step;
  $('#import-step1').hidden = step !== 1;
  $('#import-step2').hidden = step !== 2;
  $('#import-step3').hidden = step !== 3;
  $$('#import-steps li').forEach((li, i) => {
    li.classList.toggle('active', i + 1 === step);
    li.classList.toggle('done', i + 1 < step);
  });
  $('#import-back').hidden = step !== 2;
  $('#import-next').hidden = step === 3;
  $('#import-cancel').textContent = step === 3 ? 'Close' : 'Cancel';
  if (step === 1) {
    $('#import-next').textContent = 'Preview';
    $('#import-next').disabled = false;
  }
}

function openImport() {
  $('#import-sub').textContent = `Into ${state.zone.name}`;
  $('#import-text').value = '';
  $('#import-file').value = '';
  $('#import-file-name').hidden = true;
  $('#import-proxied').checked = false;
  showError($('#import-error'), '');
  setImportStep(1);
  $('#import-dialog').showModal();
}

$('#import-btn').addEventListener('click', openImport);

async function readImportFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showError($('#import-error'), 'File is too large (max 2 MB)');
    return;
  }
  $('#import-text').value = await file.text();
  const chip = $('#import-file-name');
  chip.replaceChildren(icon('file'), file.name);
  chip.hidden = false;
  showError($('#import-error'), '');
}

$('#import-file').addEventListener('change', (e) => readImportFile(e.target.files[0]));

const dz = $('#dropzone');
['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => {
  e.preventDefault();
  dz.classList.add('drag');
}));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => {
  e.preventDefault();
  dz.classList.remove('drag');
}));
dz.addEventListener('drop', (e) => readImportFile(e.dataTransfer.files[0]));

function importStatus(r) {
  const map = {
    new: ['ok', 'New'],
    exists: ['muted', 'Exists'],
    skipped: ['warn', 'Skipped'],
  };
  const [cls, label] = map[r.status] || ['muted', r.status];
  return el('span', { class: `status ${cls}` }, el('span', { class: 'dot' }), label);
}

function renderImportPreview(records) {
  const count = (s) => records.filter((r) => r.status === s).length;
  const n = count('new');
  state.importCount = n;
  $('#import-summary').replaceChildren(
    el('div', { class: 'sum ok' }, el('b', {}, String(n)), el('span', {}, 'will be imported')),
    el('div', { class: 'sum muted' }, el('b', {}, String(count('exists'))), el('span', {}, 'already exist')),
    el('div', { class: 'sum warn' }, el('b', {}, String(count('skipped'))), el('span', {}, 'skipped')));

  const order = { new: 0, exists: 1, skipped: 2 };
  const sorted = [...records].sort((a, b) => order[a.status] - order[b.status] || a.line - b.line);
  $('#import-preview').replaceChildren(...sorted.map((r) =>
    el('tr', { class: `st-${r.status}` },
      el('td', {}, importStatus(r)),
      el('td', {}, el('span', { class: `type-pill t-${r.type}` }, r.type)),
      el('td', { class: 'mono' }, r.name ? shortName(r.name) : '—'),
      el('td', {},
        el('div', { class: 'mono preview-content', title: r.content }, r.content),
        r.note ? el('div', { class: 'note' }, r.note) : null),
      el('td', { class: 'muted' }, r.ttl ? ttlLabel(r.ttl) : 'Auto'))));

  $('#import-next').textContent = n ? `Import ${plural(n, 'record')}` : 'Nothing to import';
  $('#import-next').disabled = n === 0;
}

$('#import-back').addEventListener('click', () => setImportStep(1));

$('#import-next').addEventListener('click', async () => {
  const btn = $('#import-next');
  showError($('#import-error'), '');
  const zoneText = $('#import-text').value;

  if (state.importStep === 1) {
    if (!zoneText.trim()) {
      showError($('#import-error'), 'Choose a zone file or paste its text first.');
      return;
    }
    busy(btn, true, 'Reading file…');
    try {
      const r = await api('POST', `/api/zones/${state.zone.id}/import`, { zoneText, dryRun: true });
      busy(btn, false);
      setImportStep(2);
      renderImportPreview(r.records);
    } catch (err) {
      busy(btn, false);
      showError($('#import-error'), err.message);
    }
    return;
  }

  if (state.importStep === 2) {
    busy(btn, true, 'Importing…');
    $('#import-back').disabled = true;
    try {
      const r = await api('POST', `/api/zones/${state.zone.id}/import`, {
        zoneText, dryRun: false, proxied: $('#import-proxied').checked,
      });
      busy(btn, false);
      setImportStep(3);
      $('#import-step3').replaceChildren(
        el('div', { class: 'done-box' },
          el('span', { class: 'success-icon lg' }, icon('check')),
          el('h3', {}, `${plural(r.added, 'record')} imported`),
          el('p', { class: 'muted' }, `They are live on ${state.zone.name} now.`)));
      toast(`${plural(r.added, 'record')} imported`);
      loadRecords(true);
    } catch (err) {
      busy(btn, false);
      showError($('#import-error'), err.message);
    } finally {
      $('#import-back').disabled = false;
    }
  }
});

/* ================= proxy help ================= */

function openProxyHelp() {
  $('#proxy-dialog').showModal();
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-proxy-help]')) openProxyHelp();
});

/* ================= init ================= */

// Replace <i data-icon="..."> placeholders with SVG icons.
$$('i[data-icon]').forEach((i) => i.replaceWith(icon(i.dataset.icon)));
$$('#proxy-dialog .cloud-badge').forEach((b) => cloudBadge(b, b.classList.contains('on')));
$$('#import-dialog .cloud-badge').forEach((b) => cloudBadge(b, false));
$('#import-proxied').addEventListener('change', (e) => {
  cloudBadge($('#import-dialog .cloud-badge'), e.target.checked);
  $('#import-dialog .proxy-card').classList.toggle('on', e.target.checked);
});

$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
// Click on the dark backdrop closes a dialog.
$$('dialog').forEach((d) => d.addEventListener('click', (e) => {
  if (e.target === d) d.close();
}));

for (const t of TYPES) {
  $('#rec-types').append(el('button', { type: 'button', class: `seg-btn t-${t}`, 'data-type': t, onclick: () => setRecType(t) }, t));
}
for (const [v, label] of TTLS) $('#rec-ttl').append(el('option', { value: String(v) }, label));

api('GET', '/api/me').then(({ user }) => showApp(user)).catch(() => showLogin());
