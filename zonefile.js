'use strict';

/*
 * Small BIND zone-file reader used for import preview.
 * It understands files exported by Hostinger, GoDaddy, Namecheap, cPanel and Cloudflare:
 * $ORIGIN / $TTL, "@", relative names, blank owner (= previous owner), optional TTL/class,
 * multi-line records in ( ... ), quoted TXT values and ; comments.
 *
 * Each record gets a status:
 *   new      -> will be imported
 *   skipped  -> cannot / should not be imported (SOA, root NS, other domain...)
 *   exists   -> set later by the server when the record is already in Cloudflare
 */

const CLASSES = ['IN', 'CH', 'HS', 'CS'];

function stripComment(line) {
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ';' && !inQuote) return line.slice(0, i);
  }
  return line;
}

function parenDepth(line) {
  let inQuote = false;
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"') inQuote = !inQuote;
    else if (!inQuote && ch === '(') depth++;
    else if (!inQuote && ch === ')') depth--;
  }
  return depth;
}

function tokenize(line) {
  const tokens = line.match(/"(?:[^"\\]|\\.)*"|[^\s"]+/g) || [];
  return tokens
    .map((t) => (t.startsWith('"') ? t : t.replace(/[()]/g, '')))
    .filter((t) => t !== '');
}

function parseTtl(token) {
  const m = String(token).toLowerCase().match(/^(\d+)([smhdw]?)$/);
  if (!m) return null;
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[m[2]];
  return Number(m[1]) * mult;
}

// Turn a zone-file name into a full domain name (without trailing dot).
function resolveName(name, origin) {
  const n = String(name).toLowerCase();
  if (n === '@') return origin;
  if (n.endsWith('.')) return n.slice(0, -1);
  return `${n}.${origin}`;
}

// Names inside record data (CNAME target, MX host...) must be absolute for Cloudflare.
function absolutize(type, rdata, origin) {
  const abs = (n) => (n === '.' ? '.' : `${resolveName(n, origin)}.`);
  const r = [...rdata];
  if (['CNAME', 'NS', 'PTR', 'DNAME'].includes(type) && r[0]) r[0] = abs(r[0]);
  if (type === 'MX' && r[1]) r[1] = abs(r[1]);
  if (type === 'SRV' && r[3]) r[3] = abs(r[3]);
  return r;
}

const trimDot = (s) => String(s).toLowerCase().replace(/\.$/, '');

function txtValue(s) {
  const parts = String(s).match(/"((?:[^"\\]|\\.)*)"/g);
  return parts ? parts.map((p) => p.slice(1, -1)).join('') : String(s);
}

// Same key for a Cloudflare record and a zone-file record -> used to find duplicates.
function recordKey(type, name, content, priority) {
  const n = trimDot(name);
  switch (type) {
    case 'MX':
      return `MX|${n}|${Number(priority) || 0}|${trimDot(content)}`;
    case 'TXT':
      return `TXT|${n}|${txtValue(content)}`;
    case 'A':
    case 'AAAA':
    case 'CNAME':
    case 'NS':
    case 'PTR':
      return `${type}|${n}|${trimDot(content)}`;
    default:
      return `${type}|${n}|${trimDot(String(content).replace(/"/g, '').replace(/\s+/g, ' '))}`;
  }
}

function parseZoneFile(text, zoneName) {
  const zone = trimDot(zoneName);
  let origin = zone;
  let defaultTtl = null;
  let lastOwner = zone;
  const records = [];
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = stripComment(lines[i]);
    const indented = /^[ \t]/.test(line);
    let depth = parenDepth(line);
    while (depth > 0 && i + 1 < lines.length) {
      const next = stripComment(lines[++i]);
      line += ` ${next}`;
      depth += parenDepth(next);
    }

    const tokens = tokenize(line);
    if (!tokens.length) continue;

    const head = tokens[0].toUpperCase();
    if (head === '$ORIGIN') {
      if (tokens[1]) origin = trimDot(tokens[1]);
      continue;
    }
    if (head === '$TTL') {
      defaultTtl = parseTtl(tokens[1]);
      continue;
    }
    if (head.startsWith('$')) {
      records.push({ line: lineNo, name: '', type: head, ttl: null, content: tokens.slice(1).join(' '), status: 'skipped', note: 'This directive is not supported' });
      continue;
    }

    let owner = lastOwner;
    if (!indented) {
      owner = resolveName(tokens.shift(), origin);
      lastOwner = owner;
    }

    let ttl = null;
    while (tokens.length) {
      const t = tokens[0].toUpperCase();
      if (ttl === null && /^\d+[SMHDW]?$/.test(t)) {
        ttl = parseTtl(t);
        tokens.shift();
      } else if (CLASSES.includes(t)) {
        tokens.shift();
      } else break;
    }

    let type = (tokens.shift() || '').toUpperCase();
    const rec = { line: lineNo, name: owner, type, ttl: ttl ?? defaultTtl, content: '', status: 'new', note: '' };

    if (!type || !tokens.length) {
      rec.status = 'skipped';
      rec.note = 'Could not read this line';
      rec.content = tokens.join(' ');
      records.push(rec);
      continue;
    }

    if (type === 'ALIAS' || type === 'ANAME') {
      type = 'CNAME';
      rec.type = 'CNAME';
      rec.note = 'ALIAS changed to CNAME (works the same on Cloudflare)';
    }

    const rdata = absolutize(type, tokens, origin);
    rec.content = rdata.map((t) => (t.startsWith('"') ? t : t.replace(/\.$/, ''))).join(' ');

    if (!(owner === zone || owner.endsWith(`.${zone}`))) {
      rec.status = 'skipped';
      rec.note = `Not part of ${zone}`;
    } else if (type === 'SOA') {
      rec.status = 'skipped';
      rec.note = 'Cloudflare creates SOA automatically';
    } else if (type === 'NS' && owner === zone) {
      rec.status = 'skipped';
      rec.note = 'Root nameservers are set by Cloudflare';
    } else {
      rec.key = type === 'MX'
        ? recordKey('MX', owner, rdata[1], rdata[0])
        : recordKey(type, owner, rdata.join(' '));
      rec.zoneLine = `${owner}. ${rec.ttl ?? ''} IN ${type} ${rdata.join(' ')}`.replace(/ {2,}/g, ' ');
    }
    records.push(rec);
  }
  return records;
}

module.exports = { parseZoneFile, recordKey };
