FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY backend/requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Set environment variables
ENV PYTHONUNBUFFERED=1

# Use Railway's PORT or default to 8080
ENV PORT=8080

# Expose the port
EXPOSE 8080

# Set working directory to backend
WORKDIR /app/backend

# Run the application with gunicorn
CMD gunicorn api_server:app --bind 0.0.0.0:8080 --timeout 300
