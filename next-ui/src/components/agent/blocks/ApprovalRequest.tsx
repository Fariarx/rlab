import ThumbDownAltIcon from "@mui/icons-material/ThumbDownAlt";
import ThumbUpAltIcon from "@mui/icons-material/ThumbUpAlt";
import { Box, Stack, Typography } from "@mui/material";
import { observer } from "mobx-react-lite";
import { useState } from "react";
import { useI18n } from "../../../i18n/I18nProvider";
import { Button } from "../../ui";
import { ApprovalRequestStore } from "../stores/agent-local-stores";
import { StatusNote } from "./parts";
import type { ApprovalBlock, ApprovalDecision } from "../core/types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** ApprovalRequest — the agent asks the user to approve or reject an action. */
export const ApprovalRequest = observer(function ApprovalRequest({
  block,
  onDecision,
}: {
  readonly block: ApprovalBlock;
  readonly onDecision?: (approvalId: string, decision: ApprovalDecision) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const [store] = useState(() => new ApprovalRequestStore(block.decision ?? null));
  const { result, setResult, pendingDecision, setPendingDecision, decisionError, setDecisionError } = store;

  const decide = (decision: ApprovalDecision) => {
    if (!block.id || !onDecision) {
      setResult(decision);
      return;
    }

    setPendingDecision(decision);
    setDecisionError(null);
    void Promise.resolve(onDecision(block.id, decision))
      .then(() => setResult(decision))
      .catch((error) => setDecisionError(errorMessage(error)))
      .finally(() => setPendingDecision(null));
  };

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
        {t("approvalRequired")}
      </Typography>
      <Typography sx={{ fontSize: "0.88rem", fontWeight: 600, color: "text.primary" }}>{block.title}</Typography>
      {block.detail && <Typography sx={{ fontSize: "0.8rem", color: "text.secondary", mt: 0.5 }}>{block.detail}</Typography>}

      <Box sx={{ mt: 1.5 }}>
        {result == null ? (
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              size="small"
              disabled={pendingDecision !== null}
              startIcon={<ThumbUpAltIcon sx={{ fontSize: 15 }} />}
              onClick={() => decide("approved")}
            >
              {t("approve")}
            </Button>
            <Button
              variant="contained"
              color="error"
              size="small"
              disabled={pendingDecision !== null}
              startIcon={<ThumbDownAltIcon sx={{ fontSize: 15 }} />}
              onClick={() => decide("rejected")}
            >
              {t("reject")}
            </Button>
          </Stack>
        ) : (
          <StatusNote level={result === "approved" ? "ok" : "error"}>
            {result === "approved" ? t("approved") : t("rejected")}
          </StatusNote>
        )}
        {decisionError && (
          <Box sx={{ mt: 1 }}>
            <StatusNote level="error">{t("approvalDecisionError", { error: decisionError })}</StatusNote>
          </Box>
        )}
      </Box>
    </Box>
  );
});
