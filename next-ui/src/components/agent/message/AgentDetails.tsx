import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import PsychologyIcon from "@mui/icons-material/Psychology";
import { Box, ButtonBase, Collapse, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useEffect, useId, useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { AgentBlockRenderer } from "../blocks/AgentBlockRenderer";
import { ResolvedOptionSummary } from "../blocks/ResolvedOptionSummary";
import { AgentDetailsStore } from "../stores/agent-local-stores";
import { keyedAgentBlocks } from "./message-block-keys";
import { firstReasoningStartedAtMs, formatElapsedSeconds } from "./message-display-model";
import type { MessageActionHandlers } from "./message-actions";
import { TypingDots } from "../blocks/parts";
import type { AgentBlock } from "../core/types";
import { useLiveElapsedSeconds } from "./use-live-elapsed-seconds";

const durationLabelSx = { fontFamily: (theme: { custom: { fonts: { mono: string } } }) => theme.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary", flex: "0 0 auto", whiteSpace: "nowrap" } as const;

export interface AgentDetailsProps {
  readonly actions?: MessageActionHandlers;
  readonly autoExpand?: boolean;
  readonly blocks: readonly AgentBlock[];
  readonly hasResultAfter?: boolean;
  readonly live?: boolean;
  readonly showSpinner?: boolean;
  readonly startedAtMs?: number;
  readonly visible?: boolean;
}

/** Collapsed-by-default container holding an agent turn's intermediate work. */
export const AgentDetails = observer(function AgentDetails({
  blocks,
  actions,
  autoExpand = false,
  live = false,
  showSpinner = false,
  hasResultAfter = false,
  startedAtMs,
  visible = true,
}: AgentDetailsProps) {
  // `autoExpand` opens live reasoning when the conversation becomes visible.
  // Afterwards the user's manual toggle wins until visibility/live state changes.
  const [store] = useState(() => new AgentDetailsStore(autoExpand && live && visible));
  const { open, setOpen } = store;
  const detailsId = useId();
  const { t } = useI18n();
  const reasoning = blocks.find((block) => block.kind === "reasoning");
  const reasoningDuration = reasoning?.kind === "reasoning" ? reasoning.duration : undefined;
  const blockStartedAtMs = firstReasoningStartedAtMs(blocks);
  const doneSeconds = reasoningDuration ? Number.parseInt(reasoningDuration, 10) : Number.NaN;

  useEffect(() => {
    if (hasResultAfter) {
      setOpen(false);
      return;
    }
    if (autoExpand && live && visible) {
      setOpen(true);
    }
  }, [autoExpand, hasResultAfter, live, setOpen, visible]);

  const liveAnchor = startedAtMs ?? blockStartedAtMs;
  // Tie the timer to the whole live turn, not to the spinner. The spinner toggles
  // off while the answer text streams (it carries its own dots), and tying the
  // clock to it made the number flip between the live elapsed and the reasoning
  // block's recorded duration — a visible jump. Now it ticks continuously.
  const liveSeconds = useLiveElapsedSeconds({ active: live, startedAtMs: liveAnchor });
  const durationUnits = { minute: t("unitMinShort"), second: t("unitSecShort") };
  const expandable = blocks.some((block) => (block.kind === "reasoning" ? block.text.trim().length > 0 : true));
  const isOpen = expandable && open;
  const headerContent = (
    <>
      <PsychologyIcon sx={{ fontSize: 16, color: "text.secondary", flex: "0 0 auto" }} />
      <Typography variant="microLabel" sx={{ color: "text.secondary", flex: 1, minWidth: 0 }}>
        {t("reasoning")}
      </Typography>
      {live ? (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", flex: "0 0 auto" }}>
          {showSpinner && <TypingDots />}
          {liveSeconds !== null && <Typography component="span" sx={durationLabelSx}>{formatElapsedSeconds(liveSeconds, durationUnits)}</Typography>}
        </Stack>
      ) : Number.isFinite(doneSeconds) ? (
        <Typography component="span" sx={durationLabelSx}>{t("reasoningWorked", { duration: formatElapsedSeconds(doneSeconds, durationUnits) })}</Typography>
      ) : null}
      {expandable && <KeyboardArrowDownIcon sx={{ fontSize: 18, color: "text.secondary", transition: "transform 180ms ease", transform: isOpen ? "rotate(180deg)" : "none" }} />}
    </>
  );
  const headerSx = {
    alignItems: "center",
    display: "flex",
    gap: 1.25,
    justifyContent: "flex-start",
    px: 1.5,
    py: 1,
    textAlign: "left",
    width: "100%",
  } as const;

  return (
    <Box sx={{ borderRadius: (theme) => `${theme.custom.radii.md}px`, border: (theme) => `1px dashed ${theme.custom.borders.subtle}`, backgroundColor: (theme) => theme.custom.surfaces.s1, overflow: "clip" }}>
      {expandable ? (
        <ButtonBase
          aria-controls={detailsId}
          aria-expanded={isOpen}
          onClick={() => setOpen((value) => !value)}
          sx={{ ...headerSx, position: "sticky", top: 0, zIndex: 3, backgroundColor: (theme) => theme.custom.surfaces.s1, "&:hover": { backgroundColor: (theme) => theme.custom.surfaces.s3 } }}
          type="button"
        >
          {headerContent}
        </ButtonBase>
      ) : (
        <Stack direction="row" sx={{ ...headerSx, position: "sticky", top: 0, zIndex: 3, backgroundColor: (theme) => theme.custom.surfaces.s1 }}>
          {headerContent}
        </Stack>
      )}
      <Collapse in={isOpen} unmountOnExit>
        <Stack
          data-testid="agent-details-body"
          id={detailsId}
          spacing={0.75}
          sx={{
            "--agent-sticky-top": "0px",
            "--agent-sticky-z-index": 2,
            px: 1.5,
            py: 1.5,
            borderTop: (theme) => `1px dashed ${theme.custom.borders.subtle}`,
          }}
        >
          {keyedAgentBlocks(blocks.filter((block) => !(block.kind === "reasoning" && block.text.trim().length === 0))).map(({ block, key }) =>
              block.kind === "options" && (block.selected?.length ?? 0) > 0 ? (
                <ResolvedOptionSummary key={key} block={block} />
              ) : block.kind === "reasoning" ? (
                <Typography
                  key={key}
                  component="div"
                  sx={{
                    fontFamily: (theme) => theme.custom.fonts.mono,
                    fontSize: "0.76rem",
                    lineHeight: 1.7,
                    color: "text.secondary",
                    whiteSpace: "pre-line",
                    overflowWrap: "anywhere",
                    wordBreak: "break-word",
                    fontStyle: "italic",
                  }}
                >
                  {block.text.trim()}
                </Typography>
              ) : (
                <AgentBlockRenderer
                  key={key}
                  block={block.kind === "text" ? { ...block, streaming: false } : block}
                  actions={actions ? { onApprovalDecision: actions.onApprovalDecision, onOptionSelection: actions.onOptionSelection } : undefined}
                />
              ),
            )}
        </Stack>
      </Collapse>
    </Box>
  );
});
