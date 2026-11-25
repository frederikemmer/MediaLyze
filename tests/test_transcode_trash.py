import os

import pytest
from pydantic import ValidationError

from backend.app.schemas.app_settings import TranscodingSettingsRead, TranscodingSettingsUpdate
from backend.app.services.transcode_trash import archive_original, complete_archive, prune_replacement_trash


def test_trash_retention_counts_bytes_and_files_across_directory_names(tmp_path):
    source = tmp_path / "Movie.mkv"
    config = tmp_path / "config"
    policy = TranscodingSettingsRead(replacement_trash_enabled=True, replacement_trash_directory="Archive")
    archived = []
    for index, size in enumerate((5, 7, 3)):
        source.unlink(missing_ok=True)
        source.write_bytes(b"x" * size)
        if index > 0:
            policy.replacement_trash_directory = "Originals"
        pending = archive_original(config, policy, source)
        os.utime(pending, (index + 1, index + 1))
        complete_archive(pending)
        archived.append(pending.with_name(pending.name.replace(".pending-", "original-", 1)))

    unrelated = config / "transcode-trash" / "Originals" / "personal.mkv"
    unrelated.write_bytes(b"keep")
    policy.replacement_trash_max_files = 2
    prune_replacement_trash(config, policy)
    assert not archived[0].exists()
    assert all(path.is_dir() for path in archived[1:])
    policy.replacement_trash_max_gib = 4 / 1024**3
    prune_replacement_trash(config, policy)
    assert not archived[1].exists()
    assert (archived[2] / source.name).read_bytes() == b"xxx"
    assert unrelated.read_bytes() == b"keep"


@pytest.mark.parametrize("name", ("../escape", "/absolute", "folder/child", r"folder\child", "CON", "   "))
def test_trash_directory_requires_a_single_safe_name(name):
    with pytest.raises(ValidationError):
        TranscodingSettingsUpdate(replacement_trash_directory=name)
