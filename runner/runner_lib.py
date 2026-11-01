# The runner's pure parts: the DuckDB secret that signs in as the job's managed
# identity, and the local paths in a run.sql that a cloud job cannot see.
import re
from typing import Mapping

_REMOTE = ("abfss://", "abfs://", "az://", "azure://")
_LITERAL = r"'(?:[^']|'')*'"
# A reader's first argument (one path or a list of them), or COPY's target.
_READ = re.compile(
    rf"\b(?:read_\w+|parquet_scan)\s*\(\s*(\[[^\]]*\]|{_LITERAL})|\)\s*TO\s+({_LITERAL})",
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
    """The SQL with comments blanked and the text of 'strings' and "names" replaced, at the same positions."""
    out: list[str] = []
    index, quote = 0, ""
    while index < len(sql):
        char = sql[index]
        if quote:
            if sql.startswith(quote * 2, index):
                out.append("xx")
                index += 2
                continue
            if char == quote:
                quote = ""
                out.append(char)
            else:
                out.append("x" if char != "\n" else char)
            index += 1
            continue
        end = _comment_end(sql, index)
        if end > index:
            out.append("".join(c if c == "\n" else " " for c in sql[index:end]))
            index = end
            continue
        if char in "'\"":
            quote = char
        out.append(char)
        index += 1
    return "".join(out)


def _comment_end(sql: str, index: int) -> int:
    """Where a comment starting at index ends, or index when none starts there."""
    if sql.startswith("--", index):
        end = sql.find("\n", index)
        return len(sql) if end == -1 else end
    if sql.startswith("/*", index):
        end = sql.find("*/", index + 2)
        return len(sql) if end == -1 else end + 2
    return index


def local_paths(sql: str) -> list[str]:
    """Every path the SQL reads or writes that is not in Azure storage, in order."""
    found: list[str] = []
    for match in _READ.finditer(_masked(sql)):
        for group in range(1, 3):
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
