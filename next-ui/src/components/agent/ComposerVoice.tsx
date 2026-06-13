import { Box, Typography } from "@mui/material";
import { useLayoutEffect, useRef } from "react";

interface SpeechRecognitionAlternativeLike {
  readonly transcript: string;
}

interface SpeechRecognitionResultLike {
  readonly length: number;
  readonly isFinal: boolean;
  readonly [index: number]: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionResultEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  readonly error?: string;
  readonly message?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

export const VOICE_DEFAULT_LEVEL_COUNT = 96;
const VOICE_MIN_LEVEL_COUNT = 48;
const VOICE_MAX_LEVEL_COUNT = 220;
const VOICE_LEVEL_PITCH_PX = 6;
const VOICE_IDLE_LEVEL = 0.025;
export const VOICE_IDLE_LEVELS = voiceIdleLevels(VOICE_DEFAULT_LEVEL_COUNT);
export const VOICE_NO_SPEECH_NOTICE_DELAY_MS = 800;
const VOICE_AMBIENT_LEVELS = voiceAmbientLevels(VOICE_DEFAULT_LEVEL_COUNT);

export function speechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") {
    return null;
  }
  const candidate = window as Window & {
    readonly SpeechRecognition?: SpeechRecognitionConstructor;
    readonly webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

export function isMobileSpeechRecognitionRuntime(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  const userAgent = navigator.userAgent.toLowerCase();
  return /android|iphone|ipad|ipod/.test(userAgent);
}

export function preferredAudioMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate));
}

export function voiceIdleLevels(levelCount: number): readonly number[] {
  return Array.from({ length: levelCount }, () => VOICE_IDLE_LEVEL);
}

export function voiceAmbientLevels(levelCount: number): readonly number[] {
  return Array.from({ length: levelCount }, (_, index) => {
    const phase = index / Math.max(1, levelCount - 1);
    return 0.08 + (Math.sin(phase * Math.PI * 5) + 1) * 0.045;
  });
}

export function voiceLevelCountFromWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return VOICE_DEFAULT_LEVEL_COUNT;
  }
  return Math.max(VOICE_MIN_LEVEL_COUNT, Math.min(VOICE_MAX_LEVEL_COUNT, Math.round(width / VOICE_LEVEL_PITCH_PX)));
}

export function formatVoiceDuration(startedAt: number | null): string {
  if (startedAt === null) {
    return "0:00";
  }
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function voiceLevelsFromTimeDomainData(data: Uint8Array, levelCount = VOICE_DEFAULT_LEVEL_COUNT): readonly number[] {
  if (data.length === 0 || levelCount <= 0) {
    return [];
  }
  return Array.from({ length: levelCount }, (_, index) => {
    const start = Math.floor((index * data.length) / levelCount);
    const end = Math.max(start + 1, Math.floor(((index + 1) * data.length) / levelCount));
    let sum = 0;
    for (let offset = start; offset < end; offset += 1) {
      const centered = (data[offset] - 128) / 128;
      sum += centered * centered;
    }
    return Math.min(1, Math.sqrt(sum / (end - start)) * 5);
  });
}

export function VoiceRecordingStrip({
  label,
  duration,
  levels,
  ambient,
  onLevelCountChange,
}: {
  readonly label: string;
  readonly duration: string;
  readonly levels: readonly number[];
  readonly ambient: boolean;
  readonly onLevelCountChange: (levelCount: number) => void;
}) {
  const waveformRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const waveform = waveformRef.current;
    if (!waveform || typeof ResizeObserver === "undefined") {
      return;
    }
    const update = () => onLevelCountChange(voiceLevelCountFromWidth(waveform.getBoundingClientRect().width));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(waveform);
    return () => observer.disconnect();
  }, [onLevelCountChange]);

  return (
    <Box
      data-testid="composer-voice-recording-strip"
      data-ambient={ambient ? "true" : "false"}
      role="status"
      aria-label={label}
      sx={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) auto",
        alignItems: "center",
        gap: 1.25,
        px: 1,
        color: "text.primary",
        pointerEvents: "none",
        backgroundColor: (theme) => theme.custom.surfaces.s2,
      }}
    >
      <Box
        ref={waveformRef}
        sx={{
          minWidth: 0,
          height: 28,
          position: "relative",
          display: "grid",
          gridTemplateColumns: `repeat(${Math.max(1, levels.length)}, minmax(0, 1fr))`,
          alignItems: "center",
          gap: "2px",
          overflow: "hidden",
        }}
      >
        {levels.map((level, index) => {
          const height = Math.max(3, Math.min(28, 3 + level * 32));
          const ambientDuration = 1300 + (index % 7) * 95;
          const ambientDelay = -(index % 13) * 75;
          return (
          <Box
            key={index}
            component="span"
            data-level={level.toFixed(3)}
            sx={{
              justifySelf: "stretch",
              minWidth: 1,
              height,
              borderRadius: "999px",
              backgroundColor: "text.primary",
              opacity: Math.max(0.28, Math.min(0.96, 0.34 + level * 0.8)),
              transformOrigin: "center",
              transition: ambient ? "none" : "height 80ms linear",
              ...(ambient
                ? {
                    animation: `voiceAmbientPulse ${ambientDuration}ms ease-in-out ${ambientDelay}ms infinite`,
                    "@keyframes voiceAmbientPulse": {
                      "0%, 100%": { transform: "scaleY(0.72)", opacity: 0.34 },
                      "50%": { transform: "scaleY(1.58)", opacity: 0.72 },
                    },
                  }
                : {}),
            }}
          />
          );
        })}
      </Box>
      <Typography
        component="span"
        sx={{
          minWidth: 38,
          fontFamily: (theme) => theme.custom.fonts.mono,
          fontSize: "0.78rem",
          color: "text.secondary",
          textAlign: "right",
        }}
      >
        {duration}
      </Typography>
    </Box>
  );
}
