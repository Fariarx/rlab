import AccessTimeIcon from "@mui/icons-material/AccessTime";
import { Box, Popover, Stack, Typography } from "@mui/material";
import { type MouseEvent, useState } from "react";
import { ComposerTag } from "./ComposerTag";

/** A labelled key/value line shown in the wakeup details popover. */
export interface WakeupDetailRow {
  readonly label: string;
  readonly value: string;
}

/** Display-ready details for the wakeup tag popover. Formatting/i18n is done by
 *  the caller (workspace-composer-model) so this stays purely presentational. */
export interface WakeupTagDetail {
  readonly heading: string;
  readonly rows: readonly WakeupDetailRow[];
  readonly promptLabel: string;
  readonly prompt: string;
  readonly script?: { readonly label: string; readonly body: string };
}

export interface WakeupTileProps {
  readonly id: string;
  readonly label: string;
  readonly removeLabel: string;
  readonly onRemove: () => void;
  readonly detail: WakeupTagDetail;
}

function DetailRow({ row }: { readonly row: WakeupDetailRow }) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline" }}>
      <Typography sx={{ flex: "0 0 92px", fontSize: "0.7rem", color: "text.tertiary" }}>{row.label}</Typography>
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: "0.78rem", color: "text.primary", overflowWrap: "anywhere" }}>{row.value}</Typography>
    </Stack>
  );
}

export function WakeupDetailsPopover({
  anchorEl,
  detail,
  id,
  onClose,
  testIdPrefix = "scheduled-wakeup",
}: {
  readonly anchorEl: HTMLElement | null;
  readonly detail: WakeupTagDetail;
  readonly id: string;
  readonly onClose: () => void;
  readonly testIdPrefix?: string;
}) {
  return (
    <Popover
      open={Boolean(anchorEl)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "left" }}
      transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{
        paper: {
          sx: {
            mt: -1,
            width: 340,
            maxWidth: "calc(100vw - 24px)",
            p: 1.5,
            borderRadius: (theme) => `${theme.custom.radii.lg}px`,
            border: (theme) => `1px solid ${theme.custom.borders.strong}`,
            backgroundColor: (theme) => theme.custom.surfaces.s2,
            backgroundImage: "none",
            boxShadow: "0 12px 32px rgba(0, 0, 0, 0.4)",
          },
        },
      }}
    >
      <Stack data-testid={`${testIdPrefix}-popover-${id}`} spacing={1.25}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <AccessTimeIcon sx={{ fontSize: 16, color: (theme) => theme.palette.status.warn.main }} />
          <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: "text.primary" }}>{detail.heading}</Typography>
        </Stack>
        <Stack spacing={0.5}>
          {detail.rows.map((row) => (
            <DetailRow key={`${row.label}:${row.value}`} row={row} />
          ))}
        </Stack>
        <Stack spacing={0.5}>
          <Typography sx={{ fontSize: "0.7rem", color: "text.tertiary" }}>{detail.promptLabel}</Typography>
          <Box
            sx={{
              maxHeight: 180,
              overflow: "auto",
              p: 1,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              backgroundColor: (theme) => theme.custom.surfaces.s1,
              fontSize: "0.78rem",
              color: "text.primary",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {detail.prompt}
          </Box>
        </Stack>
        {detail.script && (
          <Stack spacing={0.5}>
            <Typography sx={{ fontSize: "0.7rem", color: "text.tertiary" }}>{detail.script.label}</Typography>
            <Box
              component="pre"
              sx={{
                m: 0,
                maxHeight: 160,
                overflow: "auto",
                p: 1,
                borderRadius: (theme) => `${theme.custom.radii.md}px`,
                backgroundColor: (theme) => theme.custom.surfaces.s1,
                fontFamily: (theme) => theme.custom.fonts.mono,
                fontSize: "0.72rem",
                color: "text.primary",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
              }}
            >
              {detail.script.body}
            </Box>
          </Stack>
        )}
      </Stack>
    </Popover>
  );
}

/** The scheduled-wakeup tag in the composer's floating row. Clicking it opens a
 *  popover with the full wakeup details (schedule, next run, prompt, reason). */
export function WakeupTile({ id, label, removeLabel, onRemove, detail }: WakeupTileProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  return (
    <>
      <ComposerTag
        icon={<AccessTimeIcon sx={{ fontSize: 15, color: (theme) => theme.palette.status.warn.main }} />}
        label={label}
        clickAriaLabel={label}
        removeLabel={removeLabel}
        onRemove={onRemove}
        onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
        testId={`scheduled-wakeup-tile-${id}`}
        pill
      />
      <WakeupDetailsPopover anchorEl={anchorEl} detail={detail} id={id} onClose={() => setAnchorEl(null)} />
    </>
  );
}
