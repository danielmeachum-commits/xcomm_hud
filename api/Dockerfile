FROM docker.io/python:3.12-slim AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Pinned so a rebuild on the offline host (`xcomm build`) is reproducible.
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /uvx /usr/local/bin/

WORKDIR /app

EXPOSE 8000


FROM base AS dev

CMD ["sh", "-c", "uv sync && uv run alembic upgrade head && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload --timeout-graceful-shutdown 3"]


FROM base AS prod

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY . .

# Everything is installed above, so at runtime `uv run` must never try to
# resolve or download — on an airgapped host that would hang or fail the start.
ENV UV_FROZEN=1 UV_OFFLINE=1 UV_NO_SYNC=1

CMD ["sh", "-c", "uv run alembic upgrade head && uv run uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
