# Deploying Zoomio

Two supported targets. Pick based on whether you need tours to **persist**.

| | Hostinger VPS | Firebase App Hosting |
|---|---|---|
| Published tours survive restarts | **Yes** | No — filesystem is wiped |
| Uploaded panoramas persist | **Yes** | No |
| `slug.yourdomain.com` subdomains | **Yes** | No (path form only) |
| Scales automatically | No | Yes |
| Cost | ~₹500–700/mo flat | ~$5–15/mo, usage-based |
| Setup effort | ~40 min, one-time | ~10 min |

**Use Hostinger for the real product.** Use Firebase only for a throwaway
investor demo where losing data between sessions is acceptable.

---

## Hostinger VPS (recommended)

### 0. Buy the right plan

**KVM 1 or higher — a VPS, not shared hosting.** Hostinger's shared/Business
plans run PHP behind LiteSpeed and cannot keep a Node process alive. There is
no workaround; the app will not run there.

Choose Ubuntu 24.04 as the OS template.

### 1. Point DNS at the server

In your domain's DNS (Hostinger hPanel → Domains → DNS):

```
Type   Name   Value
A      @      <your VPS IP>
A      *      <your VPS IP>      ← wildcard: enables slug.yourdomain.com
```

The wildcard record is what makes per-tour subdomains work. Without it, tours
are still reachable at `yourdomain.com/slug/`.

### 2. Install Node

SSH in (`ssh root@<your VPS IP>`), then:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt install -y nodejs git nginx
```

Node **22.6 or newer is required** — the server executes TypeScript directly
via native type stripping. Older versions crash on the first import.

### 3. Get the code and build

```bash
cd /opt && git clone <your-repo-url> zoomio && cd zoomio && npm install && npm run build
```

`npm run build` typechecks, copies the ffmpeg core, builds the tour player, and
builds the studio. All four must succeed before the app can publish anything.

### 4. Configure

```bash
cp .env.example .env && nano .env
```

Set `PORT=5000` and, if you want AI authoring, `ANTHROPIC_API_KEY`.

### 5. Run it as a service

```bash
printf '[Unit]\nDescription=Zoomio\nAfter=network.target\n\n[Service]\nType=simple\nUser=root\nWorkingDirectory=/opt/zoomio\nExecStart=/usr/bin/node --experimental-strip-types server/index.ts\nRestart=always\nRestartSec=5\nEnvironmentFile=/opt/zoomio/.env\n\n[Install]\nWantedBy=multi-user.target\n' > /etc/systemd/system/zoomio.service
```

```bash
systemctl daemon-reload && systemctl enable --now zoomio && systemctl status zoomio
```

systemd restarts the app on crash and on reboot. Logs: `journalctl -u zoomio -f`

### 6. Put nginx in front

```bash
nano /etc/nginx/sites-available/zoomio
```

```nginx
server {
    listen 80;
    # The wildcard entry is what routes slug.yourdomain.com to the app.
    server_name yourdomain.com *.yourdomain.com;

    # Panoramas are large. nginx defaults to 1 MB and would reject every
    # upload with a confusing 413 — this is the single most common mistake
    # when deploying this app.
    client_max_body_size 80M;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;   # keeps subdomain routing working
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;                      # long publishes / big ZIPs
    }
}
```

`proxy_set_header Host $host` matters: the app derives tour URLs from the
incoming Host header, so stripping it breaks subdomain tours.

```bash
ln -s /etc/nginx/sites-available/zoomio /etc/nginx/sites-enabled/ && rm -f /etc/nginx/sites-enabled/default && nginx -t && systemctl reload nginx
```

### 7. HTTPS

For the apex domain only:

```bash
apt install -y certbot python3-certbot-nginx && certbot --nginx -d yourdomain.com
```

For subdomain tours you need a **wildcard certificate**, which requires a DNS
challenge rather than the HTTP one:

```bash
certbot certonly --manual --preferred-challenges dns -d yourdomain.com -d '*.yourdomain.com'
```

Certbot prints a TXT record to add in hPanel. Wildcard certs cannot be issued
by the automatic HTTP challenge — this manual step is unavoidable.

### 8. Verify

```bash
curl -I https://yourdomain.com && curl -I https://yourdomain.com/api/auth/status
```

Then open the site, create the owner account, and publish a tour.

### Updating later

```bash
cd /opt/zoomio && git pull && npm install && npm run build && systemctl restart zoomio
```

### Backups

Everything that matters lives in two directories:

```bash
tar czf /root/zoomio-backup-$(date +%F).tar.gz -C /opt/zoomio server/data server/published server/public/uploads
```

`server/data` holds users, projects, publications and leads. `server/published`
holds the live tours. Put that on a cron job.

---

## Firebase App Hosting (demo only)

Requires the **Blaze** plan. See `apphosting.yaml` for the runtime config.

```bash
npm install -g firebase-tools && firebase login && firebase init apphosting
```

Connect a GitHub repo, choose region `asia-south1` (Mumbai), then:

```bash
firebase deploy --only apphosting
```

**Limitation that matters:** Cloud Run wipes the container filesystem on
restart and scale. Tours baked into the image reappear; anything created after
deployment does not survive. Making it durable means moving `server/published`
to a Cloud Storage bucket and `server/data` to Firestore.
