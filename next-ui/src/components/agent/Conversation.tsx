import { Box, Stack } from "@mui/material";
import { useLayoutEffect, useRef } from "react";
import { Message } from "./Message";
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

/** Conversation — the message thread, with an optional trailing typing row. */
export function Conversation({
  messages,
  typing,
  actions,
  contentMaxWidth,
  contentPaddingX,
}: {
  readonly messages: readonly ChatMessage[];
  readonly typing?: boolean;
  readonly actions?: MessageActionHandlers;
  /** Max width of the centered message column. The scroll container stays
   *  full-width so its scrollbar sits at the screen edge. */
  readonly contentMaxWidth?: number;
  readonly contentPaddingX?: { readonly xs: number; readonly sm: number };
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Whether the viewport is pinned to the latest message. Starts pinned so a
  // freshly opened conversation lands at the bottom; flips off when the user
  // scrolls up to read history so streaming updates don't yank them back down.
  const pinnedToBottom = useRef(true);
  const hasLiveContent = typing === true || messages.some(hasLiveAgentBlock);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (el) {
      pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_PIN_THRESHOLD;
    }
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, typing]);

  return (
    <Box
      ref={scrollRef}
      onScroll={handleScroll}
      data-testid="conversation-virtual-list"
      data-virtualized="false"
      aria-live={hasLiveContent ? "polite" : "off"}
      aria-relevant="additions text"
      sx={{ height: "100%", minHeight: 0, overflowY: "auto", overflowX: "hidden" }}
    >
      {/* minHeight:100% + justify-end keeps short threads pinned to the bottom.
          Overflow lives on the parent (not this flex box) so tall threads stay
          fully scrollable — sidestepping the flex-end + overflow clipping bug.
          maxWidth centers the column while the scrollbar stays at the screen edge. */}
      <Stack sx={{ minHeight: "100%", justifyContent: "flex-end", width: "100%", maxWidth: contentMaxWidth, mx: "auto", px: contentPaddingX, py: { xs: 2.5, sm: 4 } }}>
        {messages.map((message, index) => (
          <Box key={message.id} sx={{ pb: 3 }}>
            <Message actions={actions} message={message} index={index} />
          </Box>
        ))}
        {typing && (
          <Box sx={{ pb: 3 }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", ...rise(messages.length * 120) }}>
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
          </Box>
        )}
      </Stack>
    </Box>
  );
}
