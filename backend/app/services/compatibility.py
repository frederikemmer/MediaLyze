from __future__ import annotations

from backend.app.schemas.compatibility import (
    CompatibilityEvaluation,
    CompatibilityFinding,
    CompatibilityProfile,
    CompatibilityStatus,
    FindingSeverity,
    HardwareProfile,
    HardwareVideoCapability,
    PlaybackMode,
    ProfileEvaluation,
    SoftwareCapability,
    SoftwareCompatibilityRule,
    SoftwareProfile,
    SupportLevel,
)
from backend.app.schemas.media import MediaFileDetail


RESOLUTION_LIMITS = {
    "sd": (720, 576),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "2k": (2048, 1080),
    "4k": (4096, 2160),
    "8k": (8192, 4320),
}


def _key(value: str | None) -> str:
    return (value or "").strip().lower().replace("-", "").replace("_", "")


def _finding(
    code: str,
    severity: FindingSeverity,
    scope: str,
    message: str,
    *,
    blocking: bool = False,
    stream_index: int | None = None,
) -> CompatibilityFinding:
    return CompatibilityFinding(
        code=code,
        severity=severity,
        scope=scope,
        message=message,
        blocking=blocking,
        stream_index=stream_index,
    )


def _limit_dimensions(capability) -> tuple[int | None, int | None]:
    if capability.max_width or capability.max_height:
        return capability.max_width, capability.max_height
    label = _key(capability.max_resolution)
    return RESOLUTION_LIMITS.get(label, (None, None))


def _video_within_limits(stream, capability: HardwareVideoCapability | SoftwareCapability) -> str | None:
    max_width, max_height = _limit_dimensions(capability)
    if stream.width is None or stream.height is None:
        return "metadata_unknown"
    if max_width and stream.width > max_width or max_height and stream.height > max_height:
        return "video_resolution_unsupported"
    if capability.max_fps is not None:
        if stream.frame_rate is None:
            return "metadata_unknown"
        if stream.frame_rate > capability.max_fps + 0.01:
            return "video_fps_unsupported"
    if capability.bit_depth:
        if stream.bit_depth is None:
            return "metadata_unknown"
        if stream.bit_depth not in capability.bit_depth:
            return "video_bit_depth_unsupported"
    if isinstance(capability, SoftwareCapability) and capability.profiles:
        if not stream.profile:
            return "metadata_unknown"
        if _key(stream.profile) not in {_key(item) for item in capability.profiles}:
            return "video_profile_unsupported"
    if stream.hdr_type and stream.hdr_type.upper() != "SDR" and capability.hdr:
        normalized = {_key(item) for item in capability.hdr}
        if _key(stream.hdr_type) not in normalized:
            return "dynamic_range_unsupported"
    return None


def _condition_findings(conditions, scope: str, stream_index: int | None = None):
    return [
        _finding(
            "playback_condition_unverified",
            FindingSeverity.warning,
            scope,
            condition.note or f"Playback depends on {condition.kind}: {condition.value}.",
            blocking=True,
            stream_index=stream_index,
        )
        for condition in conditions
    ]


def _software_status(mode: PlaybackMode, scope: str, fallback: str) -> CompatibilityStatus:
    if mode == PlaybackMode.direct:
        return CompatibilityStatus.direct_play
    if mode == PlaybackMode.conditional:
        return CompatibilityStatus.conditional
    if mode == PlaybackMode.video_transcode or scope == "video" and mode == PlaybackMode.transcode:
        return CompatibilityStatus.video_transcode
    if mode in {PlaybackMode.direct_stream, PlaybackMode.transcode}:
        return CompatibilityStatus.direct_stream
    if fallback == "transcode":
        return CompatibilityStatus.video_transcode if scope in {"video", "subtitle"} else CompatibilityStatus.direct_stream
    return CompatibilityStatus.unsupported


def _rule_matches(rule: SoftwareCompatibilityRule, file, stream=None, subtitle_format: str | None = None) -> bool:
    match = rule.match
    if match.containers and _key(file.extension) not in {_key(item) for item in match.containers}:
        return False
    if match.video_codecs:
        codec = getattr(stream, "codec", None) if stream is not None else None
        if _key(codec) not in {_key(item) for item in match.video_codecs}:
            return False
    if match.audio_codecs:
        codec = getattr(stream, "codec", None) if stream is not None else None
        if _key(codec) not in {_key(item) for item in match.audio_codecs}:
            return False
    if match.subtitle_formats and _key(subtitle_format) not in {_key(item) for item in match.subtitle_formats}:
        return False
    if match.video_profiles:
        if _key(getattr(stream, "profile", None)) not in {_key(item) for item in match.video_profiles}:
            return False
    if match.bit_depths and getattr(stream, "bit_depth", None) not in match.bit_depths:
        return False
    if match.hdr and _key(getattr(stream, "hdr_type", None)) not in {_key(item) for item in match.hdr}:
        return False
    channels = getattr(stream, "channels", None)
    if match.min_audio_channels is not None and (channels is None or channels < match.min_audio_channels):
        return False
    if match.max_audio_channels is not None and (channels is None or channels > match.max_audio_channels):
        return False
    return True


