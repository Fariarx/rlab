import { createContext, useContext } from "react";
import type { ComposerProps } from "./Composer";

/** Composer props that are the same wherever the input is rendered for a given
 *  conversation — agent capabilities, file mentions, plugin tokens, voice,
 *  modes, limits. The instance-specific props (value/attachments/onSend/running
 *  and the bottom-dock-only chrome) are supplied per render site. */
export type ComposerSharedProps = Omit<
  ComposerProps,
  | "placeholder"
  | "variant"
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

/** Provided by WorkspacePage so in-thread editors can reuse conversation
 *  capabilities (voice provider, attachment errors, mentions/plugins) without
 *  mounting the full dock Composer inside a message bubble. Null outside a
 *  conversation (e.g. isolated tests), where editors keep plain local controls. */
const ComposerSharedContext = createContext<ComposerSharedProps | null>(null);

export const ComposerSharedProvider = ComposerSharedContext.Provider;

export function useComposerShared(): ComposerSharedProps | null {
  return useContext(ComposerSharedContext);
}
