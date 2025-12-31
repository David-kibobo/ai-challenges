import logging
from fsspec.implementations.cached import SimpleCacheFileSystem
import tempfile

logging.basicConfig(level=logging.DEBUG)

td = tempfile.TemporaryDirectory()
fs = SimpleCacheFileSystem(target_protocol="memory", cache_storage=td.name)

urls = [
    "simplecache::memory://canon/params/file?a=1&b=2",
    "simplecache::memory://canon/params/file?b=2&a=1",
]

for url in urls:
    print("orig:", url)
    normalized = fs._get_cache_key(url)
    print("normalized:", normalized)
    cache_hash = fs._mapper(url)
    print("cache hash:", cache_hash)
    print("-" * 40)
