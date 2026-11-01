# The runner's pure parts: the DuckDB secret that signs in as the job's managed
# identity, and the local paths in a run.sql that a cloud job cannot see.
import re
from typing import Mapping

_REMOTE = ("abfss://", "abfs://", "az://", "azure://")
_LITERAL = r"'(?:[^']|'')*'"
# A reader's first argument (one path or a list of them), a file read as a table, or COPY's target.
_READ = re.compile(
    rf"\b(?:read_\w+|parquet_scan)\s*\(\s*(\[[^\]]*\]|{_LITERAL})|\bFROM\s+({_LITERAL})|\)\s*TO\s+({_LITERAL})",
    re.IGNORECASE,
)


def remote(location: str) -> bool:
    """True when the location is in Azure storage, which the azure extension reads."""
    return location.startswith(_REMOTE)


def secret_sql(environ: Mapping[str, str]) -> str:
    """The secret DuckDB's azure extension signs in with: the job's managed identity."""
    client = environ.get("AZURE_CLIENT_ID")
    if client:
        quoted = client.replace("'", "''")
        return f"CREATE OR REPLACE SECRET ingestron (TYPE azure, PROVIDER managed_identity, CLIENT_ID '{quoted}');"
    return "CREATE OR REPLACE SECRET ingestron (TYPE azure, PROVIDER credential_chain, CHAIN 'managed_identity');"


def _masked(sql: str) -> str:
    """The SQL with -- comments blanked and text in quotes replaced, at the same positions."""
    out: list[str] = []
    index, quoted = 0, False
    while index < len(sql):
        char = sql[index]
        if quoted and sql.startswith("''", index):
            out.append("xx")
            index += 2
            continue
        if char == "'":
            quoted = not quoted
            out.append(char)
        elif quoted:
            out.append("x" if char != "\n" else char)
        elif sql.startswith("--", index):
            end = sql.find("\n", index)
            end = len(sql) if end == -1 else end
            out.append(" " * (end - index))
            index = end
            continue
        else:
            out.append(char)
        index += 1
    return "".join(out)


def local_paths(sql: str) -> list[str]:
    """Every path the SQL reads or writes that is not in Azure storage, in order."""
    found: list[str] = []
    for match in _READ.finditer(_masked(sql)):
        for group in range(1, 4):
            if match.group(group) is not None:
                text = sql[match.start(group) : match.end(group)]
                found += [item[1:-1].replace("''", "'") for item in re.findall(_LITERAL, text)]
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
