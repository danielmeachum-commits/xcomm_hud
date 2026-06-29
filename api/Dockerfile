FROM docker.io/python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

WORKDIR /app

EXPOSE 8000

CMD ["sh", "-c", "uv sync && uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload"]
