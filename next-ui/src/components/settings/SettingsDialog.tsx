import CloseIcon from "@mui/icons-material/Close";
import ContrastIcon from "@mui/icons-material/Contrast";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import LightModeIcon from "@mui/icons-material/LightMode";
import OpenInBrowserIcon from "@mui/icons-material/OpenInBrowser";
import KeyboardVoiceIcon from "@mui/icons-material/KeyboardVoice";
import MicOffOutlinedIcon from "@mui/icons-material/MicOffOutlined";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import { Alert, Box, Chip, Dialog, Divider, Popover, Radio, Stack, Switch, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, type SxProps, type Theme } from "@mui/material";
import { observer } from "mobx-react-lite";
import { type ReactNode, useCallback, useState } from "react";
import { useI18n } from "../../i18n/I18nProvider";
import type { AppSettings, AppSettingsPatch, DensityMode, Locale, ThemeMode } from "../../lib/app-settings";
import { getVoiceProvider, VOICE_PROVIDERS, type VoiceProviderId } from "../../lib/voice-providers";
import {
  AGENTS,
  type AgentId,
  type AgentOption,
  type AgentProfile,
  AgentGlyph,
  agentStatusKey,
  useAgentStatus,
  useReloadAgentStatus,
} from "../agent";
import { Button, IconButton, StatusDot, TagSelect } from "../ui";
import { SettingsDialogStore } from "./settings-dialog-store";
import {
  agentOperationNoticeMessage,
  agentOperationNoticeSeverity,
  appearanceDensityPatch,
  appearanceReasoningAutoExpandPatch,
  appearanceReduceMotionPatch,
  appearanceShowTerminalPatch,
  appearanceThemePatch,
  defaultAgentProfileOptionSelection,
  defaultAgentProfileSelection,
  generalConfirmDestructiveActionsPatch,
  generalDesktopNotificationsPatch,
  generalLocalePatch,
  generalPreviewServerHostPatch,
  generalSystemPromptPatch,
  generalTelemetryPatch,
  generalVoiceLanguagePatch,
  generalVoiceProviderPatch,
  voiceProviderUiState,
} from "./settings-dialog-model";
import { ensureBrowserNotificationPermission } from "../workspace/workspace-page-helpers";
import { useAgentsSectionController } from "./use-agents-section-controller";
import { useBrowserPreviewSetupController } from "./use-browser-preview-setup-controller";
import { useVoiceSectionController } from "./use-voice-section-controller";

interface SettingsDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly settings: AppSettings;
  readonly onSettingsChange: (patch: AppSettingsPatch) => void;
  readonly onVoiceConfigChange?: () => void;
}

function SettingRow({ title, description, control }: { readonly title: string; readonly description: string; readonly control: ReactNode }) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={{ xs: 1, sm: 2 }}
      sx={{ alignItems: { xs: "stretch", sm: "center" }, justifyContent: "space-between", py: 1.25 }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: "0.86rem", fontWeight: 600, color: "text.primary" }}>{title}</Typography>
        <Typography sx={{ fontSize: "0.78rem", color: "text.secondary" }}>{description}</Typography>
      </Box>
      <Box sx={{ display: "flex", flex: "0 0 auto", justifyContent: { xs: "flex-start", sm: "flex-end" }, minWidth: 0, width: { xs: "100%", sm: "auto" } }}>
        {control}
      </Box>
    </Stack>
  );
}

const settingToggleGroupSx: SxProps<Theme> = {
  display: "flex",
  flexWrap: "wrap",
  gap: { xs: 0.5, sm: 0 },
  width: { xs: "100%", sm: "auto" },
  borderRadius: (theme) => ({ xs: `${theme.custom.radii.pill}px`, sm: undefined }),
  "& .MuiToggleButtonGroup-grouped": {
    flex: { xs: "1 1 auto", sm: "0 0 auto" },
    minWidth: 0,
    whiteSpace: "nowrap",
    borderLeft: (theme) => ({ xs: `1px solid ${theme.palette.divider}`, sm: undefined }),
    borderRadius: (theme) => ({ xs: `${theme.custom.radii.pill}px !important`, sm: undefined }),
  },
};

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

