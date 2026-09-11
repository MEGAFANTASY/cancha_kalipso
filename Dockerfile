FROM python:3.12-alpine

WORKDIR /app

# Instalar dependencias
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copiar backend
COPY backend /app/backend

# Copiar frontend
COPY frontend /app/frontend

EXPOSE 7000

CMD ["python", "/app/backend/server.py"]
