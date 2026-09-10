import { GripVertical, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

type VideoWipeSource = {
  src: string;
  label: string;
};

export function VideoWipeCompare({
  first,
  second,
}: {
  first: VideoWipeSource;
  second: VideoWipeSource;
}) {
  const { t } = useTranslation();
  const firstRef = useRef<HTMLVideoElement>(null);
  const secondRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [wipe, setWipe] = useState(50);
  const [dragging, setDragging] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [secondDuration, setSecondDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  const synchronize = useCallback(() => {
    const firstVideo = firstRef.current;
    const secondVideo = secondRef.current;
    if (!firstVideo || !secondVideo) return;
    if (Math.abs(secondVideo.currentTime - firstVideo.currentTime) > 0.12) {
      secondVideo.currentTime = firstVideo.currentTime;
    }
  }, []);

  const togglePlayback = useCallback(async () => {
    const firstVideo = firstRef.current;
    const secondVideo = secondRef.current;
    if (!firstVideo || !secondVideo) return;
    if (!firstVideo.paused) {
      firstVideo.pause();
      secondVideo.pause();
      setPlaying(false);
      return;
    }
    synchronize();
    try {
      await Promise.all([firstVideo.play(), secondVideo.play()]);
      setPlaying(true);
    } catch {
      firstVideo.pause();
      secondVideo.pause();
      setPlaying(false);
      setUnsupported(true);
    }
  }, [synchronize]);

  const seek = useCallback((nextTime: number) => {
    setCurrentTime(nextTime);
    if (firstRef.current) firstRef.current.currentTime = nextTime;
    if (secondRef.current) secondRef.current.currentTime = nextTime;
  }, []);

  const setWipePosition = useCallback((nextWipe: number) => {
    setWipe(Math.min(100, Math.max(0, nextWipe)));
  }, []);

  const updateWipeFromPointer = useCallback((clientX: number) => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width) return;
    setWipePosition(((clientX - rect.left) / rect.width) * 100);
  }, [setWipePosition]);

  const handleWipePointerDown = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragging(true);
    updateWipeFromPointer(event.clientX);
  }, [updateWipeFromPointer]);

  const handleWipePointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    event.preventDefault();
    updateWipeFromPointer(event.clientX);
  }, [dragging, updateWipeFromPointer]);

  const handleWipePointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    if (typeof event.currentTarget.hasPointerCapture === "function" && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

  const handleWipeKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 10 : 1;
    let nextWipe: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") nextWipe = wipe - step;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") nextWipe = wipe + step;
    if (event.key === "Home") nextWipe = 0;
    if (event.key === "End") nextWipe = 100;
    if (nextWipe === null) return;
    event.preventDefault();
    setWipePosition(nextWipe);
  }, [setWipePosition, wipe]);

  useEffect(() => {
    for (const video of [firstRef.current, secondRef.current]) {
      if (!video) continue;
      video.volume = volume;
      video.muted = muted;
    }
  }, [muted, volume]);

  const durationsDiffer = duration > 0 && secondDuration > 0 && Math.abs(duration - secondDuration) > 0.5;

  return (
    <div className="video-wipe-compare">
      <div ref={stageRef} className="video-wipe-stage">
        <video
          ref={firstRef}
          src={first.src}
          preload="metadata"
          playsInline
          aria-label={first.label}
          onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
          onTimeUpdate={(event) => {
            setCurrentTime(event.currentTarget.currentTime);
            synchronize();
          }}
          onEnded={() => {
            secondRef.current?.pause();
            setPlaying(false);
          }}
          onError={() => setUnsupported(true)}
        />
        <div className="video-wipe-second" style={{ clipPath: `inset(0 ${100 - wipe}% 0 0)` }}>
          <video
            ref={secondRef}
            src={second.src}
            preload="metadata"
            playsInline
            aria-label={second.label}
            onLoadedMetadata={(event) => setSecondDuration(event.currentTarget.duration || 0)}
            onError={() => setUnsupported(true)}
          />
        </div>
        <div className="video-wipe-divider" style={{ left: `${wipe}%` }} aria-hidden="true" />
        <button
          type="button"
          className={`video-wipe-handle${dragging ? " is-dragging" : ""}`}
          style={{ left: `${wipe}%` }}
          role="slider"
          aria-label={t("videoWipe.wipe")}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(wipe)}
          aria-valuetext={`${Math.round(wipe)}%`}
          onKeyDown={handleWipeKeyDown}
          onPointerDown={handleWipePointerDown}
          onPointerMove={handleWipePointerMove}
          onPointerUp={handleWipePointerUp}
          onPointerCancel={handleWipePointerUp}
        >
          <GripVertical aria-hidden="true" size={18} />
        </button>
        <span className="video-wipe-label video-wipe-label-first">{first.label}</span>
        <span className="video-wipe-label video-wipe-label-second">{second.label}</span>
      </div>
      <div className="video-wipe-controls">
        <button type="button" className="secondary icon-only-button" onClick={() => void togglePlayback()} aria-label={playing ? t("videoWipe.pause") : t("videoWipe.play")}>
          {playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label={t("videoWipe.seek")}
          disabled={!duration}
        />
        <button type="button" className="secondary icon-only-button" onClick={() => setMuted((current) => !current)} aria-label={muted ? t("videoWipe.unmute") : t("videoWipe.mute")}>
          {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
        </button>
        <input
          className="video-wipe-volume"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label={t("videoWipe.volume")}
        />
      </div>
      {durationsDiffer ? <p className="notice compact">{t("videoWipe.durationWarning")}</p> : null}
      {unsupported ? <p className="notice compact error">{t("videoWipe.unsupported")}</p> : null}
    </div>
  );
}