const AGENT_API_KEY_LABELS: Partial<Record<AgentId, string>> = {
  "claude-code": "Anthropic API key",
  codex: "OpenAI API key",
  gemini: "Google API key",
  amp: "AMP API key",
  qwen: "DashScope API key",
  droid: "Factory API key",
};

const ALPHA_AGENT_IDS = new Set<AgentId>(["gemini", "opencode"]);

function AlphaVersionChip({ label }: { readonly label: string }) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{
        flex: "0 0 auto",
        height: 20,
        borderRadius: (theme) => `${theme.custom.radii.pill}px`,
        border: (theme) => `1px solid ${theme.palette.status.warn.border}`,
        backgroundColor: (theme) => theme.palette.status.warn.soft,
        color: (theme) => theme.palette.status.warn.main,
        fontSize: "0.64rem",
        fontWeight: 700,
        "& .MuiChip-label": { px: 0.75 },
      }}
    />
  );
}

/** Install/repair the Playwright Chromium that powers the in-app Preview tab. */
const BrowserPreviewSetupRow = observer(function BrowserPreviewSetupRow() {
  const { t } = useI18n();
  const { store, installBrowser } = useBrowserPreviewSetupController();
  const { installed, installing, error } = store;

  const ready = installed === true;
  const statusLabel = installed === null ? t("browserPreviewChecking") : ready ? t("browserPreviewInstalled") : t("browserPreviewNotInstalled");

  return (
    <Stack
      spacing={1}
      sx={{
        p: 1.25,
        borderRadius: (theme) => `${theme.custom.radii.md}px`,
        border: (theme) => `1px solid ${theme.custom.borders.subtle}`,
        backgroundColor: (theme) => theme.custom.surfaces.s2,
      }}
    >
      <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
        <Box sx={{ display: "flex", color: "text.secondary", flex: "0 0 auto" }}>
          <OpenInBrowserIcon sx={{ fontSize: 26 }} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600, color: "text.primary" }}>
            {t("browserPreviewSetupTitle")}
          </Typography>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
            <StatusDot status={ready ? "ok" : "idle"} label={statusLabel} size="sm" pulse={false} />
            <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
              {statusLabel}
            </Typography>
          </Stack>
        </Box>
        {!ready && (
          <Button variant="subtle" size="small" aria-label={t("installBrowserPreview")} disabled={installing || installed === null} onClick={installBrowser}>
            {installing ? t("installingBrowserPreview") : t("install")}
          </Button>
        )}
      </Stack>
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {t("browserPreviewSetupDescription")}
      </Typography>
      {error && <Alert severity="error">{t("browserPreviewInstallFailed", { error })}</Alert>}
    </Stack>
  );
});

const AgentsSection = observer(function AgentsSection({
  defaultProfile,
  onDefaultProfileChange,
}: {
  readonly defaultProfile: AgentProfile;
  readonly onDefaultProfileChange: (profile: AgentProfile) => void;
}) {
  const statusOf = useAgentStatus();
  const reloadAgentStatus = useReloadAgentStatus();
  const { t, agentStatus } = useI18n();
  const { store, retryLoadConfig, saveApiKey, installAgent } = useAgentsSectionController(reloadAgentStatus);
  const {
    config,
    configError,
    draftKeys,
    setDraftKeys,
    savingKey,
    installing,
    operationNotice,
    keyPopover,
    setKeyPopover,
  } = store;

  const selectDefaultAgent = (agent: AgentId) => {
    onDefaultProfileChange(defaultAgentProfileSelection(defaultProfile, agent));
  };

  const selectDefaultProfileOption = (agent: AgentId, patch: Partial<Omit<AgentProfile, "agent">>) => {
    onDefaultProfileChange(defaultAgentProfileOptionSelection(defaultProfile, agent, patch));
  };

  const operationMessage = agentOperationNoticeMessage(operationNotice, t);

  return (
    <Stack spacing={1}>
      <Typography variant="body2" sx={{ color: "text.secondary", mb: 0.5 }}>
        {t("settingsAgentsHint")}
      </Typography>
      {configError && (
        <Alert
          severity="error"
          action={
            <Button size="small" variant="text" onClick={retryLoadConfig}>
              {t("retryAgentConfig")}
            </Button>
          }
        >
          {t("agentConfigError", { error: configError })}
        </Alert>
      )}
      {operationMessage && (
        <Alert severity={agentOperationNoticeSeverity(operationNotice)}>
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
                <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600, color: "text.primary" }}>
                    {a.name}
                  </Typography>
                  {ALPHA_AGENT_IDS.has(a.id) && <AlphaVersionChip label={t("alphaVersion")} />}
                </Stack>
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
              </Stack>
            )}
          </Stack>
        );
      })}

      <BrowserPreviewSetupRow />

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
});

