import CloseIcon from "@mui/icons-material/Close";
import ContrastIcon from "@mui/icons-material/Contrast";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import { Alert, Box, Dialog, Divider, Popover, Radio, Stack, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { type ReactNode, useEffect, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import { type AgentAccessMode, type AppSettings, type AppSettingsPatch, type DensityMode, type Locale, type ThemeMode } from "../workspace/app-settings";
import {
  AGENTS,
  type AgentDef,
  type AgentId,
  type AgentOption,
  type AgentProfile,
  AgentGlyph,
  agentStatusKey,
  defaultProfileForAgent,
  normalizeAgentProfile,
  useAgentStatus,
  useReloadAgentStatus,
} from "../agent";
import { Button, IconButton, StatusDot, TagSelect } from "../ui";

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly settings: AppSettings;
  readonly onSettingsChange: (patch: AppSettingsPatch) => void;
}

function SettingRow({ title, description, control }: { readonly title: string; readonly description: string; readonly control: ReactNode }) {
  return (
    <Stack direction="row" spacing={2} sx={{ alignItems: "center", justifyContent: "space-between", py: 1.25 }}>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.86rem", fontWeight: 600, color: "text.primary" }}>{title}</Typography>
        <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>{description}</Typography>
      </Box>
      <Box sx={{ flex: "0 0 auto" }}>{control}</Box>
    </Stack>
  );
}

function ProfileToggleRow({
  label,
  ariaLabel,
  options,
  value,
  onSelect,
}: {
  readonly label: string;
  readonly ariaLabel: string;
  readonly options: readonly AgentOption[];
  readonly value: string;
  readonly onSelect: (value: string) => void;
}) {
  if (options.length <= 1) {
    return null;
  }
  return (
    <Box>
      <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
        {label}
      </Typography>
      <TagSelect value={value} options={options} onSelect={onSelect} ariaLabel={ariaLabel} />
    </Box>
  );
}

interface AgentConfigInfo {
  readonly envVar: string;
  readonly configured: boolean;
}

interface AgentConfigResponse {
  readonly agents: Partial<Record<AgentId, AgentConfigInfo>>;
}

type AgentOperationNotice =
  | {
      readonly type: "install-started";
      readonly agent: string;
      readonly command: string;
    }
  | {
      readonly type: "install-failed";
      readonly agent: string;
      readonly error: string;
    }
  | {
      readonly type: "api-key-save-failed";
      readonly agent: string;
      readonly error: string;
    }
  | {
      readonly type: "api-key-saved";
      readonly agent: string;
    };

const AGENT_API_KEY_LABELS: Partial<Record<AgentId, string>> = {
  "claude-code": "Anthropic API key",
  codex: "OpenAI API key",
  gemini: "Google API key",
  amp: "AMP API key",
  qwen: "DashScope API key",
  droid: "Factory API key",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentConfigResponse(value: unknown): value is AgentConfigResponse {
  return isRecord(value) && isRecord(value.agents);
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as unknown;
    if (isRecord(payload) && typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // The status code fallback below is the explicit error when the server did not return JSON.
  }
  return fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function AgentsSection({
  accessMode,
  defaultProfile,
  onAccessModeChange,
  onDefaultProfileChange,
}: {
  readonly accessMode: AgentAccessMode;
  readonly defaultProfile: AgentProfile;
  readonly onAccessModeChange: (mode: AgentAccessMode) => void;
  readonly onDefaultProfileChange: (profile: AgentProfile) => void;
}) {
  const statusOf = useAgentStatus();
  const reloadAgentStatus = useReloadAgentStatus();
  const { t, agentStatus } = useI18n();
  const [config, setConfig] = useState<AgentConfigResponse>({ agents: {} });
  const [configReloadToken, setConfigReloadToken] = useState(0);
  const [configError, setConfigError] = useState<string | null>(null);
  const [draftKeys, setDraftKeys] = useState<Partial<Record<AgentId, string>>>({});
  const [savingKey, setSavingKey] = useState<AgentId | null>(null);
  const [installing, setInstalling] = useState<AgentId | null>(null);
  const [operationNotice, setOperationNotice] = useState<AgentOperationNotice | null>(null);
  const [keyPopover, setKeyPopover] = useState<{ readonly id: AgentId; readonly anchor: HTMLElement } | null>(null);

  useEffect(() => {
    let active = true;

    async function loadConfig(): Promise<void> {
      setConfigError(null);
      try {
        const response = await fetch("/api/agent-config");
        if (!response.ok) {
          throw new Error(await readResponseError(response, `Agent config load failed (${response.status})`));
        }
        const payload = (await response.json()) as unknown;
        if (!isAgentConfigResponse(payload)) {
          throw new Error("Agent config response is invalid.");
        }
        if (active) {
          setConfig(payload);
        }
      } catch (error) {
        if (active) {
          setConfigError(errorMessage(error));
        }
      }
    }

    void loadConfig();
    return () => {
      active = false;
    };
  }, [configReloadToken]);

  const saveApiKey = (agent: AgentDef) => {
    const apiKey = draftKeys[agent.id]?.trim();
    if (!apiKey) {
      return;
    }
    setSavingKey(agent.id);
    setOperationNotice(null);
    void (async () => {
      try {
        const response = await fetch("/api/agent-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: agent.id, apiKey }),
        });
        if (!response.ok) {
          throw new Error(await readResponseError(response, `Agent config save failed (${response.status})`));
        }
        setConfig((current) => ({
          agents: {
            ...current.agents,
            [agent.id]: {
              envVar: current.agents[agent.id]?.envVar ?? "",
              configured: true,
            },
          },
        }));
        setDraftKeys((current) => ({ ...current, [agent.id]: "" }));
        setOperationNotice({ type: "api-key-saved", agent: agent.name });
        reloadAgentStatus();
      } catch (error) {
        setOperationNotice({ type: "api-key-save-failed", agent: agent.name, error: errorMessage(error) });
      } finally {
        setSavingKey(null);
      }
    })();
  };

  const installAgent = (agent: AgentDef) => {
    setInstalling(agent.id);
    setOperationNotice(null);
    void (async () => {
      try {
        const response = await fetch("/api/agent-install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent: agent.id }),
        });
        if (!response.ok) {
          throw new Error(await readResponseError(response, `Agent install failed (${response.status})`));
        }
        const payload = (await response.json()) as unknown;
        if (!isRecord(payload) || typeof payload.command !== "string" || !payload.command.trim()) {
          throw new Error("Agent install response did not include command.");
        }
        setOperationNotice({ type: "install-started", agent: agent.name, command: payload.command });
        reloadAgentStatus();
      } catch (error) {
        setOperationNotice({ type: "install-failed", agent: agent.name, error: errorMessage(error) });
      } finally {
        setInstalling(null);
      }
    })();
  };

  const selectDefaultAgent = (agent: AgentId) => {
    onDefaultProfileChange(defaultProfile.agent === agent ? normalizeAgentProfile(defaultProfile) : defaultProfileForAgent(agent));
  };

  const selectDefaultProfileOption = (agent: AgentId, patch: Partial<Omit<AgentProfile, "agent">>) => {
    onDefaultProfileChange(normalizeAgentProfile({ ...defaultProfile, agent, ...patch }, agent));
  };

  const operationMessage =
    operationNotice?.type === "install-started"
      ? t("agentInstallStarted", { agent: operationNotice.agent, command: operationNotice.command })
      : operationNotice?.type === "install-failed"
        ? t("agentInstallFailed", { agent: operationNotice.agent, error: operationNotice.error })
        : operationNotice?.type === "api-key-save-failed"
          ? t("agentApiKeySaveFailed", { agent: operationNotice.agent, error: operationNotice.error })
          : operationNotice?.type === "api-key-saved"
            ? t("apiKeySaved", { agent: operationNotice.agent })
          : null;

  return (
    <Stack spacing={1}>
      <SettingRow
        title={t("agentAccessMode")}
        description={t("agentAccessModeDescription")}
        control={
          <TagSelect
            value={accessMode}
            ariaLabel={t("agentAccessMode")}
            options={[
              { id: "read-only", label: t("agentReadOnly") },
              { id: "unrestricted", label: t("agentUnrestricted") },
            ]}
            onSelect={(next) => {
              if (next !== accessMode) {
                onAccessModeChange(next as AgentAccessMode);
              }
            }}
          />
        }
      />
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 0.5 }}>
        {t("settingsAgentsHint")}
      </Typography>
      {configError && (
        <Alert
          severity="error"
          action={
            <Button size="small" variant="text" onClick={() => setConfigReloadToken((current) => current + 1)}>
              {t("retryAgentConfig")}
            </Button>
          }
        >
          {t("agentConfigError", { error: configError })}
        </Alert>
      )}
      {operationMessage && (
        <Alert severity={operationNotice?.type === "install-started" ? "info" : operationNotice?.type === "api-key-saved" ? "success" : "error"}>
          {operationMessage}
        </Alert>
      )}
      {AGENTS.map((a) => {
        const sys = statusOf(a.id);
        const installable = sys === "unavailable";
        const blocked = sys === "unsupported";
        const selectedDefault = defaultProfile.agent === a.id;
        return (
          <Stack
            key={a.id}
            spacing={1.5}
            sx={{
              p: 1.25,
              borderRadius: (t) => `${t.custom.radii.md}px`,
              border: (t) => `1px solid ${t.custom.borders.subtle}`,
              backgroundColor: (t) => t.custom.surfaces.s2,
              opacity: installable || blocked ? 0.6 : 1,
            }}
          >
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <AgentGlyph agent={a.id} size={30} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600, color: "text.primary" }}>
                  {a.name}
                </Typography>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                  <StatusDot status={agentStatusKey[sys]} label={agentStatus(sys)} size="sm" pulse={sys === "running"} />
                  <Typography noWrap sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
                    {agentStatus(sys)}
                  </Typography>
                </Stack>
              </Box>

              <Stack direction="row" spacing={0.5} sx={{ flex: "0 0 auto", alignItems: "center" }}>
                {AGENT_API_KEY_LABELS[a.id] && !blocked && (
                  <Tooltip title={config.agents[a.id]?.configured ? t("apiKeyConfigured", { agent: a.name }) : t("apiKey")}>
                    <IconButton
                      aria-label={t("apiKeyFor", { agent: a.name })}
                      onClick={(event) => setKeyPopover({ id: a.id, anchor: event.currentTarget })}
                      sx={config.agents[a.id]?.configured ? { color: (theme) => theme.palette.status.ok.main } : undefined}
                    >
                      <VpnKeyOutlinedIcon sx={{ fontSize: 17 }} />
                    </IconButton>
                  </Tooltip>
                )}
                {installable ? (
                  <Button variant="subtle" size="small" aria-label={t("installAgent", { agent: a.name })} disabled={installing === a.id} onClick={() => installAgent(a)}>
                    {installing === a.id ? t("installingAgent", { agent: a.name }) : t("install")}
                  </Button>
                ) : blocked ? (
                  <Typography sx={{ maxWidth: 200, fontSize: "0.74rem", textAlign: "right", color: (theme) => theme.palette.status.warn.main }}>
                    {t("agentUnsupported", { agent: a.name })}
                  </Typography>
                ) : (
                  <>
                    <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.68rem", color: "text.secondary" }}>
                      {t("defaultLabel")}
                    </Typography>
                    <Radio
                      checked={selectedDefault}
                      onChange={() => selectDefaultAgent(a.id)}
                      size="small"
                      aria-label={t("makeDefaultAgent", { agent: a.name })}
                    />
                  </>
                )}
              </Stack>
            </Stack>

            {selectedDefault && !installable && !blocked && (
              <Stack spacing={1} sx={{ pl: { sm: 5.75 } }}>
                <ProfileToggleRow
                  label={t("defaultModel")}
                  ariaLabel={t("defaultModelFor", { agent: a.name })}
                  options={a.models}
                  value={defaultProfile.model}
                  onSelect={(model) => selectDefaultProfileOption(a.id, { model })}
                />
                <ProfileToggleRow
                  label={t("defaultReasoning")}
                  ariaLabel={t("defaultReasoningFor", { agent: a.name })}
                  options={a.reasoning}
                  value={defaultProfile.reasoning}
                  onSelect={(reasoning) => selectDefaultProfileOption(a.id, { reasoning })}
                />
                <ProfileToggleRow
                  label={t("defaultWorkMode")}
                  ariaLabel={t("defaultWorkModeFor", { agent: a.name })}
                  options={a.modes}
                  value={defaultProfile.mode}
                  onSelect={(mode) => selectDefaultProfileOption(a.id, { mode: mode === "plan" ? "plan" : "default" })}
                />
              </Stack>
            )}
          </Stack>
        );
      })}

      <Popover
        open={Boolean(keyPopover)}
        anchorEl={keyPopover?.anchor ?? null}
        onClose={() => setKeyPopover(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 0.5, borderRadius: (t) => `${t.custom.radii.md}px`, border: (t) => `1px solid ${t.custom.borders.subtle}`, backgroundImage: "none" } } }}
      >
        {keyPopover &&
          (() => {
            const agentDef = AGENTS.find((item) => item.id === keyPopover.id);
            if (!agentDef) {
              return null;
            }
            return (
              <Stack spacing={1.25} sx={{ p: 2, width: 320 }}>
                <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: "text.primary" }}>{AGENT_API_KEY_LABELS[keyPopover.id]}</Typography>
                <TextField
                  fullWidth
                  autoFocus
                  type="password"
                  size="small"
                  label={AGENT_API_KEY_LABELS[keyPopover.id]}
                  value={draftKeys[keyPopover.id] ?? ""}
                  placeholder={config.agents[keyPopover.id]?.configured ? t("configured") : undefined}
                  onChange={(event) => setDraftKeys((current) => ({ ...current, [keyPopover.id]: event.target.value }))}
                />
                <Typography sx={{ fontSize: "0.72rem", color: "text.secondary" }}>{t("apiKeyOptionalHint")}</Typography>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                  <Button variant="text" size="small" onClick={() => setKeyPopover(null)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={savingKey === keyPopover.id || !(draftKeys[keyPopover.id]?.trim())}
                    onClick={() => saveApiKey(agentDef)}
                  >
                    {t("saveApiKeyFor", { agent: agentDef.name })}
                  </Button>
                </Stack>
              </Stack>
            );
          })()}
      </Popover>
    </Stack>
  );
}

