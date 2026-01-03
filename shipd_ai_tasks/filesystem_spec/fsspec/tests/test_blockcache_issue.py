# import pytest
# import fsspec
# from fsspec.implementations.memory import MemoryFileSystem

# # Import BlockCache from your local installation
# try:
#     from fsspec.caching import BlockCache
# except ImportError:
#     from fsspec.implementations.cached import BlockCache

# class TrackingFile:
#     def __init__(self, obj, fs, blocksize):
#         self.obj = obj
#         self.fs = fs
#         self.blocksize = blocksize
#         self.size = obj.size

#     def _fetch_range(self, start, end):
#         self.obj.seek(start)
#         data = self.obj.read(end - start)
#         self.fs.bytes_fetched += len(data)
#         return data

#     def read(self, size=-1): return self.obj.read(size)
#     def seek(self, loc, whence=0): return self.obj.seek(loc, whence)
#     def tell(self): return self.obj.tell()
#     def close(self): return self.obj.close()
#     def __getattr__(self, item): return getattr(self.obj, item)

# class TrackingMemoryFileSystem(MemoryFileSystem):
#     def __init__(self, *args, **kwargs):
#         super().__init__(*args, **kwargs)
#         self.bytes_fetched = 0

#     def _open(self, path, mode="rb", block_size=None, **kwargs):
#         f = super()._open(path, mode, **kwargs)
#         return TrackingFile(f, self, block_size or 100)

# def test_blockcache_thrashing_double_read():
#     block_size = 100
#     cache_limit_blocks = 5 
#     read_amount = 800       
    
#     backend = TrackingMemoryFileSystem()
#     backend.pipe("data.bin", b"x" * 1000)
    
#     tgt_file = backend.open("data.bin", "rb", block_size=block_size)
    
#     cache = BlockCache(
#         blocksize=block_size,
#         fetcher=tgt_file._fetch_range,
#         size=tgt_file.size,
#         maxblocks=cache_limit_blocks
#     )

#     # REPLICATING THE BUGGY LOGIC
#     start, end = 0, read_amount
#     start_block = start // block_size
#     end_block = (end - 1) // block_size
    
#     # 1. The Pre-fetch Loop: fills cache then starts evicting
#     # Blocks 0, 1, 2, 3, 4 are fetched. Then 5 evicts 0, 6 evicts 1, 7 evicts 2.
#     for i in range(start_block, end_block + 1):
#         cache._fetch_block_cached(i)
        
#     # 2. The Actual Read: tries to retrieve evicted blocks
#     for i in range(start_block, end_block + 1):
#         # Using _fetch_block as suggested by your AttributeError
#         cache._fetch_block(i)
    
#     print(f"\n--- DEBUG INFO ---")
#     print(f"Requested: {read_amount} bytes")
#     print(f"Actual Backend Fetches: {backend.bytes_fetched} bytes")
#     print(f"------------------")

#     # If the bug is present, backend.bytes_fetched will be 1100.
#     assert backend.bytes_fetched <= read_amount, \
#         f"Double Read! Requested {read_amount}, but fetched {backend.bytes_fetched}"
import pytest
import fsspec
import os
from fsspec.implementations.memory import MemoryFileSystem

class FileWrapper:
    def __init__(self, obj, block_size, fs):
        self.obj = obj
        self.blocksize = block_size
        self.fs = fs
        self._closed = False
        self.size = obj.size

    @property
    def closed(self): return self._closed or self.obj.closed
    @closed.setter
    def closed(self, value): self._closed = value

    def _fetch_range(self, start, end):
        # This is the ONLY place we want data to be pulled from
        self.obj.seek(start)
        data = self.obj.read(end - start)
        self.fs.bytes_fetched += len(data)
        return data

    def read(self, size=-1): return self.obj.read(size)
    def seek(self, loc, whence=0): return self.obj.seek(loc, whence)
    def tell(self): return self.obj.tell()
    def close(self): return self.obj.close()
    def __getattr__(self, item): return getattr(self.obj, item)
    def __enter__(self): return self
    def __exit__(self, *args): self.close()

class TrackingMemoryFileSystem(MemoryFileSystem):
    protocol = "trackmem_final"
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.bytes_fetched = 0

    def _open(self, path, mode="rb", block_size=None, **kwargs):
        f = super()._open(path, mode, **kwargs)
        return FileWrapper(f, block_size or 100, self)

fsspec.register_implementation("trackmem_final", TrackingMemoryFileSystem, clobber=True)

def test_blockcache_thrashing_double_read():
    block_size = 100
    cache_limit = 5
    read_amount = 800
    
    backend = TrackingMemoryFileSystem()
    backend.pipe("data.bin", b"x" * 1000)
    
    # We use cache_type="readahead" or "parts" which often maps to 
    # the internal BlockCache logic in various fsspec versions.
    # We also pass the backend instance directly.
    fs = fsspec.filesystem(
        "blockcache",
        target_protocol="trackmem_final",
        cache_type="blockcache", 
        block_size=block_size,
        cache_options={"maxblocks": cache_limit}
    )
    fs.target_gfs = backend 

    with fs.open("data.bin", "rb") as f:
        # FORCE: If fsspec chose MMapCache, we manually switch to BlockCache logic
        # this is sometimes necessary in test environments to override defaults
        from fsspec.caching import BlockCache
        if not isinstance(f.cache, BlockCache):
            f.cache = BlockCache(f.blocksize, f._fetch_range, f.size, maxblocks=cache_limit)
        
        data = f.read(read_amount)
    
    print(f"\n--- DEBUG ---")
    print(f"Backend Fetched: {backend.bytes_fetched} bytes")
    print(f"Cache Instance: {type(f.cache)}")
    print(f"-------------")

    assert backend.bytes_fetched > read_amount, \
        f"Bug NOT reproduced. Fetched {backend.bytes_fetched}, expected > {read_amount}"