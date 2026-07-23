# syntax=docker/dockerfile:1

FROM node:22-alpine AS frontend-build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# These values are intentionally public browser configuration. Render exposes
# matching service environment variables as Docker build arguments. Never add
# DATABASE_URL or SUPABASE_SECRET_KEY as ARG values.
ARG SUPABASE_URL=""
ARG SUPABASE_PUBLISHABLE_KEY=""
ARG VITE_API_BASE_URL=""
ENV VITE_SUPABASE_URL=${SUPABASE_URL}
ENV VITE_SUPABASE_PUBLISHABLE_KEY=${SUPABASE_PUBLISHABLE_KEY}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

# Keep this revision in the Docker command so a release commit cannot reuse a
# previously cached frontend-build layer from Render's registry cache.
ARG BUILD_REVISION="2026-07-23-audit-1"
# Vite normally clears its output directory, but do it explicitly as well.
# This prevents a cached Docker layer or a stale build artifact from being
# copied into the runtime image when Render rebuilds the service.
RUN echo "frontend-build-revision=${BUILD_REVISION}" \
    && rm -rf dist \
    && npm run build \
    && test -f dist/index.html \
    && grep -q 'assets/index-' dist/index.html


FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

RUN useradd --create-home --uid 10001 appuser
WORKDIR /app

COPY requirements-prod.txt ./
RUN python -m pip install --no-cache-dir --upgrade pip \
    && python -m pip install --no-cache-dir -r requirements-prod.txt

COPY --chown=appuser:appuser . .
COPY --from=frontend-build --chown=appuser:appuser /app/dist ./dist

USER appuser
EXPOSE 10000

# Fail closed when the current release schema cannot be applied. The runner
# uses an advisory lock and a checksum table, so repeat deploys safely skip
# migrations that were already committed.
CMD ["sh", "-c", "python migrate.py --release-overlays && exec python -m uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000} --proxy-headers --forwarded-allow-ips=\"${FORWARDED_ALLOW_IPS:-127.0.0.1}\""]
