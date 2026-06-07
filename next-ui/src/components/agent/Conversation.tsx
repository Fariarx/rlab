import { Box, Stack } from "@mui/material";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useI18n } from "../../i18n/I18nProvider";
import { type MessageDisplayPrefs, Message } from "./Message";
import { rise } from "./anim";
import { type MessageActionHandlers } from "./message-actions";
import { AgentAvatar, TypingDots } from "./parts";
import { type ChatMessage } from "./types";

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
      return false;
    }),
  );
}

const BOTTOM_PIN_THRESHOLD = 96;

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
  contentMaxWidth,
  contentPaddingX,
  bottomInset = 0,
}: {
  readonly messages: readonly ChatMessage[];
  readonly typing?: boolean;
  readonly actions?: MessageActionHandlers;
  readonly displayPrefs?: MessageDisplayPrefs;
  /** Max width of the centered message column. The scroll container stays
   *  full-width so its scrollbar sits at the screen edge. */
  readonly contentMaxWidth?: number;
  readonly contentPaddingX?: { readonly xs: number; readonly sm: number };
  /** Extra bottom space (px) reserved for the composer's floating tags row. */
  readonly bottomInset?: number;
}) {
  const { t } = useI18n();
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  // Whether the viewport is pinned to the latest message. Starts pinned so a
  // freshly opened conversation lands at the bottom; flips off when the user
  // scrolls up to read history so streaming updates don't yank them back down.
  const pinnedToBottom = useRef(true);
  const hasLiveContent = typing === true || messages.some(hasLiveAgentBlock);
  const items = useMemo<readonly ConversationItem[]>(
    () => (typing ? [...messages.map((message) => ({ kind: "message" as const, message })), { kind: "typing" as const }] : messages.map((message) => ({ kind: "message" as const, message }))),
    [messages, typing],
  );

  useLayoutEffect(() => {
    if (!pinnedToBottom.current) {
      return;
    }
    virtuosoRef.current?.autoscrollToBottom();
    // Tall messages (big diffs/code) finish measuring after the first paint, so a
    // single autoscroll can stop mid-content. Re-pin on the next frame so a freshly
    // opened thread lands fully at the bottom.
    const raf = requestAnimationFrame(() => {
      if (pinnedToBottom.current) {
        virtuosoRef.current?.autoscrollToBottom();
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [messages, typing]);

  return (
    <Box
      data-testid="conversation-virtual-list"
      data-virtualized="true"
      role="log"
      aria-label={t("conversationThread")}
      aria-live={hasLiveContent ? "polite" : "off"}
      aria-relevant="additions text"
      sx={{ height: "100%", minHeight: 0, overflow: "hidden" }}
    >
      <Virtuoso
        ref={virtuosoRef}
        data={items}
        alignToBottom
        atBottomThreshold={BOTTOM_PIN_THRESHOLD}
        atBottomStateChange={(atBottom) => {
          pinnedToBottom.current = atBottom;
        }}
        computeItemKey={itemKey}
        defaultItemHeight={96}
        followOutput={(atBottom) => (atBottom ? "auto" : false)}
        increaseViewportBy={{ bottom: 640, top: 320 }}
        initialItemCount={Math.min(items.length, 20)}
        minOverscanItemCount={{ bottom: 8, top: 4 }}
        style={{ height: "100%" }}
        components={{ Footer: bottomInset > 0 ? () => <Box sx={{ height: bottomInset }} /> : undefined }}
        itemContent={(index, item) => (
          <Box sx={{ width: "100%", maxWidth: contentMaxWidth, mx: "auto", px: contentPaddingX, pt: index === 0 ? { xs: 2.5, sm: 4 } : 0, pb: 3 }}>
            {item.kind === "message" ? <Message actions={actions} displayPrefs={displayPrefs} message={item.message} index={index} /> : <TypingRow delay={messages.length * 120} />}
          </Box>
        )}
      />
    </Box>
  );
}
