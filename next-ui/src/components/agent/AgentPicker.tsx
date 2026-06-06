import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, Dialog, DialogActions, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { pop } from "./anim";
import {
  AGENTS,
  type AgentId,
  type AgentProfile,
  agentStatusKey,
  getAgent,
  withAlpha,
} from "./agents";
import { useAgentCliInfo, useAgentStatus, useAgentStatusError, useAgentStatusLive, useReloadAgentStatus } from "./use-agent-status";

function cliBinsLabel(bins: readonly string[]): string {
  return bins.length > 0 ? bins.join(", ") : "unknown";
}

/** AgentPicker — a polished dialog for choosing the agent + variant, showing
 * each agent's status in the system. */
export function AgentPicker({
  open,
  value,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly value: AgentProfile;
  readonly onClose: () => void;
  readonly onSelect: (profile: AgentProfile) => void;
}) {
  const [agent, setAgent] = useState<AgentId>(value.agent);
  const [variant, setVariant] = useState<string>(value.variant);
  const statusOf = useAgentStatus();
  const cliInfoOf = useAgentCliInfo();
  const liveCliDetection = useAgentStatusLive();
  const detectionError = useAgentStatusError();
  const reloadAgentStatus = useReloadAgentStatus();
  const { t, agentStatus } = useI18n();

  const def = getAgent(agent);
  const selectedCli = cliInfoOf(agent);
  const selectedStatus = statusOf(agent);
  const canUse = selectedCli?.selectable ?? (selectedStatus !== "unavailable" && selectedStatus !== "unsupported");
  const titleId = "agent-picker-title";

  useEffect(() => {
    if (open) {
      setAgent(value.agent);
      setVariant(value.variant);
    }
  }, [open, value.agent, value.variant]);

  const choose = (id: AgentId) => {
    setAgent(id);
    setVariant("DEFAULT");
  };

  const confirm = () => {
    onSelect({ agent, variant });
    onClose();
  };

  const cliDetailText = (id: AgentId): string => {
    const agentDef = getAgent(id);
    const sys = statusOf(id);
    const cli = cliInfoOf(id);
    const bins = cliBinsLabel(cli?.bins ?? agentDef.cliBins);
    if (sys === "unavailable") {
      return t("agentCliNotFound", { bins });
    }
    if (sys === "needs-setup") {
      const env = cli?.env.length ? cli.env.join(", ") : "";
      return env ? t("agentCliNeedsSetup", { env }) : agentStatus(sys);
    }
    if (sys === "unsupported" || cli?.runAdapter === false || !agentDef.runAdapter) {
      return t("agentCliAdapterMissing");
    }
    if (cli?.resolvedBin) {
      return t("agentCliPath", { path: cli.resolvedBin });
    }
    return liveCliDetection ? t("agentCliAdapterReady") : t("agentCliDetectionPending");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={titleId}>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", px: 2.5, pt: 2, pb: 1.5 }}
      >
        <Box>
          <Typography id={titleId} component="h2" sx={{ fontSize: "1rem", fontWeight: 700, color: "text.primary" }}>{t("chooseAgent")}</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {t("agentAccessWarning")}
          </Typography>
        </Box>
        <IconButton aria-label={t("cancel")} onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      <Box sx={{ px: 2.5, pb: 1, maxHeight: 360, overflow: "auto" }}>
        {detectionError && (
          <Alert
            severity="error"
            sx={{ mb: 1 }}
            action={
              <Button size="small" variant="text" onClick={reloadAgentStatus}>
                {t("retryAgentDetection")}
              </Button>
            }
          >
            {t("agentDetectionError", { error: detectionError })}
          </Alert>
        )}
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
          {AGENTS.map((a) => {
            const sys = statusOf(a.id);
            const cli = cliInfoOf(a.id);
            const active = a.id === agent;
            const disabled = sys === "unavailable" || sys === "unsupported";
            const bins = cliBinsLabel(cli?.bins ?? a.cliBins);
            return (
              <Stack
                key={a.id}
                component="button"
                type="button"
                aria-label={t("selectCliAgent", { agent: a.name })}
                aria-pressed={active}
                direction="row"
                spacing={1.25}
                onClick={() => choose(a.id)}
                sx={{
                  font: "inherit",
                  position: "relative",
                  minWidth: 0,
                  alignItems: "center",
                  p: 1.25,
                  textAlign: "left",
                  borderRadius: (t) => `${t.custom.radii.md}px`,
                  cursor: "pointer",
                  opacity: disabled ? 0.55 : 1,
                  border: (t) => `1px solid ${active ? withAlpha(a.accent, 0.5) : t.custom.borders.subtle}`,
                  backgroundColor: (t) => (active ? withAlpha(a.accent, 0.1) : t.custom.surfaces.s2),
                  transition: "transform 150ms ease, border-color 150ms ease, background-color 150ms ease",
                  "&:hover": { transform: "translateY(-1px)", borderColor: (t) => withAlpha(a.accent, 0.45) },
                  "&:focus-visible": {
                    outline: (t) => `2px solid ${t.custom.borders.focus}`,
                    outlineOffset: 2,
                  },
                }}
              >
                <AgentMonogram agent={a.id} size={32} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: "0.84rem", fontWeight: 600, color: "text.primary" }}>
                    {a.name}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
                    {t("agentCliCommand", { command: bins })}
                  </Typography>
                  <Typography noWrap title={cli?.resolvedBin ?? undefined} sx={{ fontSize: "0.68rem", color: "text.secondary" }}>
                    {cliDetailText(a.id)}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center", flex: "0 0 auto" }}>
                  <StatusDot status={agentStatusKey[sys]} label={agentStatus(sys)} size="sm" pulse={sys === "running"} />
                  {active && (
                    <Box
                      sx={{
                        width: 16,
                        height: 16,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        backgroundColor: a.accent,
                        animation: `${pop} 220ms ease both`,
                      }}
                    >
                      <CheckIcon sx={{ fontSize: 11 }} />
                    </Box>
                  )}
                </Stack>
              </Stack>
            );
          })}
        </Box>
      </Box>

      {def.variants.length > 1 && (
        <Box sx={{ px: 2.5, pt: 1, pb: 0.5 }}>
          <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
            {t("agentVariant", { agent: def.name })}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {def.variants.map((v) => {
              const on = v === variant;
              return (
                <Box
                  key={v}
                  onClick={() => setVariant(v)}
                  sx={{
                    px: 1.25,
                    py: 0.5,
                    borderRadius: (t) => `${t.custom.radii.pill}px`,
                    cursor: "pointer",
                    fontFamily: (t) => t.custom.fonts.mono,
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    color: (t) => (on ? t.palette.status.running.main : t.palette.text.secondary),
                    border: (t) => `1px solid ${on ? t.palette.status.running.border : t.custom.borders.subtle}`,
                    backgroundColor: (t) => (on ? t.palette.status.running.soft : t.custom.surfaces.s2),
                    transition: "all 140ms ease",
                  }}
                >
                  {v}
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}

      <DialogActions sx={{ px: 2.5, py: 2 }}>
        <Box sx={{ flex: 1 }}>
          {!canUse && (
            <Typography sx={{ fontSize: "0.74rem", color: (t) => t.palette.status.warn.main }}>
              {t(selectedStatus === "unsupported" ? "agentUnsupported" : "notInstalled", { agent: def.name })}
            </Typography>
          )}
        </Box>
        <Button variant="text" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button variant="contained" onClick={confirm} disabled={!canUse}>
          {t("useAgent", { agent: def.name })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
