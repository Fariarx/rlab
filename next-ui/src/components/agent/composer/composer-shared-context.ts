import { createContext, useContext } from "react";
import type { ComposerProps } from "./Composer";

/** Composer props that are the same wherever the input is rendered for a given
 *  conversation — agent capabilities, file mentions, plugin tokens, voice,
 *  modes, limits. The instance-specific props (value/attachments/onSend/running
 *  and the bottom-dock-only chrome) are supplied per render site. */
export type ComposerSharedProps = Omit<
  ComposerProps,
  | "placeholder"
  | "value"
  | "attachments"
  | "initialValue"
  | "initialAttachments"
  | "onDraftChange"
  | "onSend"
  | "onStop"
  | "running"
  | "reviewCount"
  | "onSendReview"
  | "onTagsHeightChange"
  | "onOverlayLiftChange"
  | "history"
  | "scheduledWakeups"
>;

/** Provided by WorkspacePage so the in-thread message editor can render the real
 *  Composer with full parity instead of a bare textarea. Null outside a
 *  conversation (e.g. isolated tests), where editors fall back to plain text. */
const ComposerSharedContext = createContext<ComposerSharedProps | null>(null);

export const ComposerSharedProvider = ComposerSharedContext.Provider;

export function useComposerShared(): ComposerSharedProps | null {
  return useContext(ComposerSharedContext);
}
