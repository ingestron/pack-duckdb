# The runner's pure parts: the DuckDB secret for the job's identity, and the
# local paths a cloud job cannot see.
import unittest

from runner_lib import local_paths, remote, secret_sql


class SecretTest(unittest.TestCase):
    def test_secret_uses_the_managed_identity(self):
        self.assertEqual(
            secret_sql({}),
            "CREATE OR REPLACE SECRET ingestron (TYPE azure, PROVIDER credential_chain, CHAIN 'managed_identity');",
        )

    def test_secret_names_a_user_assigned_identity(self):
        self.assertEqual(
            secret_sql({"AZURE_CLIENT_ID": "abc"}),
            "CREATE OR REPLACE SECRET ingestron (TYPE azure, PROVIDER managed_identity, CLIENT_ID 'abc');",
        )


class PathsTest(unittest.TestCase):
    def test_local_paths_are_found(self):
        sql = (
            "CREATE OR REPLACE TABLE \"bronze\".\"orders\" AS SELECT 1 FROM read_parquet('./samples/orders/*.parquet', filename = '_ingestron_file');\n"
            "COPY (SELECT 1) TO 'abfss://p@a.dfs.core.windows.net/x.parquet' (FORMAT parquet);"
        )
        self.assertEqual(local_paths(sql), ["./samples/orders/*.parquet"])

    def test_cloud_paths_are_not_local(self):
        sql = (
            "SELECT * FROM read_csv('az://c/orders.csv', header = true);\n"
            "SELECT * FROM read_json_auto('https://acct.blob.core.windows.net/c/x.json');\n"
            "COPY (SELECT 1) TO 'abfss://p@a.dfs.core.windows.net/x.parquet' (FORMAT parquet);"
        )
        self.assertEqual(local_paths(sql), [])
        self.assertTrue(remote("abfss://p@a.dfs.core.windows.net/run.sql"))
        self.assertFalse(remote("/work/run.sql"))


if __name__ == "__main__":
    unittest.main()
