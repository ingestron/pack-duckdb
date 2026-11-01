# The DuckDB runner: Python with DuckDB and its azure extension, installed at
# build time so a run downloads nothing. Public, so jobs pull it anonymously.
FROM python:3.12-slim

ENV DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions
RUN pip install --no-cache-dir duckdb==1.5.6 \
 && mkdir -p /opt/duckdb/extensions \
 && python -c "import duckdb; c = duckdb.connect(config={'extension_directory': '/opt/duckdb/extensions'}); c.execute('INSTALL azure')" \
 && chmod -R a+rX /opt/duckdb

WORKDIR /app
COPY run.py runner_lib.py /app/
USER 1000
ENTRYPOINT ["python", "/app/run.py"]
