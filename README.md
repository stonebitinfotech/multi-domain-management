# DNS Panel

Your own website for managing the DNS of all your domains in one place, whether they were bought at GoDaddy, Namecheap, Hostinger or anywhere else.
Cloudflare (free plan) serves the DNS in the background, and you manage everything from this panel.

## Features
- Login protected (password stored as a hash, 5 wrong tries = 15 min lock)
- List all domains with their status (active / pending)
- Add a new domain and get the nameservers to set at your registrar
- View, search, add, edit and delete DNS records: A, AAAA, CNAME, MX, TXT, NS
- Cloudflare proxy on/off for A, AAAA and CNAME records
- Works on mobile, with automatic dark mode

## 1. Create a Cloudflare API token
1. Sign up at https://dash.cloudflare.com (free).
2. Go to **My Profile → API Tokens → Create Token → Create Custom Token**.
3. Permissions:
   - `Zone` → `Zone` → **Edit**
   - `Zone` → `DNS` → **Edit**
   - `Account` → `Account Settings` → **Read**
4. Zone Resources: **Include → All zones**
5. Create the token and copy it. Cloudflare shows it only once.

## 2. Install and run
Requires **Node.js 18 or newer**.

```bash
npm install
npm run setup      # asks for the token, username and password, then creates .env
npm start          # open http://localhost:3000
```

## 3. Add domains
1. In the panel, click **+ Add domain** and enter `example.com`.
2. Cloudflare imports the existing records. **Check them** (especially MX/email records).
3. At the registrar where you bought the domain, change the nameservers to the two shown in the panel.
4. Within 1–24 hours the status turns **active**.

## 4. Put it on your live server
```bash
npm install --omit=dev
npm run setup
npm install -g pm2
pm2 start server.js --name dns-panel
pm2 save
```
Put nginx (or your hosting's proxy) in front of it with HTTPS, for example at `dns.yourdomain.com` → `http://127.0.0.1:3000`.
Then set these in `.env` and restart:
```
COOKIE_SECURE=true
TRUST_PROXY=true
```

Example nginx block:
```nginx
server {
    server_name dns.yourdomain.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```
Use `certbot --nginx` for a free SSL certificate.

## Security notes
- `.env` contains your Cloudflare token. Never upload it to GitHub or share it.
- The token stays on the server and is never sent to the browser.
- Login sessions are stored in memory, so restarting the server logs everyone out.

## Files
| File | What it does |
|---|---|
| `server.js` | Backend: login, and talks to the Cloudflare API |
| `setup.js` | Creates `.env` |
| `public/index.html`, `app.js`, `style.css` | The panel UI |