def _matching_rule(software: SoftwareProfile, scope: str, file, stream=None, subtitle_format: str | None = None):
    for rule in software.rules:
        match = rule.match
        relevant = (
            scope == "container" and bool(match.containers) and not (match.video_codecs or match.audio_codecs or match.subtitle_formats)
            or scope == "video" and bool(match.video_codecs or match.video_profiles or match.bit_depths or match.hdr)
            or scope == "audio" and bool(match.audio_codecs or match.min_audio_channels or match.max_audio_channels)
            or scope == "subtitle" and bool(match.subtitle_formats)
        )
        if relevant and _rule_matches(rule, file, stream, subtitle_format):
            return rule
    return None


def _software_capability(mapping: dict[str, SoftwareCapability], value: str | None) -> SoftwareCapability | None:
    wanted = _key(value)
    return next((capability for key, capability in mapping.items() if _key(key) == wanted), None)


def _hardware_support(mapping, value: str | None):
    wanted = _key(value)
    return next((support for key, support in mapping.items() if _key(key) == wanted), False)


def _evaluate_container(file, hardware: HardwareProfile, software: SoftwareProfile):
    findings = []
    extension = _key(file.extension)
    rule = _matching_rule(software, "container", file)
    if rule:
        status = _software_status(rule.mode, "container", software.server_fallback)
        if status == CompatibilityStatus.conditional:
            findings.extend(_condition_findings(rule.conditions, "container"))
        elif status != CompatibilityStatus.direct_play:
            findings.append(_finding("container_remux_required", FindingSeverity.warning, "container", rule.note or "Container requires remuxing.", blocking=True))
        return status, findings
    software_capability = _software_capability(software.containers, extension)
    hardware_supported = extension in {_key(item) for item in hardware.containers}
    if software_capability is None or software_capability.mode == PlaybackMode.unsupported or not hardware_supported:
        status = _software_status(PlaybackMode.unsupported, "container", software.server_fallback)
        code = "container_remux_required" if status == CompatibilityStatus.direct_stream else "container_unsupported"
        findings.append(_finding(code, FindingSeverity.warning if status == CompatibilityStatus.direct_stream else FindingSeverity.error, "container", "Container requires remuxing." if status == CompatibilityStatus.direct_stream else "Container is not supported.", blocking=True))
        return status, findings
    status = _software_status(software_capability.mode, "container", software.server_fallback)
    if software_capability.conditions or status == CompatibilityStatus.conditional:
        return CompatibilityStatus.conditional, _condition_findings(software_capability.conditions, "container")
    if status != CompatibilityStatus.direct_play:
        findings.append(_finding("container_remux_required", FindingSeverity.warning, "container", "Container requires remuxing.", blocking=True))
        return status, findings
    return CompatibilityStatus.direct_play, findings


