FROM python:3.8-alpine

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir gunicorn

RUN apk add --no-cache ca-certificates && \
    apk add --no-cache --virtual .build-deps gcc musl-dev libffi-dev && \
    pip install --no-cache-dir -r requirements.txt && \
    apk del .build-deps

RUN mkdir -p /app/static/js /app/templates
COPY app.py .
COPY templates/index.html /app/templates/
COPY static/js/main.js /app/static/js/

EXPOSE 3211

CMD ["gunicorn", "-w", "4", "--bind", "0.0.0.0:3211", "app:app"]
