import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

/**
 * KitSectionShell — shared frame for every showcase section: a micro-label
 * heading, optional description, and a content slot.
 */
export interface KitSectionShellProps {
  readonly id: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly children: ReactNode;
}

export function KitSectionShell({ id, title, description, children }: KitSectionShellProps) {
  return (
    <Box component="section" id={id} sx={{ scrollMarginTop: 24 }}>
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        <Typography variant="microLabel" component="h2" sx={{ color: "text.secondary" }}>
          {title}
        </Typography>
        {description != null && (
          <Typography variant="body2" sx={{ color: "text.secondary", maxWidth: 640 }}>
            {description}
          </Typography>
        )}
      </Stack>
      {children}
    </Box>
  );
}