def _evaluate_video(file, hardware: HardwareProfile, software: SoftwareProfile):
    if not file.video_streams:
        return CompatibilityStatus.direct_play, []
    stream = min(file.video_streams, key=lambda item: item.stream_index)
    if not stream.codec:
        return CompatibilityStatus.conditional, [
            _finding("metadata_unknown", FindingSeverity.warning, "metadata", "Video codec metadata is missing.", blocking=True, stream_index=stream.stream_index)
        ]
    sw = _software_capability(software.video, stream.codec)
    hw = next((value for key, value in hardware.video.items() if _key(key) == _key(stream.codec)), None)
    rule = _matching_rule(software, "video", file, stream)
    if rule:
        status = _software_status(rule.mode, "video", software.server_fallback)
        if status == CompatibilityStatus.conditional:
            return status, _condition_findings(rule.conditions, "video", stream.stream_index)
        if status != CompatibilityStatus.direct_play:
            return status, [_finding("video_transcode_required", FindingSeverity.warning, "video", rule.note or "Video requires transcoding.", blocking=True, stream_index=stream.stream_index)]
    if sw is not None and sw.mode in {
        PlaybackMode.transcode,
        PlaybackMode.video_transcode,
        PlaybackMode.direct_stream,
    }:
        status = _software_status(sw.mode, "video", software.server_fallback)
        return status, [_finding("video_transcode_required", FindingSeverity.warning, "video", "Video requires transcoding.", blocking=True, stream_index=stream.stream_index)]
    if sw is None or sw.mode == PlaybackMode.unsupported or hw is None or not hw.hardware_decode:
        status = _software_status(PlaybackMode.unsupported, "video", software.server_fallback)
        code = "video_transcode_required" if status == CompatibilityStatus.video_transcode else "video_codec_unsupported"
        return status, [_finding(code, FindingSeverity.warning if status == CompatibilityStatus.video_transcode else FindingSeverity.error, "video", "Video requires transcoding." if status == CompatibilityStatus.video_transcode else "Video codec is not supported.", blocking=True, stream_index=stream.stream_index)]
    status = _software_status(sw.mode, "video", software.server_fallback)
    if sw.conditions or status == CompatibilityStatus.conditional:
        return CompatibilityStatus.conditional, _condition_findings(sw.conditions, "video", stream.stream_index)
    if status != CompatibilityStatus.direct_play:
        return status, [_finding("video_transcode_required", FindingSeverity.warning, "video", "Video requires transcoding.", blocking=True, stream_index=stream.stream_index)]
    reason = _video_within_limits(stream, hw) or _video_within_limits(stream, sw)
    if reason:
        status = CompatibilityStatus.conditional if reason == "metadata_unknown" else _software_status(PlaybackMode.unsupported, "video", software.server_fallback)
        return status, [
            _finding(reason, FindingSeverity.warning if status != CompatibilityStatus.unsupported else FindingSeverity.error, "video" if reason != "metadata_unknown" else "metadata", "Video metadata exceeds the profile limits or is unknown.", blocking=True, stream_index=stream.stream_index)
        ]
    return CompatibilityStatus.direct_play, []


def _evaluate_audio(file, hardware: HardwareProfile, software: SoftwareProfile):
    if not file.audio_streams:
        return CompatibilityStatus.direct_play, None, []
    candidates = []
    informational = []
    for stream in sorted(file.audio_streams, key=lambda item: (not item.default_flag, item.stream_index)):
        if not stream.codec:
            candidates.append((CompatibilityStatus.unsupported, stream.stream_index, "metadata_unknown"))
            continue
        sw = _software_capability(software.audio, stream.codec)
        hw = _hardware_support(hardware.audio, stream.codec)
        rule = _matching_rule(software, "audio", file, stream)
        if rule and (rule.conditions or rule.mode == PlaybackMode.conditional):
            candidates.append((CompatibilityStatus.conditional, stream.stream_index, "playback_condition_unverified"))
        elif rule:
            status = _software_status(rule.mode, "audio", software.server_fallback)
            candidates.append((status, stream.stream_index, None if status == CompatibilityStatus.direct_play else "audio_transcode_required"))
        elif sw and (sw.conditions or sw.mode == PlaybackMode.conditional):
            candidates.append((CompatibilityStatus.conditional, stream.stream_index, "playback_condition_unverified"))
        elif sw and sw.max_channels is not None and stream.channels is not None and stream.channels > sw.max_channels:
            candidates.append((CompatibilityStatus.direct_stream, stream.stream_index, "audio_channels_transcode_required"))
        elif sw and sw.mode in {PlaybackMode.transcode, PlaybackMode.direct_stream}:
            candidates.append((CompatibilityStatus.direct_stream, stream.stream_index, "audio_transcode_required"))
        elif sw is None or sw.mode == PlaybackMode.unsupported or hw is False:
            status = _software_status(PlaybackMode.unsupported, "audio", software.server_fallback)
            candidates.append((status, stream.stream_index, "audio_transcode_required" if status == CompatibilityStatus.direct_stream else "audio_codec_unsupported"))
        else:
            candidates.append((CompatibilityStatus.direct_play, stream.stream_index, None))
            if hw == SupportLevel.passthrough_only:
                informational.append(
                    _finding("audio_passthrough_only", FindingSeverity.warning, "audio", "Audio requires passthrough to a downstream device.", stream_index=stream.stream_index)
                )
    selected = next((item for item in candidates if item[0] == CompatibilityStatus.direct_play), None)
    selected = selected or next((item for item in candidates if item[0] == CompatibilityStatus.direct_stream), None)
    selected = selected or next((item for item in candidates if item[0] == CompatibilityStatus.conditional), None)
    selected = selected or candidates[0]
    for status, stream_index, reason in candidates:
        if stream_index == selected[1] or reason is None:
            continue
        informational.append(
            _finding(reason, FindingSeverity.warning, "audio", "Optional audio stream is not directly supported.", stream_index=stream_index)
        )
    if selected[2]:
        informational.insert(
            0,
            _finding(
                selected[2],
                FindingSeverity.error if selected[0] == CompatibilityStatus.unsupported else FindingSeverity.warning,
                "metadata" if selected[2] == "metadata_unknown" else "audio",
                "No directly playable audio stream was found." if selected[0] == CompatibilityStatus.unsupported else "Selected audio stream requires transcoding.",
                blocking=True,
                stream_index=selected[1],
            ),
        )
    return selected[0], selected[1], informational


