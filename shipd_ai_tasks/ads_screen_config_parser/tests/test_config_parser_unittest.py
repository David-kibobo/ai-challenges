import os
import unittest
from pathlib import Path
import importlib.util

MODULE_PATH = Path(__file__).resolve().parents[1] / "config_parser.py"
spec = importlib.util.spec_from_file_location("config_parser", str(MODULE_PATH))
config_parser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config_parser)  # type: ignore[attr-defined]


class TestConfigParser(unittest.TestCase):
    def _write_temp_config(self, tmp_dir: Path, content: str) -> Path:
        cfg = tmp_dir / "server.conf"
        cfg.write_text(content, encoding="utf-8")
        return cfg

    def setUp(self):
        self.tmp_dir = Path(self._get_tmpdir())
        self.tmp_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        # Cleanup temp directory
        for p in sorted(self.tmp_dir.rglob('*'), reverse=True):
            try:
                if p.is_file():
                    p.unlink()
                else:
                    p.rmdir()
            except Exception:
                pass
        try:
            self.tmp_dir.rmdir()
        except Exception:
            pass

    def _get_tmpdir(self) -> str:
        import tempfile
        return tempfile.mkdtemp(prefix="cfgparser_ut_")

    def test_basic_parse(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath=/opt/service
            REREAD_ON_QUERY=True
            SSL_ENABLED=True
            MAX_PAYLOAD=4096
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/opt/service",
                "REREAD_ON_QUERY": True,
                "SSL_ENABLED": True,
                "MAX_PAYLOAD": 4096,
            },
        )

    def test_optional_max_payload_missing(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath=/data
            REREAD_ON_QUERY=False
            SSL_ENABLED=True
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/data",
                "REREAD_ON_QUERY": False,
                "SSL_ENABLED": True,
                "MAX_PAYLOAD": None,
            },
        )

    def test_comments_and_whitespace(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            # comment line
              linuxpath =   /tmp/data.txt  
            REREAD_ON_QUERY = True
            SSL_ENABLED=False
            # trailing comment
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/tmp/data.txt",
                "REREAD_ON_QUERY": True,
                "SSL_ENABLED": False,
                "MAX_PAYLOAD": None,
            },
        )

    def test_duplicate_keys_last_wins(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath=/first
            linuxpath=/second
            REREAD_ON_QUERY=False
            REREAD_ON_QUERY=True
            SSL_ENABLED=False
            SSL_ENABLED=True
            MAX_PAYLOAD=1024
            MAX_PAYLOAD=2048
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/second",
                "REREAD_ON_QUERY": True,
                "SSL_ENABLED": True,
                "MAX_PAYLOAD": 2048,
            },
        )

    def test_large_file_streaming_efficiency(self):
        lines = []
        for i in range(20000):
            lines.append(f"UNRELATED_KEY_{i}=value_{i}")
        lines += [
            "# final valid settings",
            "linuxpath=/var/lib/ads/200k.txt",
            "REREAD_ON_QUERY=True",
            "SSL_ENABLED=False",
            "MAX_PAYLOAD=8192",
        ]
        cfg = self._write_temp_config(self.tmp_dir, "\n".join(lines))
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/var/lib/ads/200k.txt",
                "REREAD_ON_QUERY": True,
                "SSL_ENABLED": False,
                "MAX_PAYLOAD": 8192,
            },
        )

    def test_quoted_values_are_accepted(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath="/path/with spaces/file.txt"
            REREAD_ON_QUERY='True'
            SSL_ENABLED="False"
            MAX_PAYLOAD='2048'
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/path/with spaces/file.txt",
                "REREAD_ON_QUERY": True,
                "SSL_ENABLED": False,
                "MAX_PAYLOAD": 2048,
            },
        )

    def test_mixed_case_keys_are_ignored_and_trigger_missing(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            LinuxPath=/data
            reread_on_query=True
            ssl_enabled=False
            MAX_PAYLOAD=10
            """.strip(),
        )
        with self.assertRaises(ValueError) as ctx:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx.exception), "Missing required field: linuxpath")

    def test_malformed_and_irrelevant_lines_ignored(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            # missing equals will be ignored
            not_a_pair_line
            also:ignored
            linuxpath=/data
            REREAD_ON_QUERY=True
            SSL_ENABLED=False
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(result["linuxpath"], "/data")
        self.assertIs(result["REREAD_ON_QUERY"], True)
        self.assertIs(result["SSL_ENABLED"], False)
        self.assertIsNone(result["MAX_PAYLOAD"])

    def test_missing_required_fields(self):
        # Missing linuxpath
        cfg = self._write_temp_config(self.tmp_dir, "\n".join(["REREAD_ON_QUERY=True", "SSL_ENABLED=True"]))
        with self.assertRaises(ValueError) as ctx1:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx1.exception), "Missing required field: linuxpath")

        # Missing REREAD_ON_QUERY
        cfg = self._write_temp_config(self.tmp_dir, "\n".join(["linuxpath=/opt", "SSL_ENABLED=False"]))
        with self.assertRaises(ValueError) as ctx2:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx2.exception), "Missing required field: REREAD_ON_QUERY")

        # Missing SSL_ENABLED
        cfg = self._write_temp_config(self.tmp_dir, "\n".join(["linuxpath=/opt", "REREAD_ON_QUERY=True"]))
        with self.assertRaises(ValueError) as ctx3:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx3.exception), "Missing required field: SSL_ENABLED")

    def test_invalid_boolean_values_raise(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath=/data
            REREAD_ON_QUERY=YES
            SSL_ENABLED=True
            """.strip(),
        )
        with self.assertRaises(ValueError) as ctx:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx.exception), "Invalid boolean value for REREAD_ON_QUERY: YES")

    def test_invalid_boolean_values_raise_for_ssl(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath=/data
            REREAD_ON_QUERY=True
            SSL_ENABLED=0
            """.strip(),
        )
        with self.assertRaises(ValueError) as ctx:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx.exception), "Invalid boolean value for SSL_ENABLED: 0")

    def test_invalid_integer_for_max_payload(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath=/data
            REREAD_ON_QUERY=False
            SSL_ENABLED=True
            MAX_PAYLOAD=two_k
            """.strip(),
        )
        with self.assertRaises(ValueError) as ctx:
            config_parser.parse_config(str(cfg))
        self.assertEqual(str(ctx.exception), "Invalid integer value for MAX_PAYLOAD: two_k")

    def test_mismatched_quotes_are_left_as_is(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            linuxpath='"/data
            REREAD_ON_QUERY=True
            SSL_ENABLED=True
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(result["linuxpath"], "'\"/data")

    def test_handles_trailing_and_leading_whitespace_only_lines(self):
        cfg = self._write_temp_config(
            self.tmp_dir,
            """
            
            \t\t
            linuxpath=/x
            
            REREAD_ON_QUERY=True
            \t
            SSL_ENABLED=False
            
            """.strip(),
        )
        result = config_parser.parse_config(str(cfg))
        self.assertEqual(
            result,
            {
                "linuxpath": "/x",
                "REREAD_ON_QUERY": True,
                "SSL_ENABLED": False,
                "MAX_PAYLOAD": None,
            },
        )


if __name__ == "__main__":
    unittest.main()
