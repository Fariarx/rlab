import ThumbDownAltIcon from "@mui/icons-material/ThumbDownAlt";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import { Box, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { Button } from "../ui";
import { StatusNote } from "./parts";
import { type ApprovalBlock } from "./types";

/** ApprovalRequest — the agent asks the user to approve or reject an action. */
export function ApprovalRequest({ block }: { readonly block: ApprovalBlock }) {
  const [result, setResult] = useState<"approved" | "rejected" | null>(null);

  return (
    <Box
      sx={{
        borderRadius: (t) => `${t.custom.radii.md}px`,
        border: (t) => `1px solid ${t.palette.status.warn.border}`,
        backgroundColor: (t) => t.palette.status.warn.soft,
        p: 1.5,
      }}
    >
      <Typography variant="microLabel" sx={{ color: (t) => t.palette.status.warn.main, display: "block", mb: 0.75 }}>
        Approval required
      </Typography>
      <Typography sx={{ fontSize: "0.88rem", fontWeight: 600, color: "text.primary" }}>{block.title}</Typography>
      {block.detail && <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", mt: 0.5 }}>{block.detail}</Typography>}

      <Box sx={{ mt: 1.5 }}>
        {result == null ? (
          <Stack direction="row" spacing={1}>
            <Button variant="contained" size="small" startIcon={<ThumbUpAltIcon sx={{ fontSize: 15 }} />} onClick={() => setResult("approved")}>
              Approve
            </Button>
            <Button variant="contained" color="error" size="small" startIcon={<ThumbDownAltIcon sx={{ fontSize: 15 }} />} onClick={() => setResult("rejected")}>
              Reject
            </Button>
          </Stack>
        ) : (
          <StatusNote level={result === "approved" ? "ok" : "error"}>
            {result === "approved" ? "Approved" : "Rejected"}
          </StatusNote>
        )}
      </Box>
    </Box>
  );
}
