from sqlalchemy import Select, func, select

from backend.app.models.entities import VideoStream


def primary_video_streams_subquery(name: str = "primary_video_streams"):
    primary_indices = (
        select(
            VideoStream.media_file_id.label("media_file_id"),
            func.min(VideoStream.stream_index).label("stream_index"),
        )
        .group_by(VideoStream.media_file_id)
        .subquery(f"{name}_indices")
    )

    return (
        select(VideoStream)
        .join(
            primary_indices,
            (VideoStream.media_file_id == primary_indices.c.media_file_id)
            & (VideoStream.stream_index == primary_indices.c.stream_index),
        )
        .subquery(name)
    )

