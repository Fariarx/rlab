import KeyboardArrowDownRoundedIcon from "@mui/icons-material/KeyboardArrowDownRounded";
import { Box, IconButton, Stack, Tooltip } from "@mui/material";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { type MessageDisplayPrefs, Message } from "../message/Message";
import { rise } from "../core/anim";
import type { MessageActionHandlers } from "../message/message-actions";
import { AgentAvatar, TypingDots } from "../blocks/parts";
import type { ChatMessage } from "../core/types";
import type { AgentProfile } from "../core/agents";
import { useConversationAutoScroll } from "./use-conversation-auto-scroll";

function hasLiveAgentBlock(message: ChatMessage): boolean {
  if (message.role !== "agent") {
    return false;
  }
  return Boolean(
    message.blocks?.some((block) => {
      if (block.kind === "text") {
        return block.streaming === true;
      }
      if (block.kind === "reasoning") {
        return block.active === true;
      }
      if (block.kind === "tool" || block.kind === "command" || block.kind === "search") {
        return block.state === "running";
      }
      if (block.kind === "plan") {
        return block.steps.some((step) => step.state === "running");
      }
      return false;
    }),
  );
}

// Long threads render only the most recent slice so a freshly opened
// conversation lands at the bottom instantly (no virtual-list height estimation
// to drift mid-thread) and the DOM stays bounded. Older turns load on demand.
const INITIAL_WINDOW = 60;
const WINDOW_STEP = 60;

type ConversationItem = { readonly kind: "message"; readonly message: ChatMessage } | { readonly kind: "typing" };

function itemKey(index: number, item: ConversationItem): string {
  return item.kind === "message" ? item.message.id : `typing-${index}`;
}

function TypingRow({ delay }: { readonly delay: number }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", ...rise(delay) }}>
      <AgentAvatar />
      <Box
        sx={{
          px: 1.5,
          py: 1,
          borderRadius: (t) => `${t.custom.radii.lg}px`,
          borderTopLeftRadius: (t) => `${t.custom.radii.sm}px`,
          backgroundColor: (t) => t.custom.surfaces.s2,
          border: (t) => `1px solid ${t.custom.borders.subtle}`,
        }}
      >
        <TypingDots />
      </Box>
    </Stack>
  );
}

/** Conversation — the message thread, with an optional trailing typing row. */
export function Conversation({
  messages,
  typing,
  actions,
  displayPrefs,
  agentProfile,
  contentMaxWidth,
  contentPaddingX,
  bottomInset = 0,
}: {
  readonly messages: readonly ChatMessage[];
  readonly typing?: boolean;
  readonly actions?: MessageActionHandlers;
  readonly displayPrefs?: MessageDisplayPrefs;
  readonly agentProfile?: AgentProfile;
  /** Max width of the centered message column. The scroll container stays
   *  full-width so its scrollbar sits at the screen edge. */
  readonly contentMaxWidth?: number;
  readonly contentPaddingX?: { readonly xs: number; readonly sm: number };
  /** Extra bottom space (px) reserved for the composer's floating tags row. */
  readonly bottomInset?: number;
}) {
  const { t } = useI18n();
  const hasLiveContent = typing === true || messages.some(hasLiveAgentBlock);
  const items = useMemo<readonly ConversationItem[]>(
    () => (typing ? [...messages.map((message) => ({ kind: "message" as const, message })), { kind: "typing" as const }] : messages.map((message) => ({ kind: "message" as const, message }))),
    [messages, typing],
  );

  const [windowSize, setWindowSize] = useState(INITIAL_WINDOW);
  const hiddenCount = Math.max(0, items.length - windowSize);
  const windowed = useMemo(() => items.slice(hiddenCount), [items, hiddenCount]);

  // Reveal older turns as the user scrolls up, without the viewport jumping:
  // remember the distance from the bottom before the prepend and restore it once
  // the taller content lays out. A ref guards against re-triggering mid-prepend.
  const pendingPrepend = useRef<number | null>(null);
  const loadEarlier = useCallback((element: HTMLDivElement) => {
    if (pendingPrepend.current != null) {
      return;
    }
    pendingPrepend.current = element.scrollHeight - element.scrollTop;
    setWindowSize((size) => (size >= items.length ? size : size + WINDOW_STEP));
  }, [items.length]);

  const autoScroll = useConversationAutoScroll(windowed, { onReachTop: hiddenCount > 0 ? loadEarlier : undefined });

  useLayoutEffect(() => {
    const offset = pendingPrepend.current;
    pendingPrepend.current = null;
    const element = autoScroll.containerRef.current;
    if (offset != null && element) {
      element.scrollTop = element.scrollHeight - offset;
    }
  }, [windowSize, autoScroll.containerRef]);

  return (
    <Box sx={{ position: "relative", height: "100%", minHeight: 0 }}>
      <Box
        ref={autoScroll.containerRef}
        data-testid="conversation-virtual-list"
        data-windowed={hiddenCount > 0 ? "true" : "false"}
        role="log"
        aria-label={t("conversationThread")}
        aria-live={hasLiveContent ? "polite" : "off"}
        aria-relevant="additions text"
        sx={{ height: "100%", minHeight: 0, overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain" }}
      >
        <Box ref={autoScroll.contentRef}>
          {windowed.map((item, index) => (
            <Box
              key={itemKey(index, item)}
              sx={{ width: "100%", minWidth: 0, maxWidth: contentMaxWidth, mx: "auto", px: contentPaddingX, pt: index === 0 && hiddenCount === 0 ? { xs: 2.5, sm: 4 } : 0, pb: 3, overflowX: "clip" }}
            >
              {item.kind === "message" ? (
                <Message actions={actions} displayPrefs={displayPrefs} agentProfile={agentProfile} message={item.message} index={hiddenCount + index} />
              ) : (
                <TypingRow delay={messages.length * 120} />
              )}
            </Box>
          ))}
          {bottomInset > 0 && <Box sx={{ height: bottomInset }} />}
        </Box>
      </Box>
      {autoScroll.showScrollToBottom && (
        <Tooltip title={t("scrollToBottom")}>
          <IconButton
            aria-label={t("scrollToBottom")}
            data-testid="scroll-to-bottom-button"
            onClick={autoScroll.scrollToBottom}
            sx={{
              position: "absolute",
              left: "50%",
              bottom: `${bottomInset + 14}px`,
              transform: "translateX(-50%)",
              zIndex: 5,
              width: 34,
              height: 34,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              border: (theme) => `1px solid ${theme.custom.borders.strong}`,
              backgroundColor: (theme) => theme.custom.surfaces.s2,
              color: (theme) => theme.palette.text.primary,
              boxShadow: "0 10px 28px rgba(0,0,0,0.28)",
              "&:hover": {
                backgroundColor: (theme) => theme.custom.surfaces.s3,
              },
            }}
          >
            <KeyboardArrowDownRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
}
