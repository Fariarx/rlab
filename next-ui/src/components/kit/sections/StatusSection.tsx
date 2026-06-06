import { Stack, Typography } from "@mui/material";
import { KeyHint, Panel, StatusDot, Tag } from "../../ui";
import { type StatusKey } from "../../../theme/tokens";
import { KitSectionShell } from "../KitSectionShell";

const statuses: ReadonlyArray<{ readonly key: StatusKey; readonly label: string }> = [
  { key: "running", label: "Running" },
  { key: "ok", label: "Healthy" },
  { key: "warn", label: "Degraded" },
  { key: "error", label: "Failed" },
  { key: "idle", label: "Idle" },
  { key: "info", label: "Info" },
];

export function StatusSection() {
  return (
    <KitSectionShell
      id="status"
      title="Status & Tags"
      description="Status dots (running pulses), status-tinted tags, and key hints."
    >
      <Stack spacing={2.5}>
        <Panel title="Status dots">
          <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap", gap: 2.5 }}>
            {statuses.map(({ key, label }) => (
              <Stack key={key} direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <StatusDot status={key} label={label} />
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem" }}>{label}</Typography>
              </Stack>
            ))}
          </Stack>
        </Panel>

        <Panel title="Tags">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {statuses.map(({ key }) => (
                <Tag key={key} status={key} label={key} />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
              {statuses.map(({ key }) => (
                <Tag key={key} status={key} tone="outline" label={key} />
              ))}
              <Tag label="neutral" />
            </Stack>
          </Stack>
        </Panel>

        <Panel title="Key hints">
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2, alignItems: "center" }}>
            <KeyHint keys="⌘ K" />
            <KeyHint keys={["⌘", "K"]} separator="+" />
            <KeyHint keys={["Ctrl", "C"]} separator="-" />
            <KeyHint keys="⏎" />
            <KeyHint keys="Esc" />
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
