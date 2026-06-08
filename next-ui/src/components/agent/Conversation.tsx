import { Box, Stack } from "@mui/material";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useI18n } from "../../i18n/I18nProvider";
import { type MessageDisplayPrefs, Message } from "./Message";
import { rise } from "./anim";
import type { MessageActionHandlers } from "./message-actions";
import { AgentAvatar, TypingDots } from "./parts";
import type { ChatMessage } from "./types";
import type { AgentProfile } from "./agents";

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

const BOTTOM_PIN_THRESHOLD = 96;

type ConversationItem = { readonly kind: "message"; readonly message: ChatMessage } | { readonly kind: "typing" };

// react-virtuoso can invoke computeItemKey/itemContent with an out-of-range
// (undefined) item during a data transition — e.g. when the messages array
// changes from a background-run update. Guard the deref so a stale index can't
// throw and white-screen the entire thread.
function itemKey(index: number, item: ConversationItem | undefined): string {
  return item?.kind === "message" ? item.message.id : `typing-${index}`;
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
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Whether the viewport is pinned to the latest message. Starts pinned so a
  // freshly opened conversation lands at the bottom; flips off when the user
  // scrolls up to read history so streaming updates don't yank them back down.
  const pinnedToBottom = useRef(true);
  // True only while the *user* is actively scrolling. We use it to distinguish a
  // user scroll-up (which should unpin) from the viewport leaving the bottom
  // simply because streaming content grew taller (which must NOT unpin, or
  // auto-scroll stops following after the first growth).
  const userScrolling = useRef(false);
  // Timestamp until which scroll activity is our own (programmatic) autoscroll,
  // so it isn't mistaken for a user scroll-up.
  const programmaticScrollUntil = useRef(0);
  const hasLiveContent = typing === true || messages.some(hasLiveAgentBlock);
  const items = useMemo<readonly ConversationItem[]>(
    () => (typing ? [...messages.map((message) => ({ kind: "message" as const, message })), { kind: "typing" as const }] : messages.map((message) => ({ kind: "message" as const, message }))),
    [messages, typing],
  );

  const scrollerEl = (): HTMLElement | null => (containerRef.current?.querySelector('[data-testid="virtuoso-scroller"]') as HTMLElement | null);

  const pinToBottom = () => {
    if (!pinnedToBottom.current) {
      return;
    }
    programmaticScrollUntil.current = performance.now() + 300;
    virtuosoRef.current?.scrollToIndex({ index: "LAST", align: "end", behavior: "auto" });
    // Also force the scroll element to its absolute bottom. scrollToIndex relies
    // on measured item heights (wrong until tall items/images settle), so on its
    // own it lands mid-thread; setting scrollTop directly is unconditional.
    const sc = scrollerEl();
    if (sc) {
      sc.scrollTop = sc.scrollHeight;
    }
  };

  // While pinned, keep the last item's end glued to the viewport bottom. This
  // fires on every streamed blocks update (the messages array is a fresh ref each
  // flush), so the thread sticks to the bottom continuously — not in jumps.
  useLayoutEffect(() => {
    if (items.length === 0) {
      return;
    }
    pinToBottom();
    const raf = requestAnimationFrame(pinToBottom);
    return () => cancelAnimationFrame(raf);
  }, [items]);

  // On open (the parent remounts this component per conversation via a key),
  // Virtuoso lays out with ESTIMATED item heights and lazy images load over the
  // next few seconds, both of which grow the content AFTER the first scroll — so
  // a one-shot scroll lands mid-thread. Keep re-pinning until the viewport is
  // actually at the bottom and has stayed there, so only the freshest messages
  // show. This is the fix for "opens in the middle of a long dialog".
  useLayoutEffect(() => {
    pinnedToBottom.current = true;
    let atBottomTicks = 0;
    let elapsed = 0;
    pinToBottom();
    const id = setInterval(() => {
      elapsed += 100;
      pinToBottom();
      const sc = scrollerEl();
      const distance = sc ? sc.scrollHeight - sc.clientHeight - sc.scrollTop : 0;
      atBottomTicks = distance <= 4 ? atBottomTicks + 1 : 0;
      // Stop early once it's been at the bottom for ~300ms; the 4s cap only
      // matters when images keep loading. A shorter cap keeps the open snappy.
      if (!pinnedToBottom.current || elapsed >= 4000 || atBottomTicks >= 3) {
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
    // Run once per mount (conversation open); the parent keys this component by
    // conversation id so a new conversation gets a fresh convergence pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Box
      ref={containerRef}
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
        isScrolling={(scrolling) => {
          userScrolling.current = scrolling;
        }}
        atBottomStateChange={(atBottom) => {
          if (atBottom) {
            pinnedToBottom.current = true;
          } else if (userScrolling.current && performance.now() > programmaticScrollUntil.current) {
            // Only a deliberate user scroll-up unpins; content growth (and our own
            // programmatic autoscroll) must not.
            pinnedToBottom.current = false;
          }
        }}
        computeItemKey={itemKey}
        defaultItemHeight={96}
        followOutput={() => (pinnedToBottom.current ? "auto" : false)}
        increaseViewportBy={{ bottom: 640, top: 320 }}
        initialItemCount={Math.min(items.length, 20)}
        {...(import.meta.env.MODE !== "test" && items.length > 0
          ? { initialTopMostItemIndex: { index: items.length - 1, align: "end" as const } }
          : {})}
        minOverscanItemCount={{ bottom: 8, top: 4 }}
        style={{ height: "100%" }}
        components={{ Footer: bottomInset > 0 ? () => <Box sx={{ height: bottomInset }} /> : undefined }}
        itemContent={(index, item) =>
          item ? (
            <Box sx={{ width: "100%", maxWidth: contentMaxWidth, mx: "auto", px: contentPaddingX, pt: index === 0 ? { xs: 2.5, sm: 4 } : 0, pb: 3 }}>
              {item.kind === "message" ? <Message actions={actions} displayPrefs={displayPrefs} agentProfile={agentProfile} message={item.message} index={index} /> : <TypingRow delay={messages.length * 120} />}
            </Box>
          ) : null
        }
      />
    </Box>
  );
}
