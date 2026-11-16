'use strict';

// Interactive setup: asks for the Cloudflare token and panel login, then writes .env
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline/promises');

const envFile = path.join(__dirname, '.env');

async function verifyToken(token) {
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return data.success && data.result?.status === 'active';
  } catch {
    return null; // network problem: cannot verify
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log('\n=== DNS Panel setup ===\n');

  if (fs.existsSync(envFile)) {
    const again = (await rl.question('.env already exists. Overwrite it? (y/N): ')).trim().toLowerCase();
    if (again !== 'y') {
      rl.close();
      return console.log('Nothing changed.');
    }
  }

  let token = '';
  while (!token) {
    token = (await rl.question('Cloudflare API token: ')).trim();
    if (!token) continue;
    const ok = await verifyToken(token);
    if (ok === false) {
      console.log('  ✗ Token is not valid. Try again.');
      token = '';
    } else if (ok === null) {
      console.log('  ! Could not reach Cloudflare to verify. Saving it anyway.');
    } else {
      console.log('  ✓ Token is valid.');
    }
  }

  const accountId = (await rl.question('Cloudflare account ID (optional, press Enter to skip): ')).trim();
  const user = (await rl.question('Panel username [admin]: ')).trim() || 'admin';

  let password = '';
  while (password.length < 8) {
    password = await rl.question('Panel password (min 8 characters): ');
    if (password.length < 8) console.log('  ✗ Too short.');
  }
  const port = (await rl.question('Port [3000]: ')).trim() || '3000';
  rl.close();

  const env = [
    `CF_API_TOKEN=${token}`,
    `CF_ACCOUNT_ID=${accountId}`,
    `ADMIN_USER=${user}`,
    `ADMIN_PASSWORD_HASH=${hashPassword(password)}`,
    `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`,
    `PORT=${port}`,
    'COOKIE_SECURE=false',
    'TRUST_PROXY=false',
    '',
  ].join('\n');

  fs.writeFileSync(envFile, env, { mode: 0o600 });
  console.log('\n✓ Saved .env\nNow run:  npm start\n');
})();
