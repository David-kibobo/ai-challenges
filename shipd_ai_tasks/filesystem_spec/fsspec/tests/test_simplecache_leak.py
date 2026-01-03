# -*- coding: utf-8 -*-
import pytest
import fsspec
import os
from fsspec.implementations.memory import MemoryFileSystem
from fsspec.implementations.cached import SimpleCacheFileSystem


class TrackingMemoryFileSystem(MemoryFileSystem):
    protocol = "trackmem"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.open_count = 0

    def _open(self, path, mode="rb", **kwargs):
        self.open_count += 1

        if "://" in path:
            _, path_part = path.split("://", 1)
        else:
            path_part = path

        clean_path = path_part.split("?")[0].split("#")[0]
        clean_path = os.path.normpath(clean_path)

        return super()._open(clean_path, mode, **kwargs)


fsspec.register_implementation("trackmem", TrackingMemoryFileSystem, clobber=True)


@pytest.fixture
def setup_fs(tmp_path):
    storage = tmp_path / "cache_storage"
    storage.mkdir()
    backend = TrackingMemoryFileSystem()
    fs = SimpleCacheFileSystem(target_protocol="trackmem", cache_storage=str(storage))
    fs.fs = backend
    return fs, backend, storage


def test_deduplication_behavior(setup_fs):
    fs, backend, _ = setup_fs

    backend.pipe("file", b"data")
    path = "trackmem://file"

    variants = [
        f"{path}?a=1&b=2",
        f"{path}?b=2&a=1",
        f"{path}#fragment",
        "trackmem://./file",
    ]

    initial_count = backend.open_count

    for v in variants:
        with fs.open(v, "rb") as f:
            assert f.read() == b"data"

    new_calls = backend.open_count - initial_count
    assert new_calls == 1


def test_major_parameters_behavior(setup_fs):
    fs, backend, _ = setup_fs
    backend.pipe("file", b"data")
    path = "trackmem://file"

    initial_count = backend.open_count

    fs.open(f"{path}?version=1").read()
    fs.open(f"{path}?version=2").read()

    fs.open(f"{path}?dataset=A").read()
    fs.open(f"{path}?dataset=B").read()

    new_calls = backend.open_count - initial_count
    assert new_calls == 4


def test_bounded_disk_growth_behavior(setup_fs):
    fs, backend, storage = setup_fs
    backend.pipe("file", b"data")
    path = "trackmem://file"

    initial_count = backend.open_count

    for i in range(50):
        fs.open(f"{path}?ignore_me={i}").read()

    new_calls = backend.open_count - initial_count
    cache_files = [p for p in storage.rglob("*") if p.is_file()]

    assert new_calls == 1
    assert len(cache_files) == 1


def test_fetch_preserves_original_url_logic(tmp_path, monkeypatch):
    storage = tmp_path / "cache_storage"
    storage.mkdir()

    captured_paths = []
    orig_open = MemoryFileSystem._open

    def mock_open(self, path, *args, **kwargs):
        captured_paths.append(path)

        if "://" in path:
            _, p = path.split("://", 1)
        else:
            p = path
        clean = p.split("?")[0].split("#")[0]
        return orig_open(self, clean, *args, **kwargs)

    monkeypatch.setattr(MemoryFileSystem, "_open", mock_open)
    fsspec.register_implementation("memtest", MemoryFileSystem, clobber=True)

    fs = SimpleCacheFileSystem(target_protocol="memtest", cache_storage=str(storage))
    fs.fs.pipe("file", b"data")

    raw_url = "memtest://file?z=9&a=1"
    fs.open(raw_url).read()

    found_exact_match = False
    for p in captured_paths:
        if "z=9&a=1" in str(p):
            found_exact_match = True
            break

    assert found_exact_match


def test_interface_consistency_behavior(tmp_path):
    backend = TrackingMemoryFileSystem()
    backend.pipe("file", b"interface_test")

    storage = str(tmp_path / "consistency_cache")
    fs = SimpleCacheFileSystem(target_protocol="trackmem", cache_storage=storage)
    fs.fs = backend

    with fs.open("trackmem://file?type=direct", "rb") as f:
        assert f.read() == b"interface_test"

    url = "simplecache::trackmem://file?type=chained"
    with fsspec.open(url, cache_storage=storage, mode="rb") as f:
        assert f.read() == b"interface_test"


def test_custom_identity_configuration(tmp_path):
    storage = tmp_path / "custom_config_storage"
    storage.mkdir()
    backend = TrackingMemoryFileSystem()
    backend.pipe("file", b"data")

    fs = SimpleCacheFileSystem(
        target_protocol="trackmem",
        cache_storage=str(storage),
        cache_options={"same_file_keys": ["id"]},
    )
    fs.fs = backend

    path = "trackmem://file"
    initial_count = backend.open_count

    fs.open(f"{path}?version=1&id=100").read()
    fs.open(f"{path}?version=2&id=100").read()
    fs.open(f"{path}?version=1&id=101").read()

    new_calls = backend.open_count - initial_count
    assert new_calls == 2


def test_case_insensitive_deduplication(tmp_path):
    storage = tmp_path / "case_storage"
    storage.mkdir()
    backend = TrackingMemoryFileSystem()
    backend.pipe("file", b"data")

    fs = SimpleCacheFileSystem(
        target_protocol="trackmem",
        cache_storage=str(storage),
        cache_options={"same_file_keys": ["CASE", "mixedCASE"]},
    )
    fs.fs = backend
    path = "trackmem://file"

    initial_count = backend.open_count

    fs.open(f"{path}?case=1").read()
    fs.open(f"{path}?CASE=1").read()
    fs.open(f"{path}?mixedcase=99").read()

    new_calls = backend.open_count - initial_count
    assert new_calls == 2
    