function AppearanceSection({ settings, onSettingsChange }: Pick<SettingsDialogProps, "settings" | "onSettingsChange">) {
  const { t } = useI18n();
  const mode = settings.appearance.theme;
  const density = settings.appearance.density;
  const setTheme = (theme: ThemeMode) => onSettingsChange({ appearance: { theme } });
  const setDensity = (nextDensity: DensityMode) => onSettingsChange({ appearance: { density: nextDensity } });
  return (
    <Stack divider={<Divider flexItem />}>
      <SettingRow
        title={t("theme")}
        description={t("themeDescription")}
        control={
          <ToggleButtonGroup
            exclusive
            value={mode}
            onChange={(_, next: ThemeMode | null) => {
              if (next && next !== mode) {
                setTheme(next);
              }
            }}
          >
            <ToggleButton value="dark">
              <DarkModeIcon sx={{ fontSize: 15, mr: 0.75 }} /> {t("dark")}
            </ToggleButton>
            <ToggleButton value="light">
              <LightModeIcon sx={{ fontSize: 15, mr: 0.75 }} /> {t("light")}
            </ToggleButton>
            <ToggleButton value="high-contrast">
              <ContrastIcon sx={{ fontSize: 15, mr: 0.75 }} /> {t("highContrast")}
            </ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <SettingRow
        title={t("density")}
        description={t("densityDescription")}
        control={
          <ToggleButtonGroup
            exclusive
            value={density}
            onChange={(_, next: DensityMode | null) => {
              if (next && next !== density) {
                setDensity(next);
              }
            }}
          >
            <ToggleButton value="comfortable">{t("comfortable")}</ToggleButton>
            <ToggleButton value="compact">{t("compact")}</ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <SettingRow
        title={t("reduceMotion")}
        description={t("reduceMotionDescription")}
        control={<Switch checked={settings.appearance.reduceMotion} onChange={(e) => onSettingsChange({ appearance: { reduceMotion: e.target.checked } })} />}
      />
    </Stack>
  );
}

function GeneralSection({ settings, onSettingsChange }: Pick<SettingsDialogProps, "settings" | "onSettingsChange">) {
  const { t } = useI18n();
  const locale = settings.general.locale;
  const setLocale = (nextLocale: Locale) => onSettingsChange({ general: { locale: nextLocale } });
  return (
    <Stack divider={<Divider flexItem />}>
      <SettingRow
        title={t("language")}
        description={t("languageDescription")}
        control={
          <ToggleButtonGroup
            exclusive
            value={locale}
            onChange={(_, next: Locale | null) => {
              if (next && next !== locale) {
                setLocale(next);
              }
            }}
          >
            <ToggleButton value="ru">{t("russian")}</ToggleButton>
            <ToggleButton value="en">{t("english")}</ToggleButton>
          </ToggleButtonGroup>
        }
      />
      <SettingRow title={t("desktopNotifications")} description={t("desktopNotificationsDescription")} control={<Switch checked={settings.general.desktopNotifications} onChange={(e) => onSettingsChange({ general: { desktopNotifications: e.target.checked } })} />} />
      <SettingRow title={t("confirmDestructive")} description={t("confirmDestructiveDescription")} control={<Switch checked={settings.general.confirmDestructiveActions} onChange={(e) => onSettingsChange({ general: { confirmDestructiveActions: e.target.checked } })} />} />
      <SettingRow title={t("telemetry")} description={t("telemetryDescription")} control={<Switch checked={settings.general.telemetry} onChange={(e) => onSettingsChange({ general: { telemetry: e.target.checked } })} />} />
    </Stack>
  );
}

export function SettingsDialog({ open, onClose, settings, onSettingsChange }: SettingsDialogProps) {
  const [tab, setTab] = useState(0);
  const { t } = useI18n();
  const titleId = "settings-dialog-title";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth aria-labelledby={titleId}>
      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between", px: 2.5, pt: 2 }}>
        <Typography id={titleId} component="h2" sx={{ fontSize: "1rem", fontWeight: 700, color: "text.primary" }}>{t("settings")}</Typography>
        <IconButton aria-label={t("cancel")} onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      <Box sx={{ px: 2.5 }}>
        <Tabs value={tab} onChange={(_, v: number) => setTab(v)}>
          <Tab label={t("agent")} />
          <Tab label={t("appearance")} />
          <Tab label={t("general")} />
        </Tabs>
      </Box>

      <Box sx={{ px: 2.5, py: 2, minHeight: 280, maxHeight: 440, overflow: "auto" }}>
        {tab === 0 && (
          <AgentsSection
            accessMode={settings.agents.accessMode}
            defaultProfile={settings.agents.defaultProfile}
            onAccessModeChange={(accessMode) => onSettingsChange({ agents: { accessMode } })}
            onDefaultProfileChange={(defaultProfile) => onSettingsChange({ agents: { defaultProfile } })}
          />
        )}
        {tab === 1 && <AppearanceSection settings={settings} onSettingsChange={onSettingsChange} />}
        {tab === 2 && <GeneralSection settings={settings} onSettingsChange={onSettingsChange} />}
      </Box>
    </Dialog>
  );
}
