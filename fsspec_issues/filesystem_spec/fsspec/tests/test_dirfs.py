import asyncio
from pathlib import Path
import fsspec
from fsspec.implementations.dirfs import DirFileSystem
import pytest


def test_dirfs_get_existing_dir_behavior(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"
    data_dir = remote_base / "dir"

    data_dir.mkdir(parents=True)
    (data_dir / "f.txt").write_text("hello world")
    local_base.mkdir()

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    target_dir = local_base / "dir"
    dirfs.get("dir", str(target_dir), recursive=True)
    dirfs.get("dir", str(target_dir), recursive=True)

    nested_file = target_dir / "dir" / "f.txt"
    correct_file = target_dir / "f.txt"

    assert not nested_file.exists()
    assert correct_file.exists()
    assert correct_file.read_text() == "hello world"


def test_dirfs_get_with_subdirectories(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"
    sub_dir = remote_base / "dir" / "sub"

    sub_dir.mkdir(parents=True)
    (sub_dir / "subfile.txt").write_text("sub content")
    (remote_base / "dir" / "root.txt").write_text("root file")
    local_base.mkdir()

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    target_dir = local_base / "dir"
    dirfs.get("dir", str(target_dir), recursive=True)

    expected_sub = target_dir / "sub" / "subfile.txt"
    expected_root = target_dir / "root.txt"

    assert expected_sub.exists()
    assert expected_root.exists()
    assert expected_sub.read_text() == "sub content"
    assert expected_root.read_text() == "root file"


def test_dirfs_get_empty_directory(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"
    empty_dir = remote_base / "dir" / "empty"
    empty_dir.mkdir(parents=True)

    local_base.mkdir()
    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    target_dir = local_base / "dir"
    dirfs.get("dir", str(target_dir), recursive=True)

    copied_empty_dir = target_dir / "empty"
    assert copied_empty_dir.exists()
    assert not any(copied_empty_dir.iterdir())


def test_dirfs_get_handles_file_dir_name_collision_overwrite(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir" / "inner").mkdir(parents=True)
    (remote_base / "dir" / "inner" / "file.txt").write_text("collision data")

    local_base.mkdir()
    (local_base / "dir").write_text("old file")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    dirfs.get("dir", str(local_base / "dir"), recursive=True, overwrite=True)

    expected_file = local_base / "dir" / "inner" / "file.txt"
    assert expected_file.exists()
    assert expected_file.read_text() == "collision data"


def test_dirfs_get_handles_file_dir_name_collision_no_overwrite(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir" / "inner").mkdir(parents=True)
    (remote_base / "dir" / "inner" / "file.txt").write_text("collision data")

    local_base.mkdir()
    (local_base / "dir").write_text("old file")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    with pytest.raises(FileExistsError):
        dirfs.get("dir", str(local_base / "dir"), recursive=True, overwrite=False)


@pytest.mark.asyncio
async def test_async_dirfs_get_handles_file_dir_name_collision(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir" / "inner").mkdir(parents=True)
    (remote_base / "dir" / "inner" / "file.txt").write_text("collision data")

    local_base.mkdir()
    (local_base / "dir").write_text("old file")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    await asyncio.to_thread(
        dirfs.get,
        "dir",
        str(local_base / "dir"),
        recursive=True,
        overwrite=True,
    )

    expected_file = local_base / "dir" / "inner" / "file.txt"
    assert expected_file.exists()
    assert expected_file.read_text() == "collision data"


@pytest.mark.asyncio
async def test_async_dirfs_get_handles_file_dir_name_collision_no_overwrite(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir" / "inner").mkdir(parents=True)
    (remote_base / "dir" / "inner" / "file.txt").write_text("async collision data")

    local_base.mkdir()
    (local_base / "dir").write_text("old file")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    with pytest.raises(FileExistsError):
        await asyncio.to_thread(
            dirfs.get, "dir", str(local_base / "dir"), recursive=True, overwrite=False
        )


def test_dirfs_get_idempotent_across_calls(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir").mkdir(parents=True)
    (remote_base / "dir" / "f.txt").write_text("same")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    dest = local_base / "dir"
    dirfs.get("dir", str(dest), recursive=True)
    first_snapshot = sorted(p.relative_to(local_base) for p in local_base.rglob("*"))

    dirfs.get("dir", str(dest), recursive=True)
    second_snapshot = sorted(p.relative_to(local_base) for p in local_base.rglob("*"))

    assert first_snapshot == second_snapshot


def test_dirfs_default_overwrite_behavior(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir").mkdir(parents=True)
    (remote_base / "dir" / "file.txt").write_text("content")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    dest = local_base / "dir"

    dirfs.get("dir", str(dest), recursive=True)
    dirfs.get("dir", str(dest), recursive=True)
    assert (dest / "file.txt").exists()
    assert (dest / "file.txt").read_text() == "content"


def test_async_dirfs_get_matches_sync_behavior(tmp_path):
    remote_base = tmp_path / "remote"
    local_base = tmp_path / "local"

    (remote_base / "dir").mkdir(parents=True)
    (remote_base / "dir" / "f.txt").write_text("async copy")

    fs = fsspec.filesystem("file")
    dirfs = DirFileSystem(str(remote_base), fs=fs)

    async def run_async_get():
        await asyncio.to_thread(
            dirfs.get, "dir", str(local_base / "async"), recursive=True
        )

    asyncio.run(run_async_get())

    sync_target = local_base / "sync"
    dirfs.get("dir", str(sync_target), recursive=True)

    async_file = local_base / "async" / "f.txt"
    sync_file = sync_target / "f.txt"

    assert async_file.exists() and sync_file.exists()
    assert async_file.read_text() == sync_file.read_text() == "async copy"

# import pytest
# import fsspec
# import os
# import shutil
# from fsspec.implementations.cached import SimpleCacheFileSystem
# from unittest.mock import MagicMock

# # 1. MOCK BACKEND TO TRACK BEHAVIOR
# class TrackingFileSystem(fsspec.AbstractFileSystem):
#     protocol = "track"
#     def __init__(self, *args, **kwargs):
#         super().__init__(*args, **kwargs)
#         self.fetches = []

#     def _open(self, path, mode="rb", **kwargs):
#         # We record exactly what URL the backend received
#         self.fetches.append(path)
#         # Return a mock file-like object
#         m = MagicMock()
#         m.read.return_value = b"data"
#         return m

# fsspec.register_implementation("track", TrackingFileSystem, clobber=True)

# @pytest.fixture
# def cache_env(tmp_path):
#     """Sets up a clean environment for each test."""
#     storage = str(tmp_path / "cache_storage")
#     track_fs = TrackingFileSystem()
#     # SimpleCache using our tracker
#     fs = SimpleCacheFileSystem(fs=track_fs, cache_storage=storage)
#     return fs, track_fs, storage

# # 2. TEST DEDUPLICATION (Behavior: Fetch count)
# def test_deduplication_avoids_redundant_fetches(cache_env):
#     fs, track_fs, _ = cache_env
    
#     # Variants of the same logical file
#     variants = [
#         "track://file?a=1&b=2",
#         "track://file?b=2&a=1",
#         "track://./file",
#         "track://file#tag"
#     ]
    
#     for url in variants:
#         with fs.open(url) as f:
#             f.read()
            
#     # Success = Only 1 fetch happened despite 4 different URL strings
#     assert len(track_fs.fetches) == 1

# # 3. TEST MAJOR PARAMETERS (Behavior: Fetch separation)
# def test_major_parameters_create_distinct_entries(cache_env):
#     fs, track_fs, _ = cache_env
    
#     fs.open("track://file?version=1").read()
#     fs.open("track://file?version=2").read()
#     fs.open("track://file?dataset=A").read()
    
#     # Success = 3 distinct version/dataset parameters must trigger 3 fetches
#     assert len(track_fs.fetches) == 3

# # 4. TEST FETCH INTEGRITY (Behavior: Raw URL preservation)
# def test_fetch_uses_original_unnormalized_url(cache_env):
#     fs, track_fs, _ = cache_env
    
#     # We provide a non-alphabetical query
#     original_url = "track://file?z=9&a=1"
#     fs.open(original_url).read()
    
#     # Success = The backend must receive the raw URL, not a normalized one
#     assert track_fs.fetches[0] == original_url

# # 5. TEST BOUNDED GROWTH (Behavior: Disk storage identity)
# def test_bounded_disk_growth(cache_env):
#     fs, _, storage = cache_env
    
#     # Fire 50 variants of the SAME logical file
#     for i in range(50):
#         url = f"track://file?constant=true&variant={i}"
#         with fs.open(url) as f:
#             f.read()
            
#     # Observe local storage behavior
#     cache_files = os.listdir(storage)
    
#     # If deduplication is working, we should not have 50 files on disk.
#     # We allow a small amount of "slack" as per the requirement, but 
#     # definitely not one file per variant.
#     assert len(cache_files) < 10

# # 6. TEST PERSISTENCE CONSISTENCY
# def test_cache_persistence_across_instances(tmp_path):
#     storage = str(tmp_path / "persistent_cache")
#     track_fs = TrackingFileSystem()
    
#     # Instance 1 fetches the file
#     fs1 = SimpleCacheFileSystem(fs=track_fs, cache_storage=storage)
#     fs1.open("track://file?a=1&b=2").read()
#     assert len(track_fs.fetches) == 1
    
#     # Instance 2 uses a DIFFERENT variant but same logical file
#     fs2 = SimpleCacheFileSystem(fs=track_fs, cache_storage=storage)
#     fs2.open("track://file?b=2&a=1").read()
    
#     # Success = Instance 2 should find it on disk and NOT call the backend again
#     assert len(track_fs.fetches) == 1
