# The runner's pure parts: the DuckDB secret for the job's identity, and the
# local paths a cloud job cannot see.
import unittest

from runner_lib import image_tags, local_paths, remote, secret_sql


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

    def test_only_azure_paths_are_remote(self):
        sql = (
            "SELECT * FROM read_csv('az://c/orders.csv', header = true);\n"
            "SELECT * FROM read_json_auto('https://acct.blob.core.windows.net/c/x.json');\n"
            "COPY (SELECT 1) TO 'abfss://p@a.dfs.core.windows.net/x.parquet' (FORMAT parquet);"
        )
        self.assertEqual(local_paths(sql), ["https://acct.blob.core.windows.net/c/x.json"])
        self.assertTrue(remote("abfss://p@a.dfs.core.windows.net/run.sql"))
        self.assertFalse(remote("/work/run.sql"))


class MorePathsTest(unittest.TestCase):
    def test_every_reader_and_a_list_of_files(self):
        sql = (
            "SELECT * FROM READ_PARQUET(['./a.parquet', './b.parquet']);\n"
            "SELECT * FROM read_csv_auto('./c.csv');\n"
            "SELECT * FROM parquet_scan('./d.parquet');\n"
            "SELECT * FROM './e.parquet';\n"
            "copy (select 1) to './f.parquet' (format parquet);"
        )
        self.assertEqual(
            local_paths(sql),
            ["./a.parquet", "./b.parquet", "./c.csv", "./d.parquet", "./e.parquet", "./f.parquet"],
        )

    def test_comments_and_text_are_not_paths(self):
        sql = (
            "-- read_parquet('./old.parquet')\n"
            "SELECT 'GO TO ' AS a, 'see read_csv(''./x'')' AS b;"
        )
        self.assertEqual(local_paths(sql), [])

    def test_azure_prefixes_are_remote_and_the_web_is_not(self):
        for location in ["abfss://f@a.dfs.core.windows.net/x", "abfs://f@a/x", "az://c/x", "azure://c/x"]:
            self.assertTrue(remote(location), location)
        self.assertFalse(remote("https://acct.blob.core.windows.net/c/x"))


class TagsTest(unittest.TestCase):
    def test_a_release_moves_its_major_tag(self):
        self.assertEqual(image_tags("1.0.0"), ["1.0.0", "1"])
        self.assertEqual(image_tags("2.3.4"), ["2.3.4", "2"])

    def test_a_pre_release_moves_no_tag(self):
        self.assertEqual(image_tags("1.1.0-rc.1"), ["1.1.0-rc.1"])

    def test_a_tag_that_is_not_a_version_is_refused(self):
        with self.assertRaises(ValueError):
            image_tags("latest")


if __name__ == "__main__":
    unittest.main()