def _evaluate_subtitles(file, hardware: HardwareProfile, software: SoftwareProfile):
    findings = []
    statuses = []
    entries = [(stream.stream_index, stream.codec) for stream in file.subtitle_streams]
    entries.extend((None, subtitle.format) for subtitle in file.external_subtitles)
    for stream_index, subtitle_format in entries:
        if not subtitle_format:
            findings.append(_finding("metadata_unknown", FindingSeverity.warning, "metadata", "Subtitle format is unknown.", stream_index=stream_index))
            continue
        sw = _software_capability(software.subtitles, subtitle_format)
        hw = _hardware_support(hardware.subtitles, subtitle_format)
        rule = _matching_rule(software, "subtitle", file, None, subtitle_format)
        if rule:
            status = _software_status(rule.mode, "subtitle" if rule.subtitle_action == "burn_in" else "audio", software.server_fallback)
            if rule.conditions or status == CompatibilityStatus.conditional:
                status = CompatibilityStatus.conditional
                findings.extend(_condition_findings(rule.conditions, "subtitle", stream_index))
            else:
                code = {
                    "remux": "subtitle_remux_required",
                    "convert": "subtitle_conversion_required",
                    "burn_in": "subtitle_burn_in_required",
                }.get(rule.subtitle_action or "", "subtitle_format_unsupported")
                if status != CompatibilityStatus.direct_play:
                    findings.append(_finding(code, FindingSeverity.warning, "subtitle", rule.note or "Subtitle processing is required.", blocking=rule.subtitle_action == "burn_in", stream_index=stream_index))
            statuses.append(status)
        elif sw and (sw.conditions or sw.mode == PlaybackMode.conditional):
            statuses.append(CompatibilityStatus.conditional)
            findings.extend(_condition_findings(sw.conditions, "subtitle", stream_index))
        elif sw and sw.mode in {PlaybackMode.transcode, PlaybackMode.direct_stream}:
            statuses.append(CompatibilityStatus.direct_stream)
            findings.append(_finding("subtitle_conversion_required", FindingSeverity.warning, "subtitle", "Subtitle requires conversion.", stream_index=stream_index))
        elif sw and sw.mode == PlaybackMode.video_transcode:
            statuses.append(CompatibilityStatus.video_transcode)
            findings.append(_finding("subtitle_burn_in_required", FindingSeverity.warning, "subtitle", "Subtitle requires burn-in.", blocking=True, stream_index=stream_index))
        elif sw is None or sw.mode == PlaybackMode.unsupported or hw is False:
            status = _software_status(PlaybackMode.unsupported, "subtitle", software.server_fallback)
            statuses.append(status)
            findings.append(_finding("subtitle_burn_in_required" if status == CompatibilityStatus.video_transcode else "subtitle_format_unsupported", FindingSeverity.warning, "subtitle", "Subtitle requires burn-in." if status == CompatibilityStatus.video_transcode else "Optional subtitle format is not supported.", blocking=status == CompatibilityStatus.video_transcode, stream_index=stream_index))
        elif hw == SupportLevel.limited:
            statuses.append(CompatibilityStatus.conditional)
            findings.append(_finding("subtitle_support_limited", FindingSeverity.warning, "subtitle", "Subtitle support is limited.", stream_index=stream_index))
        else:
            statuses.append(CompatibilityStatus.direct_play)
    return _overall_status(statuses), findings


def _overall_status(statuses: list[CompatibilityStatus]) -> CompatibilityStatus:
    for status in (
        CompatibilityStatus.unsupported,
        CompatibilityStatus.video_transcode,
        CompatibilityStatus.conditional,
        CompatibilityStatus.direct_stream,
    ):
        if status in statuses:
            return status
    return CompatibilityStatus.direct_play