function AppearanceSection({ settings, onSettingsChange }: Pick<SettingsDialogProps, "settings" | "onSettingsChange">) {
  const { t } = useI18n();
  const mode = settings.appearance.theme;
  const density = settings.appearance.density;
  const setTheme = (theme: ThemeMode) => onSettingsChange(appearanceThemePatch(theme));
  const setDensity = (nextDensity: DensityMode) => onSettingsChange(appearanceDensityPatch(nextDensity));
  return (
    <Stack divider={<Divider flexItem />}>
      <SettingRow
        title={t("theme")}
        description={t("themeDescription")}
        control={
          <ToggleButtonGroup
            exclusive
            value={mode}
            sx={settingToggleGroupSx}
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
            sx={settingToggleGroupSx}
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
        control={<Switch checked={settings.appearance.reduceMotion} onChange={(e) => onSettingsChange(appearanceReduceMotionPatch(e.target.checked))} />}
      />
      <SettingRow
        title={t("showTerminal")}
        description={t("showTerminalDescription")}
        control={<Switch checked={settings.appearance.showTerminal} onChange={(e) => onSettingsChange(appearanceShowTerminalPatch(e.target.checked))} />}
      />
      <SettingRow
        title={t("reasoningAutoExpand")}
        description={t("reasoningAutoExpandDescription")}
        control={<Switch checked={settings.appearance.reasoningAutoExpand} onChange={(e) => onSettingsChange(appearanceReasoningAutoExpandPatch(e.target.checked))} />}
      />
    </Stack>
  );
}

function GeneralSection({ settings, onSettingsChange }: Pick<SettingsDialogProps, "settings" | "onSettingsChange">) {
  const { t } = useI18n();
  const locale = settings.general.locale;
  const setLocale = (nextLocale: Locale) => onSettingsChange(generalLocalePatch(settings.general.voice, nextLocale));
  return (
    <Stack divider={<Divider flexItem />}>
      <SettingRow
        title={t("language")}
        description={t("languageDescription")}
        control={
          <ToggleButtonGroup
            exclusive
            value={locale}
            sx={settingToggleGroupSx}
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
      <SettingRow title={t("desktopNotifications")} description={t("desktopNotificationsDescription")} control={<Switch checked={settings.general.desktopNotifications} onChange={(e) => { if (e.target.checked) { ensureBrowserNotificationPermission(true); } onSettingsChange(generalDesktopNotificationsPatch(e.target.checked)); }} />} />
      <SettingRow title={t("confirmDestructive")} description={t("confirmDestructiveDescription")} control={<Switch checked={settings.general.confirmDestructiveActions} onChange={(e) => onSettingsChange(generalConfirmDestructiveActionsPatch(e.target.checked))} />} />
      <SettingRow title={t("telemetry")} description={t("telemetryDescription")} control={<Switch checked={settings.general.telemetry} onChange={(e) => onSettingsChange(generalTelemetryPatch(e.target.checked))} />} />
      <SettingRow
        title={t("previewServerHost")}
        description={t("previewServerHostDescription")}
        control={
          <TextField
            size="small"
            value={settings.general.previewServerHost}
            placeholder={t("previewServerHostPlaceholder")}
            onChange={(e) => onSettingsChange(generalPreviewServerHostPatch(e.target.value))}
            slotProps={{ htmlInput: { "aria-label": t("previewServerHost"), spellCheck: false, autoCapitalize: "none", autoCorrect: "off" } }}
            sx={{ width: { xs: "100%", sm: "auto" }, minWidth: { sm: 240 }, "& .MuiInputBase-root": { fontFamily: (th) => th.custom.fonts.mono, fontSize: "0.82rem" } }}
          />
        }
      />
    </Stack>
  );
}

function SystemPromptSection({ settings, onSettingsChange }: Pick<SettingsDialogProps, "settings" | "onSettingsChange">) {
  const { t } = useI18n();
  return (
    <Stack spacing={1.25}>
      <TextField
        fullWidth
        multiline
        minRows={9}
        maxRows={16}
        value={settings.general.systemPrompt}
        placeholder={t("systemPromptPlaceholder")}
        onChange={(event) => onSettingsChange(generalSystemPromptPatch(event.target.value))}
        slotProps={{ htmlInput: { "aria-label": t("systemPrompt"), spellCheck: true } }}
        sx={{
          "& .MuiInputBase-root": {
            alignItems: "flex-start",
            fontFamily: (theme) => theme.custom.fonts.mono,
            fontSize: "0.82rem",
            lineHeight: 1.55,
          },
        }}
      />
    </Stack>
  );
}

const VoiceSection = observer(function VoiceSection({ settings, onSettingsChange, onVoiceConfigChange }: Pick<SettingsDialogProps, "settings" | "onSettingsChange" | "onVoiceConfigChange">) {
  const { t } = useI18n();
  const successMessage = useCallback((providerName: string) => t("voiceApiKeySaved", { provider: providerName }), [t]);
  const failureMessage = useCallback((providerName: string, error: string) => t("voiceApiKeySaveFailed", { provider: providerName, error }), [t]);
  const { store, retryLoadConfig, saveApiKey } = useVoiceSectionController({
    onVoiceConfigChange,
    successMessage,
    failureMessage,
  });
  const {
    config,
    configError,
    draftKeys,
    setDraftKeys,
    savingKey,
    notice,
    keyPopover,
    setKeyPopover,
  } = store;

  const selectedProvider = settings.general.voice.provider;
  const setProvider = (provider: VoiceProviderId) => onSettingsChange(generalVoiceProviderPatch(settings.general.voice, provider));
  const setLanguage = (language: string) => onSettingsChange(generalVoiceLanguagePatch(settings.general.voice, language));

  return (
    <Stack spacing={1.25}>
      <TextField
        size="small"
        label={t("voiceLanguage")}
        value={settings.general.voice.language}
        onChange={(event) => setLanguage(event.target.value)}
        helperText={t("voiceLanguageHint")}
        slotProps={{ htmlInput: { "aria-label": t("voiceLanguage"), spellCheck: false, autoCapitalize: "none", autoCorrect: "off" } }}
        sx={{ maxWidth: 260, "& .MuiInputBase-root": { fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.82rem" } }}
      />
      <Typography variant="body2" sx={{ color: "text.secondary" }}>
        {t("voiceProvidersHint")}
      </Typography>
      {configError && (
        <Alert
          severity="error"
          action={
            <Button size="small" variant="text" onClick={retryLoadConfig}>
              {t("retryAgentConfig")}
            </Button>
          }
        >
          {t("voiceConfigError", { error: configError })}
        </Alert>
      )}
      {notice && <Alert severity={notice.severity}>{notice.message}</Alert>}
      {VOICE_PROVIDERS.map((provider) => {
        const providerState = voiceProviderUiState({ config, provider, selectedProvider, t });
        return (
          <Stack
            key={provider.id}
            direction="row"
            spacing={1.5}
            sx={{
              alignItems: "center",
              p: 1.25,
              borderRadius: (theme) => `${theme.custom.radii.md}px`,
              border: (theme) => `1px solid ${providerState.selected ? theme.palette.status.running.border : theme.custom.borders.subtle}`,
              backgroundColor: (theme) => (providerState.selected ? theme.palette.status.running.soft : theme.custom.surfaces.s2),
            }}
          >
            <Box sx={{ display: "flex", color: providerState.selected ? "primary.main" : "text.secondary", flex: "0 0 auto", px: { xs: 0, sm: 1.5 } }}>
              {provider.id === "none" ? (
                <MicOffOutlinedIcon data-testid="voice-provider-none-icon" sx={{ fontSize: 28 }} />
              ) : (
                <KeyboardVoiceIcon data-testid={`voice-provider-${provider.id}-icon`} sx={{ fontSize: 28 }} />
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center", minWidth: 0 }}>
                <Typography noWrap sx={{ fontSize: "0.85rem", fontWeight: 600, color: "text.primary" }}>
                  {provider.name}
                </Typography>
                {providerState.showAlpha && <AlphaVersionChip label={t("alphaVersion")} />}
              </Stack>
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                <StatusDot status={providerState.status} label={providerState.statusLabel} size="sm" pulse={false} />
                <Typography noWrap sx={{ fontFamily: (theme) => theme.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
                  {providerState.statusDetail}
                </Typography>
              </Stack>
              <Typography sx={{ mt: 0.25, fontSize: "0.72rem", color: "text.secondary" }}>{provider.languageHint}</Typography>
            </Box>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", flex: "0 0 auto" }}>
              {providerState.showApiKey && (
                <Tooltip title={providerState.configured ? t("apiKeyConfigured", { agent: provider.name }) : t("apiKey")}>
                  <IconButton
                    aria-label={t("voiceApiKeyFor", { provider: provider.name })}
                    onClick={(event) => setKeyPopover({ id: provider.id, anchor: event.currentTarget })}
                    sx={providerState.configured ? { color: (theme) => theme.palette.status.ok.main } : undefined}
                  >
                    <VpnKeyOutlinedIcon sx={{ fontSize: 17 }} />
                  </IconButton>
                </Tooltip>
              )}
              <Radio checked={providerState.selected} onChange={() => setProvider(provider.id)} size="small" aria-label={t("voiceMakeProvider", { provider: provider.name })} />
            </Stack>
          </Stack>
        );
      })}

      <Popover
        open={Boolean(keyPopover)}
        anchorEl={keyPopover?.anchor ?? null}
        onClose={() => setKeyPopover(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { mt: 0.5, borderRadius: (theme) => `${theme.custom.radii.md}px`, border: (theme) => `1px solid ${theme.custom.borders.subtle}`, backgroundImage: "none" } } }}
      >
        {keyPopover &&
          (() => {
            const provider = getVoiceProvider(keyPopover.id);
            return (
              <Stack spacing={1.25} sx={{ p: 2, width: 320 }}>
                <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: "text.primary" }}>{provider.name}</Typography>
                <TextField
                  fullWidth
                  autoFocus
                  type="password"
                  size="small"
                  label={provider.envVar ?? t("apiKey")}
                  value={draftKeys[keyPopover.id] ?? ""}
                  placeholder={config.providers[keyPopover.id]?.configured ? t("configured") : undefined}
                  onChange={(event) => setDraftKeys((current) => ({ ...current, [keyPopover.id]: event.target.value }))}
                />
                <Typography sx={{ fontSize: "0.72rem", color: "text.secondary" }}>{t("voiceApiKeyHint", { env: provider.envVar ?? "" })}</Typography>
                <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
                  <Button variant="text" size="small" onClick={() => setKeyPopover(null)}>
                    {t("cancel")}
                  </Button>
                  <Button
                    variant="contained"
                    size="small"
                    disabled={savingKey === keyPopover.id || !(draftKeys[keyPopover.id]?.trim())}
                    onClick={() => saveApiKey(keyPopover.id)}
                  >
                    {t("save")}
                  </Button>
                </Stack>
              </Stack>
            );
          })()}
      </Popover>
    </Stack>
  );
});

export const SettingsDialog = observer(function SettingsDialog({ open, onClose, settings, onSettingsChange, onVoiceConfigChange }: SettingsDialogProps) {
  const [store] = useState(() => new SettingsDialogStore());
  const { tab, setTab } = store;
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
          <Tab label={t("voice")} />
          <Tab label={t("appearance")} />
          <Tab label={t("general")} />
          <Tab label={t("systemPrompt")} />
        </Tabs>
      </Box>

      <Box sx={{ px: 2.5, py: 2, minHeight: 280, maxHeight: 440, overflow: "auto" }}>
        {tab === 0 && (
          <AgentsSection
            defaultProfile={settings.agents.defaultProfile}
            onDefaultProfileChange={(defaultProfile) => onSettingsChange({ agents: { defaultProfile } })}
          />
        )}
        {tab === 1 && <VoiceSection settings={settings} onSettingsChange={onSettingsChange} onVoiceConfigChange={onVoiceConfigChange} />}
        {tab === 2 && <AppearanceSection settings={settings} onSettingsChange={onSettingsChange} />}
        {tab === 3 && <GeneralSection settings={settings} onSettingsChange={onSettingsChange} />}
        {tab === 4 && <SystemPromptSection settings={settings} onSettingsChange={onSettingsChange} />}
      </Box>
    </Dialog>
  );
});
