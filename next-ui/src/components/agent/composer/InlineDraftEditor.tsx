import AttachFileIcon from "@mui/icons-material/AttachFile";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import SendIcon from "@mui/icons-material/Send";
import StopCircleIcon from "@mui/icons-material/StopCircle";
import { Box, Stack, type SxProps, type Theme } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ChangeEvent, type ClipboardEvent, type KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { localFileUrl } from "../../../lib/external-url";
import type { ComposerAttachmentDraft, ComposerDraft } from "../core/types";
import { Button, IconButton, ImageLightbox, Tooltip, type ButtonProps } from "../../ui";
import { AttachmentTile } from "./AttachmentTile";
import { VoiceRecordingStrip, VOICE_IDLE_LEVELS } from "./ComposerVoice";
import { clipboardFilesForComposer, composerSendPayload, mergeComposerAttachments, pastedTextFileForComposer } from "./composer-attachments-model";
import { ComposerStore } from "./composer-store";
import { fileToAttachmentDraft, isImageMime } from "./composer-utils";
import { useComposerShared } from "./composer-shared-context";
import { useComposerVoice } from "./use-composer-voice";

type SubmitShortcut = "enter" | "mod-enter";

export interface InlineDraftEditorProps {
  readonly ariaLabel: string;
  readonly initialText?: string;
  readonly initialAttachments?: readonly ComposerAttachmentDraft[];
  readonly placeholder?: string;
  readonly submitLabel: string;
  readonly submitAriaLabel?: string;
  readonly submitShortcut?: SubmitShortcut;
  readonly onSubmit: (payload: string) => void;
  readonly onCancel?: () => void;
  readonly cancelLabel?: string;
  readonly onInputActivityChange?: (active: boolean) => void;
  readonly autoFocus?: boolean;
  readonly inputRows?: number;
  readonly minHeight?: number;
  readonly maxHeight?: number;
  readonly testIdPrefix: string;
  readonly rootSx?: SxProps<Theme>;
  readonly inputSx?: SxProps<Theme>;
  readonly actionsSx?: SxProps<Theme>;
  readonly actionButtonSx?: SxProps<Theme>;
  readonly submitButtonVariant?: ButtonProps["variant"];
  readonly cancelButtonVariant?: ButtonProps["variant"];
}

const hiddenFileInputStyle = { position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" } as const;
const inlineEditorInputSx = {
  width: "100%",
  resize: "none",
  overflowY: "auto",
  border: 0,
  borderRadius: (theme: Theme) => `${theme.custom.radii.md}px`,
  bgcolor: (theme: Theme) => theme.custom.surfaces.s1,
  color: "text.primary",
  font: "inherit",
  fontSize: "0.9rem",
  lineHeight: 1.6,
  p: 1.5,
  outline: 0,
  "&:focus": { outline: 0 },
} satisfies SxProps<Theme>;
const inlineEditorActionsSx = { justifyContent: "flex-end", alignItems: "center" } satisfies SxProps<Theme>;

function composeSx(...items: readonly (SxProps<Theme> | undefined)[]): SxProps<Theme> {
  const result: unknown[] = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    if (Array.isArray(item)) {
      result.push(...item);
    } else {
      result.push(item);
    }
  }
  return result as SxProps<Theme>;
}

