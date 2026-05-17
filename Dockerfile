FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    libgl1-mesa-glx \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY aeronet/server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY aeronet/server/ .
COPY drivaerml_gb_final.pkl .
COPY drivaerml_rf_final.pkl .
COPY drivaerml_qt_scaler.pkl .
COPY drivaerml_meta_v2.json .

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
