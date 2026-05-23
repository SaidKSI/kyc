 # Terminal 1 — FastAPI
  cd /c/laragon/www/KYC/backend
  . .venv/Scripts/activate
  uvicorn main:app --reload --port 8000

  # Terminal 2 — Celery worker
  cd /c/laragon/www/KYC/backend
  . .venv/Scripts/activate
  celery -A workers.celery_app worker --loglevel=info --concurrency=2 --pool=solo

  # Terminal 3 — Frontend
  cd /c/laragon/www/KYC/frontend
  npm run dev

  # Terminal 4 — Watch worker logs
  tail -f /c/laragon/www/KYC/backend/logs/worker.log



  # Terminal 1 — FastAPI
  cd C:\laragon\www\KYC\backend
  .\.venv\Scripts\activate.ps1
  .\.venv\Scripts\uvicorn.exe main:app --reload --port 8000

  # Terminal 2 — Celery worker
  cd C:\laragon\www\KYC\backend
  .\.venv\Scripts\activate.ps1
  .\.venv\Scripts\celery.exe -A workers.celery_app worker --loglevel=info --concurrency=2 --pool=solo

  # Terminal 3 — Frontend
  cd C:\laragon\www\KYC\frontend
  npm run dev

  # Terminal 4 — Watch worker logs (optional)
  Get-Content C:\laragon\www\KYC\backend\logs\worker.log -Wait

  # Terminal 5 — Watch API logs (optional)
  Get-Content C:\laragon\www\KYC\backend\logs\api.log -Wait