export const InlineDraftEditor = observer(function InlineDraftEditor({
  ariaLabel,
  initialText = "",
  initialAttachments = [],
  placeholder,
  submitLabel,
  submitAriaLabel = submitLabel,
  submitShortcut = "enter",
  onSubmit,
  onCancel,
  cancelLabel,
  onInputActivityChange,
  autoFocus = true,
  inputRows = 3,
  minHeight = 96,
  maxHeight = 320,
  testIdPrefix,
  rootSx,
  inputSx,
  actionsSx,
  actionButtonSx,
  submitButtonVariant = "contained",
  cancelButtonVariant = "subtle",
}: InlineDraftEditorProps) {
  const { t } = useI18n();
  const shared = useComposerShared();
  const [editorStore] = useState(() => new ComposerStore(initialText, initialAttachments, VOICE_IDLE_LEVELS));
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestDraftRef = useRef<ComposerDraft>({ text: initialText, attachments: initialAttachments });
  const [previewAttachment, setPreviewAttachment] = useState<ComposerAttachmentDraft | null>(null);
  const value = editorStore.internalValue;
  const attachments = editorStore.internalAttachments;
  latestDraftRef.current = { text: value, attachments };

  const updateDraft = useCallback((draft: ComposerDraft) => {
    editorStore.setInternalValue(draft.text);
    editorStore.setInternalAttachments(draft.attachments);
  }, [editorStore]);

  const setAttachments = useCallback((nextAttachments: readonly ComposerAttachmentDraft[]) => {
    updateDraft({ text: latestDraftRef.current.text, attachments: nextAttachments });
  }, [updateDraft]);

  const {
    setVoiceLevelCountForWidth,
    stopVoiceInput,
    toggleVoiceInput,
    voiceAmbient,
    voiceAvailable,
    voiceDuration,
    voiceInputActive,
    voiceLabel,
    voiceLevels,
    voiceState,
  } = useComposerVoice({
    latestDraftRef,
    onVoiceError: shared?.onVoiceError,
    store: editorStore,
    textareaRef,
    updateDraft,
    voiceProvider: shared?.voiceProvider,
  });

  const autosizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) {
      return;
    }
    el.style.height = "auto";
    const nextHeight = Math.min(maxHeight, Math.max(minHeight, el.scrollHeight));
    el.style.height = `${nextHeight}px`;
  }, [maxHeight, minHeight]);

  useLayoutEffect(() => {
    autosizeTextarea();
  }, [autosizeTextarea, value]);

  useEffect(() => () => {
    onInputActivityChange?.(false);
  }, [onInputActivityChange]);

  useEffect(() => () => {
    stopVoiceInput();
  }, [stopVoiceInput]);

  const addFiles = useCallback(async (files: readonly File[]) => {
    if (files.length === 0) {
      return;
    }
    const results = await Promise.allSettled(files.map(fileToAttachmentDraft));
    const ready: ComposerAttachmentDraft[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") {
        ready.push(result.value);
      } else {
        shared?.onAttachmentError?.(t("attachmentFailed", { name: files[index].name }));
      }
    });
    if (ready.length > 0) {
      setAttachments(mergeComposerAttachments(latestDraftRef.current.attachments, ready));
    }
  }, [setAttachments, shared, t]);

  const submit = useCallback(() => {
    const draft = latestDraftRef.current;
    const trimmed = draft.text.trim();
    if (trimmed.length === 0 && draft.attachments.length === 0) {
      return;
    }
    stopVoiceInput();
    onSubmit(composerSendPayload(trimmed, draft.attachments));
  }, [onSubmit, stopVoiceInput]);

  const cancel = useCallback(() => {
    stopVoiceInput();
    onCancel?.();
  }, [onCancel, stopVoiceInput]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void addFiles(files);
  };

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboard = event.clipboardData;
    const pastedFiles = clipboardFilesForComposer(clipboard);
    if (pastedFiles.length > 0) {
      event.preventDefault();
      void addFiles(pastedFiles);
      return;
    }
    const pastedTextFile = pastedTextFileForComposer(clipboard.getData("text/plain") ?? "");
    if (pastedTextFile) {
      event.preventDefault();
      void addFiles([pastedTextFile]);
    }
  };

  const shouldSubmitFromKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return false;
    }
    if (submitShortcut === "mod-enter") {
      return event.metaKey || event.ctrlKey;
    }
    return !event.shiftKey;
  };

  const renderAttachment = (attachment: ComposerAttachmentDraft) => {
    const isImage = isImageMime(attachment.type) && Boolean(attachment.path);
    return (
      <AttachmentTile
        key={attachment.id}
        name={attachment.name}
        mime={attachment.type}
        sizeBytes={attachment.size}
        previewSrc={isImage ? localFileUrl(attachment.path ?? "") : undefined}
        removeLabel={t("removeAttachment", { name: attachment.name })}
        onRemove={() => setAttachments(attachments.filter((item) => item.id !== attachment.id))}
        onOpen={isImage ? () => setPreviewAttachment(attachment) : undefined}
      />
    );
  };

  const canSend = (value.trim().length > 0 || attachments.length > 0) && voiceState !== "transcribing";

  return (
    <Stack data-testid={`${testIdPrefix}-editor`} spacing={1.25} sx={rootSx}>
      <input
        ref={fileInputRef}
        data-testid={`${testIdPrefix}-file-input`}
        aria-label={t("chooseFiles")}
        multiple
        type="file"
        onChange={handleFileChange}
        style={hiddenFileInputStyle}
      />
      <Box
        component="textarea"
        aria-label={ariaLabel}
        data-testid={`${testIdPrefix}-input`}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => updateDraft({ text: event.currentTarget.value, attachments })}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (shouldSubmitFromKey(event)) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            cancel();
          }
        }}
        onFocus={() => {
          onInputActivityChange?.(true);
          autosizeTextarea();
        }}
        onBlur={() => onInputActivityChange?.(false)}
        onPaste={handlePaste}
        ref={textareaRef}
        rows={inputRows}
        sx={composeSx(inlineEditorInputSx, { minHeight, maxHeight }, inputSx)}
      />
      {voiceState === "recording" && (
        <VoiceRecordingStrip
          label={voiceLabel}
          duration={voiceDuration}
          levels={voiceLevels}
          ambient={voiceAmbient}
          onLevelCountChange={setVoiceLevelCountForWidth}
          dockBottom
        />
      )}
      {attachments.length > 0 && (
        <Box data-testid={`${testIdPrefix}-attachments`} sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0.75 }}>
          {attachments.map(renderAttachment)}
        </Box>
      )}
      <Stack direction="row" spacing={0.75} sx={composeSx(inlineEditorActionsSx, actionsSx)}>
        <Tooltip title={t("attach")}>
          <span style={{ display: "flex" }}>
            <IconButton
              aria-label={t("attach")}
              data-testid={`${testIdPrefix}-attach-button`}
              tone="subtle"
              onClick={() => fileInputRef.current?.click()}
              sx={{ width: 30, height: 30, borderRadius: (theme) => `${theme.custom.radii.md}px` }}
            >
              <AttachFileIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </span>
        </Tooltip>
        {voiceAvailable && (
          <Tooltip title={voiceLabel}>
            <span style={{ display: "flex" }}>
              <IconButton
                aria-label={voiceLabel}
                data-testid={`${testIdPrefix}-voice-button`}
                tone="subtle"
                disabled={voiceState === "transcribing"}
                onClick={toggleVoiceInput}
                sx={{
                  width: 30,
                  height: 30,
                  borderRadius: (theme) => `${theme.custom.radii.md}px`,
                  backgroundColor: (theme) => (voiceState === "recording" ? theme.palette.status.info.soft : theme.custom.surfaces.s3),
                  borderColor: (theme) => (voiceState === "recording" ? theme.palette.status.info.border : theme.custom.borders.strong),
                  color: (theme) => (voiceState === "recording" ? theme.palette.status.info.main : theme.palette.text.primary),
                  "&:hover": {
                    backgroundColor: (theme) => (voiceState === "recording" ? theme.palette.status.info.soft : theme.custom.surfaces.s4),
                  },
                }}
              >
                {voiceInputActive ? <StopCircleIcon sx={{ fontSize: 18 }} /> : <MicRoundedIcon sx={{ fontSize: 18 }} />}
              </IconButton>
            </span>
          </Tooltip>
        )}
        {onCancel && cancelLabel && (
          <Button size="small" variant={cancelButtonVariant} onClick={cancel} sx={actionButtonSx}>
            {cancelLabel}
          </Button>
        )}
        <Button size="small" variant={submitButtonVariant} aria-label={submitAriaLabel} disabled={!canSend} onClick={submit} startIcon={<SendIcon sx={{ fontSize: 15 }} />} sx={actionButtonSx}>
          {submitLabel}
        </Button>
      </Stack>
      <ImageLightbox src={previewAttachment?.path ?? null} label={previewAttachment?.name} onClose={() => setPreviewAttachment(null)} />
    </Stack>
  );
});
