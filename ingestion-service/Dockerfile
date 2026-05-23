FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install fastapi uvicorn sqlalchemy psycopg2-binary redis python-dotenv pydantic aiohttp
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]