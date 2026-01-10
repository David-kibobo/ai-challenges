import pytest
import fsspec
import os
from fsspec.spec import AbstractBufferedFile
from fsspec.implementations.memory import MemoryFileSystem
from fsspec.implementations.cached import SimpleCacheFileSystem, CachingFileSystem

class StubBufferedFile(AbstractBufferedFile):
    def __init__(self, fs, path, mode="rb", data=b""):
        self.data = data
        super().__init__(fs, path, mode, size=len(data))

    def _fetch_range(self, start, end):
        return self.data[start:end]

class StubBackend(MemoryFileSystem):
    protocol = "stub"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.open_count = 0
        self.last_path = None
        self.data = b"data"

    def _open(self, path, mode="rb", **kwargs):
        self.open_count += 1
        self.last_path = path
        return StubBufferedFile(self, "target", mode=mode, data=self.data)

    def cat_file(self, path, start=None, end=None, **kwargs):
        data = self.data
        if start is not None and end is not None:
            return data[start:end]
        if start is not None:
            return data[start:]
        if end is not None:
            return data[:end]
        return data

    def info(self, path, **kwargs):
        return {
            "name": "target",
            "size": len(self.data),
            "type": "file",
            "created": 0,
        }

    def ukey(self, path):
        return "constant-hash"

fsspec.register_implementation("stub", StubBackend, clobber=True)

@pytest.fixture
def storage_dir(tmp_path):
    d = tmp_path / "cache_storage"
    d.mkdir()
    return str(d)

@pytest.fixture
def backend():
    return StubBackend()

@pytest.fixture(params=[SimpleCacheFileSystem, CachingFileSystem])
def fs(request, storage_dir, backend):
    fs_cls = request.param
    fs = fs_cls(fs=backend, cache_storage=storage_dir)
    fs.kwargs['cache_options'] = {'enable_normalization': True}
    return fs

def get_cache_count(storage_dir):
    files = [
        f
        for f in os.listdir(storage_dir)
        if os.path.isfile(os.path.join(storage_dir, f))
    ]
    content_files = [f for f in files if f != "cache"]
    return len(content_files)

def test_normalization_deduplication(fs, backend, storage_dir):
    base = "stub://file"
    with fs.open(f"{base}?id=1") as f:
        f.read()
    initial_backend_calls = backend.open_count
    assert get_cache_count(storage_dir) == 1
    with fs.open(f"{base}?id=1#fragment") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    assert backend.open_count == initial_backend_calls

def test_redundant_path_resolution(fs, backend, storage_dir):
    with fs.open("stub://folder/file") as f:
        f.read()
    initial_backend_calls = backend.open_count
    assert get_cache_count(storage_dir) == 1
    with fs.open("stub://folder/./file") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    assert backend.open_count == initial_backend_calls

def test_parent_directory_resolution(fs, backend, storage_dir):
    with fs.open("stub://folder/sub/../file") as f:
        f.read()
    initial_backend_calls = backend.open_count
    assert get_cache_count(storage_dir) == 1
    with fs.open("stub://folder/file") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    assert backend.open_count == initial_backend_calls

def test_cache_miss_on_different_params(fs, backend, storage_dir):
    base = "stub://file"
    with fs.open(f"{base}?id=1") as f:
        f.read()
    initial_files = get_cache_count(storage_dir)
    initial_calls = backend.open_count
    with fs.open(f"{base}?id=2") as f:
        f.read()
    assert get_cache_count(storage_dir) > initial_files
    assert backend.open_count > initial_calls

def test_default_all_params_significant(fs, backend, storage_dir):
    base = "stub://file"
    with fs.open(f"{base}?noise=1") as f:
        f.read()
    initial_files = get_cache_count(storage_dir)
    initial_calls = backend.open_count
    with fs.open(f"{base}?noise=2") as f:
        f.read()
    assert get_cache_count(storage_dir) > initial_files
    assert backend.open_count > initial_calls

def test_upstream_preservation(fs, backend):
    dirty_url = "stub://file?important=true&ignored=true#section1"
    with fs.open(dirty_url) as f:
        f.read()
    assert "important=true" in backend.last_path
    assert "#section1" in backend.last_path

def test_safe_default_sorting(fs, backend):
    base = "stub://file"
    with fs.open(f"{base}?a=1&b=2") as f:
        f.read()
    initial_calls = backend.open_count
    with fs.open(f"{base}?b=2&a=1") as f:
        f.read()
    assert backend.open_count == initial_calls

def test_opt_in_filtering_case_insensitive(fs, backend, storage_dir):
    fs.kwargs["cache_options"] = {"same_file_keys": ["ID"]}
    base = "stub://file"
    with fs.open(f"{base}?id=1&noise=A") as f:
        f.read()
    initial_calls = backend.open_count
    assert get_cache_count(storage_dir) == 1
    with fs.open(f"{base}?id=1&noise=B") as f:
        f.read()
    assert backend.open_count == initial_calls
    assert get_cache_count(storage_dir) == 1

def test_malformed_url_passthrough(fs, backend):
    path = "stub://file"
    with fs.open(path) as f:
        f.read()
    assert backend.open_count >= 1

@pytest.mark.parametrize("fs_cls", [SimpleCacheFileSystem, CachingFileSystem])
def test_normalization_disabled_by_default(fs_cls, backend, storage_dir):
    fs = fs_cls(fs=backend, cache_storage=storage_dir)
    fs.kwargs['cache_options'] = {}
    base = "stub://file"
    with fs.open(f"{base}?id=1") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    with fs.open(f"{base}?id=1#fragment") as f:
        f.read()
    assert get_cache_count(storage_dir) == 2

def test_dynamic_toggling_enable_normalization(fs, backend, storage_dir):
    base = "stub://file"
    with fs.open(f"{base}?id=1") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    with fs.open(f"{base}?id=1#fragment") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    fs.kwargs['cache_options']['enable_normalization'] = False
    with fs.open(f"{base}?id=1#fragment2") as f:
        f.read()
    assert get_cache_count(storage_dir) == 2

def test_dynamic_toggling_same_file_keys(fs, backend, storage_dir):
    base = "stub://file"
    fs.kwargs["cache_options"] = {"same_file_keys": ["id"]}
    with fs.open(f"{base}?id=1&noise=A") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    with fs.open(f"{base}?id=1&noise=B") as f:
        f.read()
    assert get_cache_count(storage_dir) == 1
    fs.kwargs["cache_options"]["same_file_keys"] = ["id", "noise"]
    with fs.open(f"{base}?id=1&noise=C") as f:
        f.read()
    assert get_cache_count(storage_dir) == 2
    