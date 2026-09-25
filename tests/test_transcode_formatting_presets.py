from __future__ import annotations

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from backend.app.db.base import Base
from backend.app.schemas.transcoding import TranscodeFormattingPresetCreate, TranscodeFormattingPresetUpdate
from backend.app.services.transcode_formatting_presets import (
    FormattingPresetError,
    create_formatting_preset,
    delete_formatting_preset,
    list_formatting_presets,
    update_formatting_preset,
)


def test_formatting_presets_persist_per_kind_and_keep_one_default_each() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        first = create_formatting_preset(db, TranscodeFormattingPresetCreate(
            kind="filename", name="First", definition={"template": "[{resolution}]"},
        ))
        second = create_formatting_preset(db, TranscodeFormattingPresetCreate(
            kind="filename", name="Second", definition={"template": "[{codec}]"},
        ))
        folder = create_formatting_preset(db, TranscodeFormattingPresetCreate(
            kind="folder", name="First", definition={"template": "{folderName}"},
        ))
        with pytest.raises(FormattingPresetError, match="already exists"):
            create_formatting_preset(db, TranscodeFormattingPresetCreate(
                kind="filename", name=" first ", definition={"template": "x"},
            ))
        update_formatting_preset(db, first.id, TranscodeFormattingPresetUpdate(is_default=True))
        update_formatting_preset(db, folder.id, TranscodeFormattingPresetUpdate(is_default=True))
        update_formatting_preset(db, second.id, TranscodeFormattingPresetUpdate(is_default=True))

        with Session(engine) as reopened:
            rows = {row.id: row for row in list_formatting_presets(reopened)}
            assert not rows[first.id].is_default
            assert rows[second.id].is_default
            assert rows[folder.id].is_default
            assert rows[first.id].definition.template == "[{resolution}]"
            delete_formatting_preset(reopened, second.id)
            assert second.id not in {row.id for row in list_formatting_presets(reopened)}
