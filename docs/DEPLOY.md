# VPS Deployment Guide — aaPanel + Docker

## Requirements

- VPS: Ubuntu 22.04, **8 GB RAM minimum** (ML models need it)
- aaPanel installed and running
- Two (sub)domains pointed to the VPS IP:
  - `yourdomain.com` or `app.yourdomain.com` → frontend
  - `api.yourdomain.com` → backend API

---

## 1. Install Docker on VPS

SSH into your VPS, then:

```bash
curl -fsSL https://get.docker.com | sh
systemctl enable docker
systemctl start docker

# Add your user to docker group (re-login after this)
usermod -aG docker $USER
```

Verify:
```bash
docker --version
docker compose version
```

---

## 2. Upload project to VPS

On your **local machine**:
```bash
# Option A — git (recommended)
# Push repo to GitHub first, then on VPS:
git clone https://github.com/youruser/kyc-platform.git /var/www/kyc

# Option B — rsync
rsync -avz --exclude 'node_modules' --exclude '.venv' --exclude '__pycache__' \
  ./ root@YOUR_VPS_IP:/var/www/kyc
```

---

## 3. Configure environment files

On the VPS:

```bash
cd /var/www/kyc

# Root compose env
cp .env.example .env
nano .env
# Fill: POSTGRES_PASSWORD, NEXT_PUBLIC_API_URL, FLOWER_PASSWORD

# Backend production env
cp backend/.env.production.example backend/.env.production
nano backend/.env.production
# Fill: POSTGRES_PASSWORD (same as above), JWT_SECRET, API_KEY_SALT,
#       FRONTEND_ORIGIN, OPENAI_API_KEY
```

**Important:** `DATABASE_URL` in `backend/.env.production` uses `@db:5432`
(Docker service name), not `@localhost`. Same for Redis: `redis://redis:6379/0`.

Generate strong secrets:
```bash
python3 -c "import secrets; print(secrets.token_hex(32))"
# Run twice — once for JWT_SECRET, once for API_KEY_SALT
```

---

## 4. Build and start services

```bash
cd /var/www/kyc

# Build all images (takes 10-20 min first time — ML deps are large)
docker compose build

# Start everything in background
docker compose up -d

# Watch logs
docker compose logs -f
```

---

## 5. Run database migrations

```bash
docker compose exec backend alembic upgrade head
```

---

## 6. Pre-warm ML models (first run only)

Models download on first use (~1.5 GB total). Pre-warm so first verification
doesn't time out:

```bash
# EasyOCR — downloads ~1 GB of OCR models
docker compose exec celery python -c "
import easyocr
easyocr.Reader(['ar', 'fr', 'en'])
print('EasyOCR OK')
"

# DeepFace ArcFace — downloads ~500 MB
docker compose exec celery python -c "
from deepface import DeepFace
DeepFace.build_model('ArcFace')
print('ArcFace OK')
"
```

Models are stored in the `ml_models` Docker volume — survives container
restarts and rebuilds.

---

## 7. Configure aaPanel reverse proxy

### 7a. Backend API site (api.yourdomain.com)

1. aaPanel → **Website** → **Add site**
2. Domain: `api.yourdomain.com`
3. PHP version: **Pure Static** (no PHP needed)
4. After creating, open site settings → **Reverse proxy** tab
5. Add proxy:
   - Proxy name: `kyc-api`
   - Target URL: `http://127.0.0.1:8000`
   - Send domain: `$host`
6. Save

Then add this to the site's **Nginx config** (Configuration tab):

```nginx
location / {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 300s;   # ML pipeline can take up to ~30s
    proxy_send_timeout 300s;
    client_max_body_size 20M;  # document image uploads
}

# SSE — disable buffering for real-time pipeline events
location ~ ^/v1/verify/.*/stream {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 600s;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 7b. Frontend site (yourdomain.com)

1. aaPanel → **Website** → **Add site**
2. Domain: `yourdomain.com`
3. PHP version: **Pure Static**
4. Site **Nginx config**:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

### 7c. Flower monitor (optional, internal)

If you want Flower accessible at `flower.yourdomain.com`:
- Same setup as API, target `http://127.0.0.1:5555`
- Restrict by IP in Nginx if not public-facing

---

## 8. SSL — Let's Encrypt

aaPanel → Website → click your site → **SSL** → **Let's Encrypt** → Apply

Do this for both `yourdomain.com` and `api.yourdomain.com`.

After SSL is active, update `backend/.env.production`:
```
FRONTEND_ORIGIN=https://yourdomain.com
```

Update root `.env`:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

Then rebuild the frontend (NEXT_PUBLIC_API_URL is baked at build time):
```bash
docker compose build frontend
docker compose up -d frontend
```

---

## 9. Verify everything works

```bash
# Health check
curl https://api.yourdomain.com/health

# Expected:
# {"status":"ok","version":"0.1.0","db":true,"redis":true}

# Check all containers running
docker compose ps

# Check celery worker received tasks
docker compose logs celery | tail -20
```

---

## 10. Useful commands

```bash
# Restart single service
docker compose restart backend

# View real-time logs
docker compose logs -f celery

# Stop everything
docker compose down

# Stop + wipe DB (destructive!)
docker compose down -v

# Update after code changes
git pull
docker compose build
docker compose up -d
docker compose exec backend alembic upgrade head

# Shell into backend
docker compose exec backend bash
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `libGL.so.1: cannot open` | Already in Dockerfile — rebuild image |
| First verification hangs | ML models not pre-warmed — run step 6 |
| `Connection refused` on API | Check `docker compose ps` — backend may be starting |
| CORS error in browser | `FRONTEND_ORIGIN` in `.env.production` must match exact origin (no trailing slash) |
| Celery not picking tasks | `docker compose logs celery` — check Redis connection |
| Out of memory | Upgrade VPS RAM or reduce Celery `--concurrency` to 1 |
| DB migration fails | Check `DATABASE_URL` uses `@db:5432` not `@localhost` |
