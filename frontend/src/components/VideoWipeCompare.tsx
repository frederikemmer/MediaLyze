import { GripVertical, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useTranslation } from "react-i18next";

type VideoWipeSource = {
  src: string;
  label: string;
};

type AudioMixGraph = {
  context: AudioContext;
  firstGain: GainNode;
  secondGain: GainNode;
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
  const [audioMix, setAudioMix] = useState(50);
  const [muted, setMuted] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const audioMixGraphRef = useRef<AudioMixGraph | null>(null);

  const synchronize = useCallback(() => {
    const firstVideo = firstRef.current;
    const secondVideo = secondRef.current;
    if (!firstVideo || !secondVideo) return;
    if (Math.abs(secondVideo.currentTime - firstVideo.currentTime) > 0.12) {
      secondVideo.currentTime = firstVideo.currentTime;
    }
  }, []);

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

  const applyAudioMix = useCallback(() => {
    const firstVideo = firstRef.current;
    const secondVideo = secondRef.current;
    if (!firstVideo || !secondVideo) return;

    const secondShare = Math.min(100, Math.max(0, audioMix)) / 100;
    const masterVolume = muted ? 0 : volume;
    const firstLevel = masterVolume * (1 - secondShare);
    const secondLevel = masterVolume * secondShare;
    const graph = audioMixGraphRef.current;

    if (graph) {
      graph.firstGain.gain.value = firstLevel;
      graph.secondGain.gain.value = secondLevel;
      // The Web Audio graph owns the output volume once it is connected.
      firstVideo.volume = 1;
      secondVideo.volume = 1;
      firstVideo.muted = false;
      secondVideo.muted = false;
      return;
    }

    // The fallback keeps the feature useful in browsers without Web Audio.
    firstVideo.volume = firstLevel;
    secondVideo.volume = secondLevel;
    firstVideo.muted = muted;
    secondVideo.muted = muted;
  }, [audioMix, muted, volume]);

  const ensureAudioMixGraph = useCallback((): AudioMixGraph | null => {
    const existingGraph = audioMixGraphRef.current;
    if (existingGraph) return existingGraph;

    const firstVideo = firstRef.current;
    const secondVideo = secondRef.current;
    if (!firstVideo || !secondVideo || typeof window === "undefined") return null;

    const audioContextConstructor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audioContextConstructor) return null;

    let context: AudioContext | null = null;
    try {
      context = new audioContextConstructor();
      const firstGain = context.createGain();
      const secondGain = context.createGain();
      context.createMediaElementSource(firstVideo).connect(firstGain).connect(context.destination);
      context.createMediaElementSource(secondVideo).connect(secondGain).connect(context.destination);

      const graph = { context, firstGain, secondGain };
      audioMixGraphRef.current = graph;
      applyAudioMix();
      return graph;
    } catch {
      if (context) void context.close();
      // Direct HTMLMediaElement volume mixing remains available as a fallback.
      return null;
    }
  }, [applyAudioMix]);

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
    const audioMixGraph = ensureAudioMixGraph();
    try {
      if (audioMixGraph?.context.state === "suspended") {
        await audioMixGraph.context.resume();
      }
      await Promise.all([firstVideo.play(), secondVideo.play()]);
      setPlaying(true);
    } catch {
      firstVideo.pause();
      secondVideo.pause();
      setPlaying(false);
      setUnsupported(true);
    }
  }, [ensureAudioMixGraph, synchronize]);

  useEffect(() => {
    applyAudioMix();
  }, [applyAudioMix]);

  useEffect(() => {
    return () => {
      const graph = audioMixGraphRef.current;
      if (!graph) return;
      graph.firstGain.disconnect();
      graph.secondGain.disconnect();
      void graph.context.close();
      audioMixGraphRef.current = null;
    };
  }, []);

  const durationsDiffer = duration > 0 && secondDuration > 0 && Math.abs(duration - secondDuration) > 0.5;
  const firstAudioShare = 100 - Math.round(audioMix);
  const secondAudioShare = Math.round(audioMix);
  const audioMixValue = t("videoWipe.audioMixValue", { first: firstAudioShare, second: secondAudioShare });

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
        <div className="video-wipe-audio-mix">
          <span className="video-wipe-audio-mix-label">{t("videoWipe.audioMix")}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={audioMix}
            onChange={(event) => setAudioMix(Number(event.target.value))}
            aria-label={t("videoWipe.audioMix")}
            aria-valuetext={audioMixValue}
          />
          <output className="video-wipe-audio-mix-value" aria-label={t("videoWipe.audioMix")} aria-live="polite">{audioMixValue}</output>
        </div>
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
