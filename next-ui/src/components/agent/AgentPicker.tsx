import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import { Alert, Box, Dialog, DialogActions, Divider, Stack, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { Button, IconButton, StatusDot, TagSelect } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { pop } from "./anim";
import {
  AGENTS,
  type AgentId,
  type AgentOption,
  type AgentProfile,
  type AgentWorkMode,
  agentStatusKey,
  defaultProfileForAgent,
  getAgent,
  normalizeAgentProfile,
  withAlpha,
} from "./agents";
import { useAgentCliInfo, useAgentStatus, useAgentStatusError, useAgentStatusLive, useReloadAgentStatus } from "./use-agent-status";

function cliBinsLabel(bins: readonly string[]): string {
  return bins.length > 0 ? bins.join(", ") : "unknown";
}

function liveOptionsOrCatalog(catalogOptions: readonly AgentOption[], liveOptions: readonly AgentOption[] | undefined): readonly AgentOption[] {
  if (!liveOptions?.length) {
    return catalogOptions;
  }
  const defaultOption = catalogOptions[0];
  if (!defaultOption || liveOptions.some((option) => option.id === defaultOption.id)) {
    return liveOptions;
  }
  return [defaultOption, ...liveOptions];
}

/** AgentPicker — a polished dialog for choosing the agent profile, showing
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
  const initialProfile = normalizeAgentProfile(value);
  const [agent, setAgent] = useState<AgentId>(initialProfile.agent);
  const [model, setModel] = useState<string>(initialProfile.model);
  const [reasoning, setReasoning] = useState<string>(initialProfile.reasoning);
  const [mode, setMode] = useState<AgentWorkMode>(initialProfile.mode);
  const [autoConfirm, setAutoConfirm] = useState<boolean>(initialProfile.autoConfirm ?? false);
  const statusOf = useAgentStatus();
  const cliInfoOf = useAgentCliInfo();
  const liveCliDetection = useAgentStatusLive();
  const detectionError = useAgentStatusError();
  const reloadAgentStatus = useReloadAgentStatus();
  const { t, agentStatus } = useI18n();

  const def = getAgent(agent);
  const selectedCli = cliInfoOf(agent);
  const selectedStatus = statusOf(agent);
  const modelOptions = liveOptionsOrCatalog(def.models, selectedCli?.models);
  const reasoningOptions = liveOptionsOrCatalog(def.reasoning, selectedCli?.reasoning);
  const canUse = selectedCli?.selectable ?? (selectedStatus !== "unavailable" && selectedStatus !== "unsupported");
  const titleId = "agent-picker-title";

  useEffect(() => {
    if (open) {
      const nextProfile = normalizeAgentProfile(value);
      setAgent(nextProfile.agent);
      setModel(nextProfile.model);
      setReasoning(nextProfile.reasoning);
      setMode(nextProfile.mode);
      setAutoConfirm(nextProfile.autoConfirm ?? false);
    }
  }, [open, value]);

  const choose = (id: AgentId) => {
    if (id === agent) {
      return;
    }
    const nextProfile = defaultProfileForAgent(id);
    setAgent(id);
    setModel(nextProfile.model);
    setReasoning(nextProfile.reasoning);
    setMode(nextProfile.mode);
    setAutoConfirm(nextProfile.autoConfirm ?? false);
  };

  const confirm = () => {
    onSelect(normalizeAgentProfile({ agent, model, reasoning, mode, autoConfirm }));
    onClose();
  };

  const cliDetailText = (id: AgentId): string => {
    const agentDef = getAgent(id);
    const sys = statusOf(id);
    const cli = cliInfoOf(id);
    const bins = cliBinsLabel(cli?.bins ?? agentDef.cliBins);
    if (cli?.modelDiscoveryError) {
      return cli.modelDiscoveryError;
    }
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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth aria-labelledby={titleId} slotProps={{ paper: { sx: { minWidth: { xs: 300, sm: 420 } } } }}>
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

      <Divider />

      <Box sx={{ px: 2.5, pt: 1.25, pb: 1, maxHeight: 360, overflow: "auto" }}>
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
                  "&:hover": { transform: "translateY(-1px)", borderColor: withAlpha(a.accent, 0.45) },
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

      <Divider />

      <AgentOptionGroup label={t("agentModel", { agent: def.name })} options={modelOptions} value={model} onSelect={setModel} />
      <AgentOptionGroup label={t("agentReasoning", { agent: def.name })} options={reasoningOptions} value={reasoning} onSelect={setReasoning} />

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

function AgentOptionGroup({
  label,
  options,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly options: readonly AgentOption[];
  readonly value: string;
  readonly onSelect: (value: string) => void;
}) {
  if (options.length <= 1) {
    return null;
  }
  return (
    <Box sx={{ px: 2.5, pt: 1, pb: 0.5 }}>
      <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
        {label}
      </Typography>
      <TagSelect value={value} options={options} onSelect={onSelect} ariaLabel={label} />
    </Box>
  );
}
