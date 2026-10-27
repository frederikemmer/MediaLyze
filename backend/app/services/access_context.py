"""Request-only scope; background executors do not inherit browser authority."""

from contextvars import ContextVar
from sqlalchemy import event, false, select, func, exists, case
from sqlalchemy.orm import Session, with_loader_criteria
from backend.app.models import entities as E

principal_context = ContextVar("medialyze_principal", default=None)


def restricted_request():
    principal = principal_context.get()
    return principal is not None and not principal.owner


def playback_allowed():
    principal = principal_context.get()
    return principal is None or principal.has("connector.playback")


def catalog_match_status(db, model):
    """Do not reveal hidden local matches via external attention filters/counts."""
    if "access_scope" not in db.info:
        return model.match_status
    match, item_id = (
        (E.ConnectorMediaMatch, E.ConnectorMediaMatch.connector_item_id)
        if model is E.ConnectorItem else (E.JellyfinMediaMatch, E.JellyfinMediaMatch.jellyfin_item_id)
    )
    visible = select(item_id).where(match.status == "matched")
    return case((model.id.in_(visible), model.match_status), else_="unmatched")


@event.listens_for(Session, "do_orm_execute")
def scoped_reads(execute_state):
    """Scope only explicitly attached HTTP sessions, before aggregation and pagination.

    System services use independent sessions; this is not an authentication bypass
    for routes, which must pass the route registry and object authorization first.
    """
    scope = execute_state.session.info.get("access_scope")
    if scope is None or not execute_state.is_select:
        return
    ids, playback = scope
    stmt = execute_state.statement
    for model in (
        E.LibraryRoot,
        E.MediaFile,
        E.MediaFileHistory,
        E.LibraryHistory,
        E.MediaSeries,
        E.MediaSeason,
        E.DuplicateGroupSuppression,
        E.ScanJob,
        E.ConnectorLibraryLink,
    ):
        stmt = stmt.options(
            with_loader_criteria(model, model.library_id.in_(ids), include_aliases=True)
        )
    principal = execute_state.session.info.get("access_principal")
    if principal is not None:
        transcode_ids = tuple(i for i in ids if principal.has("transcode.view", i))
        stmt = stmt.options(
            with_loader_criteria(
                E.TranscodeJob, E.TranscodeJob.library_id.in_(transcode_ids), include_aliases=True
            )
        )
        rule_libraries = func.json_each(E.TranscodeRule.library_ids).table_valued("value")
        hidden_rule_target = exists(
            select(1)
            .select_from(rule_libraries)
            .where(rule_libraries.c.value.not_in(transcode_ids))
            .correlate(E.TranscodeRule)
        )
        stmt = stmt.options(
            with_loader_criteria(
                E.TranscodeRule,
                (~hidden_rule_target) & (func.json_array_length(E.TranscodeRule.library_ids) > 0),
                include_aliases=True,
            )
        )
    stmt = stmt.options(
        with_loader_criteria(E.Library, E.Library.id.in_(ids), include_aliases=True)
    )
    # Stream queries can occur independently of a MediaFile JOIN.
    for model in (
        E.MediaFormat,
        E.VideoStream,
        E.AudioStream,
        E.SubtitleStream,
        E.ExternalSubtitle,
        E.MediaChapter,
    ):
        stmt = stmt.options(
            with_loader_criteria(
                model,
                model.media_file_id.in_(
                    select(E.MediaFile.id).where(E.MediaFile.library_id.in_(ids))
                ),
                include_aliases=True,
            )
        )
    # A remote catalog can contain unmatched files and files belonging to
    # other local libraries. Playback aggregates must use only matched items.
    local_media_ids = select(E.MediaFile.id).where(E.MediaFile.library_id.in_(ids))
    for model in (E.JellyfinMediaMatch, E.ConnectorMediaMatch):
        stmt = stmt.options(with_loader_criteria(
            model, model.media_file_id.in_(local_media_ids), include_aliases=True
        ))
    stmt = stmt.options(with_loader_criteria(
        E.ConnectorRootBinding,
        E.ConnectorRootBinding.library_root_id.in_(
            select(E.LibraryRoot.id).where(E.LibraryRoot.library_id.in_(ids))
        ), include_aliases=True,
    ))
    visible_remote_ids = select(E.JellyfinMediaMatch.jellyfin_item_id).where(
        E.JellyfinMediaMatch.media_file_id.in_(local_media_ids),
        E.JellyfinMediaMatch.status == "matched",
    )
    if not execute_state.session.info.get("access_external_catalog"):
        stmt = stmt.options(
            with_loader_criteria(
                E.JellyfinItem, E.JellyfinItem.id.in_(visible_remote_ids), include_aliases=True
            )
        )
    # Even the global external catalog grants no additional personal playback scope.
    for model in (E.JellyfinUserItemData, E.JellyfinPlaybackEvent):
        stmt = stmt.options(with_loader_criteria(
            model, model.jellyfin_item_id.in_(visible_remote_ids), include_aliases=True
        ))
    visible_connector_ids = select(E.ConnectorMediaMatch.connector_item_id).where(
        E.ConnectorMediaMatch.media_file_id.in_(local_media_ids),
        E.ConnectorMediaMatch.status == "matched",
    )
    for model in (E.ConnectorUserItemData, E.ConnectorPlaybackEvent):
        stmt = stmt.options(with_loader_criteria(
            model, model.connector_item_id.in_(visible_connector_ids), include_aliases=True
        ))
    if not playback:
        for model in (
            E.JellyfinUserItemData,
            E.JellyfinPlaybackEvent,
            E.ConnectorUserItemData,
            E.ConnectorPlaybackEvent,
        ):
            stmt = stmt.options(with_loader_criteria(model, false(), include_aliases=True))
    execute_state.statement = stmt
