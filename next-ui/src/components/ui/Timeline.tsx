import { Box, Stack, Typography } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { ReactNode } from "react";
import type { StatusKey } from "../../theme/tokens";
import { StatusDot } from "./StatusDot";

/**
 * Timeline — a vertical status rail of events. Each node is a <StatusDot/>
 * connected by a muted line, with a monospace timestamp and content. Built
 * custom to avoid pulling in @mui/lab.
 */
export interface TimelineItem {
  readonly id: string;
  readonly status: StatusKey;
  readonly time?: string;
  readonly title: ReactNode;
  readonly detail?: ReactNode;
  /** Accessible status text for the node dot (defaults to the status key). */
  readonly statusLabel?: string;
}

export interface TimelineProps {
  readonly items: readonly TimelineItem[];
  readonly className?: string;
}

const Rail = styled("div")(({ theme }) => ({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  flex: "0 0 auto",
  gap: 4,
  "& .timeline-line": {
    flex: 1,
    width: 1,
    minHeight: 16,
    backgroundColor: theme.custom.borders.subtle,
  },
}));

export function Timeline({ items, className }: TimelineProps) {
  return (
    <Stack className={className} spacing={0}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <Stack key={item.id} direction="row" spacing={1.5} sx={{ alignItems: "stretch" }}>
            <Rail>
              <Box sx={{ pt: "5px" }}>
                <StatusDot status={item.status} label={item.statusLabel ?? item.status} />
              </Box>
              {!isLast && <span className="timeline-line" />}
            </Rail>
            <Box sx={{ pb: isLast ? 0 : 2.5, minWidth: 0 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "baseline" }}>
                <Typography component="span" sx={{ fontSize: "0.85rem", color: "text.primary" }}>
                  {item.title}
                </Typography>
                {item.time != null && (
                  <Typography
                    component="span"
                    sx={{
                      fontFamily: (theme) => theme.custom.fonts.mono,
                      fontSize: "0.72rem",
                      color: (theme) => theme.palette.status.idle.main,
                    }}
                  >
                    {item.time}
                  </Typography>
                )}
              </Stack>
              {item.detail != null && (
                <Typography variant="body2" sx={{ mt: 0.5, color: "text.secondary" }}>
                  {item.detail}
                </Typography>
              )}
            </Box>
          </Stack>
        );
      })}
    </Stack>
  );
}
