import os
import pytest
import fsspec
from fsspec.implementations.cached import CachingFileSystem

class TrackingFileSystem(fsspec.implementations.local.LocalFileSystem):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.bytes_fetched = 0

    def _cat_file(self, path, start=None, end=None, **kwargs):
        # Tracking exactly what hits the 'disk'
        size = (end if end is not None else os.path.getsize(path)) - (start or 0)
        self.bytes_fetched += size
        return super()._cat_file(path, start=start, end=end, **kwargs)

def test_block_cache_double_read_repro(tmpdir):
    # 1. Setup Data
    remote_file = os.path.join(tmpdir, "remote_source.bin")
    data_size = 50 * 1024 * 1024  # 50MB
    with open(remote_file, "wb") as f:
        f.write(os.urandom(data_size))

    # 2. Setup Cache with small capacity to guarantee eviction
    # 10MB cache, 1MB blocks.
    # Reading 50MB will force the cache to cycle 5 times.
    block_size = 1024 * 1024
    cache_limit = 10 * block_size 
    
    backend = TrackingFileSystem()
    
    # We use the explicit 'blockcache' method which has the pre-fetch bug
    fs = CachingFileSystem(
        target_protocol="local",
        cache_storage=str(tmpdir.mkdir("cache_storage")),
        method="blockcache", 
        target_options={},
        block_size=block_size,
        max_size=cache_limit
    )
    fs.target = backend

    # 3. Read sequentially
    with fs.open(remote_file, "rb") as f:
        # Read in small chunks to allow the pre-fetcher to get ahead of us
        chunk_to_read = 512 * 1024
        read_data = b""
        while True:
            part = f.read(chunk_to_read)
            if not part:
                break
            read_data += part

    # 4. The Proof
    print(f"\nFile Size: {data_size / (1024*1024):.2f} MB")
    print(f"Total Fetched from Backend: {backend.bytes_fetched / (1024*1024):.2f} MB")

    # If the bug exists, fetched will be significantly > data_size (e.g., 60MB+)
    # because the pre-fetcher pushed blocks out before we could read them.
    assert backend.bytes_fetched <= data_size, \
        f"Regression: Fetched {backend.bytes_fetched} bytes for {data_size} byte file!"