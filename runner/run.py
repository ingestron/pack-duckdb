# The DuckDB runner: runs a deployed run.sql in a fresh database, signed in to
# Azure storage as the job's managed identity, and exits non-zero on failure so
# whatever started the job sees it failed.
import os
import re
import sys
import time
from typing import Mapping

from runner_lib import local_paths, remote, secret_sql

DATABASE = "/tmp/ingestron.duckdb"
USAGE = (
    "INGESTRON_SQL must name the run.sql to run, such as "
    "abfss://deploy@<account>.dfs.core.windows.net/sales/dev/run.sql"
)


def read_sql(connection, location: str) -> str:
    """run.sql's text, from Azure storage through DuckDB or from a local file."""
    if remote(location):
        return connection.execute("SELECT content FROM read_text(?)", [location]).fetchone()[0]
    with open(location, encoding="utf-8") as file:
        return file.read()


def main(environ: Mapping[str, str]) -> int:
    import duckdb

    location = environ.get("INGESTRON_SQL", "")
    if not location:
        print(USAGE, file=sys.stderr)
        return 2
    if os.path.exists(DATABASE):
        os.remove(DATABASE)
    started = time.monotonic()
    extensions = environ.get("DUCKDB_EXTENSION_DIRECTORY")
    config = {"extension_directory": extensions} if extensions else {}
    connection = duckdb.connect(DATABASE, config=config)
    try:
        connection.execute("LOAD azure; SET azure_transport_option_type = 'curl';")
        connection.execute(secret_sql(environ))
        sql = read_sql(connection, location)
        local = local_paths(sql)
        if local and environ.get("INGESTRON_ALLOW_LOCAL") != "1":
            print(
                "run.sql reads or writes paths a job in Azure cannot reach: "
                f"{', '.join(local[:3])}. Generate it for an environment whose paths are abfss://.",
                file=sys.stderr,
            )
            return 1
        connection.execute(sql)
    except (duckdb.Error, OSError) as error:
        print(f"The run failed: {error}", file=sys.stderr)
        return 1
    finally:
        connection.close()
    tables = len(re.findall(r"^COPY \(", sql, re.MULTILINE))
    print(f"Built {tables} tables in {time.monotonic() - started:.1f} s.")
    return 0


if __name__ == "__main__":
    sys.exit(main(os.environ))
