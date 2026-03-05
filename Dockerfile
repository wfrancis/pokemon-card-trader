# Stage 1: Build React frontend
FROM node:18-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Python backend + serve frontend
FROM python:3.11-slim
WORKDIR /app

# Install Python dependencies
COPY server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend
COPY server/ ./server/

# Copy frontend build into server static dir
COPY --from=frontend-build /app/frontend/build ./frontend/build

# Create data directory for SQLite
RUN mkdir -p /data

ENV PYTHONPATH=/app
ENV DATA_DIR=/data
ENV PORT=8080

EXPOSE 8080

CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8080"]