def evaluate_compatibility(
    file: MediaFileDetail,
    compatibility: CompatibilityProfile,
    hardware: HardwareProfile,
    software: SoftwareProfile,
) -> CompatibilityEvaluation:
    container_status, container_findings = _evaluate_container(file, hardware, software)
    video_status, video_findings = _evaluate_video(file, hardware, software)
    audio_status, audio_stream_index, audio_findings = _evaluate_audio(file, hardware, software)
    subtitle_status, subtitle_findings = _evaluate_subtitles(file, hardware, software)
    status = _overall_status([container_status, video_status, audio_status, subtitle_status])
    return CompatibilityEvaluation(
        compatibility_profile_id=compatibility.id,
        compatibility_profile_name=compatibility.name,
        hardware_profile_id=hardware.id,
        hardware_profile_version=hardware.profile_version,
        software_profile_id=software.id,
        software_profile_version=software.profile_version,
        file_id=file.id,
        status=status,
        container_status=container_status,
        video_status=video_status,
        audio_status=audio_status,
        subtitle_status=subtitle_status,
        selected_audio_stream_index=audio_stream_index,
        findings=[
            *container_findings,
            *video_findings,
            *audio_findings,
            *subtitle_findings,
        ],
    )


def _subtitle_formats(file: MediaFileDetail) -> set[str]:
    return {
        value
        for value in [
            *(stream.codec for stream in file.subtitle_streams),
            *(subtitle.format for subtitle in file.external_subtitles),
        ]
        if value
    }


def _profile_evaluation(
    file: MediaFileDetail,
    *,
    profile_type: str,
    profile_id: str,
    profile_name: str,
    profile_version: int,
    hardware: HardwareProfile,
    software: SoftwareProfile,
) -> ProfileEvaluation:
    container_status, container_findings = _evaluate_container(file, hardware, software)
    video_status, video_findings = _evaluate_video(file, hardware, software)
    audio_status, audio_stream_index, audio_findings = _evaluate_audio(file, hardware, software)
    subtitle_status, subtitle_findings = _evaluate_subtitles(file, hardware, software)
    return ProfileEvaluation(
        profile_type=profile_type,
        profile_id=profile_id,
        profile_name=profile_name,
        profile_version=profile_version,
        file_id=file.id,
        status=_overall_status([container_status, video_status, audio_status, subtitle_status]),
        container_status=container_status,
        video_status=video_status,
        audio_status=audio_status,
        subtitle_status=subtitle_status,
        selected_audio_stream_index=audio_stream_index,
        findings=[
            *container_findings,
            *video_findings,
            *audio_findings,
            *subtitle_findings,
        ],
    )


def evaluate_hardware_profile(
    file: MediaFileDetail,
    hardware: HardwareProfile,
) -> ProfileEvaluation:
    direct = SoftwareCapability(mode=PlaybackMode.direct)
    software = SoftwareProfile.model_construct(
        id="standalone-hardware-evaluation",
        name="Standalone hardware evaluation",
        profile_version=1,
        video={stream.codec: direct for stream in file.video_streams if stream.codec},
        audio={stream.codec: direct for stream in file.audio_streams if stream.codec},
        containers={file.extension: direct} if file.extension else {},
        subtitles={subtitle_format: direct for subtitle_format in _subtitle_formats(file)},
        rules=[],
        server_fallback="unsupported",
    )
    return _profile_evaluation(
        file,
        profile_type="hardware",
        profile_id=hardware.id,
        profile_name=hardware.name,
        profile_version=hardware.profile_version,
        hardware=hardware,
        software=software,
    )


def evaluate_software_profile(
    file: MediaFileDetail,
    software: SoftwareProfile,
) -> ProfileEvaluation:
    hardware = HardwareProfile.model_construct(
        id="standalone-software-evaluation",
        name="Standalone software evaluation",
        profile_version=1,
        video={
            stream.codec: HardwareVideoCapability(hardware_decode=True)
            for stream in file.video_streams
            if stream.codec
        },
        audio={stream.codec: True for stream in file.audio_streams if stream.codec},
        containers=[file.extension] if file.extension else [],
        subtitles={subtitle_format: True for subtitle_format in _subtitle_formats(file)},
    )
    return _profile_evaluation(
        file,
        profile_type="software",
        profile_id=software.id,
        profile_name=software.name,
        profile_version=software.profile_version,
        hardware=hardware,
        software=software,
    )
