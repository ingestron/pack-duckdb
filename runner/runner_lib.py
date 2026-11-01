# The runner's pure parts: the DuckDB secret that signs in as the job's managed
# identity, and the local paths in a run.sql that a cloud job cannot see.
import re
from typing import Mapping

_REMOTE = ("abfss://", "az://", "https://")
# A quoted path read by read_parquet, read_csv or read_json_auto, or written by COPY … TO.
_PATHS = re.compile(r"(?:read_parquet|read_csv|read_json_auto)\(\s*'((?:[^']|'')*)'|\bTO\s+'((?:[^']|'')*)'")


def remote(location: str) -> bool:
    """True when the location is in Azure storage or on the web, not on the job's disk."""
    return location.startswith(_REMOTE)


def secret_sql(environ: Mapping[str, str]) -> str:
    """The secret DuckDB's azure extension signs in with: the job's managed identity."""
    client = environ.get("AZURE_CLIENT_ID")
    if client:
        quoted = client.replace("'", "''")
        return f"CREATE OR REPLACE SECRET ingestron (TYPE azure, PROVIDER managed_identity, CLIENT_ID '{quoted}');"
    return "CREATE OR REPLACE SECRET ingestron (TYPE azure, PROVIDER credential_chain, CHAIN 'managed_identity');"


def local_paths(sql: str) -> list[str]:
    """Every path the SQL reads or writes that is not remote, in order."""
    found = [(read or written).replace("''", "'") for read, written in _PATHS.findall(sql)]
    return [path for path in found if not remote(path)]


_VERSION = re.compile(r"^(\d+)\.\d+\.\d+(-[0-9A-Za-z.-]+)?$")


def image_tags(version: str) -> list[str]:
    """The tags a runner-v<version> release pushes: the version, and its major for a final release only."""
    match = _VERSION.match(version)
    if not match:
        raise ValueError(f'"{version}" is not a version such as 1.0.0')
    return [version] if match.group(2) else [version, match.group(1)]


if __name__ == "__main__":
    import sys

    print(" ".join(image_tags(sys.argv[1])))
