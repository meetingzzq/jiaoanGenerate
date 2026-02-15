FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/

WORKDIR /app/backend

ENV PORT=8080

CMD ["gunicorn", "api_server:app", "--bind", "0.0.0.0:8080", "--timeout", "120", "--workers", "1"]
