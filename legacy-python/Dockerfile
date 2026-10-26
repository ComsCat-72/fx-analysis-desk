# Single image: builds the dashboard, then serves API + static files with uvicorn.
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npx vite build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# WeasyPrint (PDF export) needs Pango and fonts.
RUN apt-get update && apt-get install -y --no-install-recommends \
      libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY config/ config/
COPY backend/ backend/
COPY --from=ui /ui/dist frontend/dist
WORKDIR /app/backend
EXPOSE 8000
# Apply migrations and sync config on every start (idempotent), then serve.
CMD python -m app.cli init-db && uvicorn app.api.main:app --host 0.0.0.0 --port ${PORT:-8000}
