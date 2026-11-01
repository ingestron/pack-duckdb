# The DuckDB runner: Python with DuckDB and its azure extension, installed at
# build time so a run downloads nothing. Public, so jobs pull it anonymously.
FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159

LABEL org.opencontainers.image.source="https://github.com/ingestron/pack-duckdb" \
      org.opencontainers.image.description="Runs an Ingestron project's generated DuckDB SQL in Azure, signed in as the job's managed identity." \
      org.opencontainers.image.licenses="Apache-2.0" \
      org.opencontainers.image.vendor="IntentLabs"

ENV DUCKDB_EXTENSION_DIRECTORY=/opt/duckdb/extensions
COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir --require-hashes -r /tmp/requirements.txt \
 && mkdir -p /opt/duckdb/extensions \
 && python -c "import duckdb; c = duckdb.connect(config={'extension_directory': '/opt/duckdb/extensions'}); c.execute('INSTALL azure')" \
 && chmod -R a+rX /opt/duckdb

WORKDIR /app
COPY run.py runner_lib.py /app/
USER 1000:1000
ENTRYPOINT ["python", "/app/run.py"]
