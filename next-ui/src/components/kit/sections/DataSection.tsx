import { Box, CircularProgress, LinearProgress, Skeleton, Stack, Typography } from "@mui/material";
import { DataTable, Panel, StatusDot, Tag, Timeline, type DataColumn } from "../../ui";
import { type StatusKey } from "../../../theme/tokens";
import { KitSectionShell } from "../KitSectionShell";

interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly status: StatusKey;
  readonly latency: string;
}

const rows: readonly AgentRow[] = [
  { id: "a", name: "agent-delta", status: "running", latency: "42ms" },
  { id: "b", name: "agent-echo", status: "ok", latency: "31ms" },
  { id: "c", name: "agent-foxtrot", status: "error", latency: "—" },
];

const columns: ReadonlyArray<DataColumn<AgentRow>> = [
  { key: "name", header: "Agent", render: (row) => row.name },
  {
    key: "status",
    header: "Status",
    render: (row) => <Tag status={row.status} label={row.status} />,
  },
  { key: "latency", header: "Latency", align: "right", render: (row) => row.latency },
];

export function DataSection() {
  return (
    <KitSectionShell id="data" title="Data & State" description="Tables, timelines, progress, and loading states.">
      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <Panel title="Agents">
          <DataTable columns={columns} rows={rows} getRowKey={(row) => row.id} />
        </Panel>

        <Panel title="Timeline">
          <Timeline
            items={[
              { id: "1", status: "ok", time: "12:00", title: "Run started" },
              { id: "2", status: "running", time: "12:01", title: "Building", detail: "compiling 1,204 modules" },
              { id: "3", status: "warn", time: "12:05", title: "Slow upstream" },
              { id: "4", status: "idle", time: "—", title: "Deploy", detail: "waiting" },
            ]}
          />
        </Panel>

        <Panel title="Progress">
          <Stack spacing={2}>
            <LinearProgress variant="determinate" value={68} />
            <LinearProgress variant="determinate" value={32} color="warning" />
            <LinearProgress />
            <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
              <CircularProgress size={20} />
              <StatusDot status="running" label="Running" />
              <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.78rem", color: "text.secondary" }}>
                working…
              </Typography>
            </Stack>
            <Stack spacing={0.75}>
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="rounded" height={32} />
            </Stack>
          </Stack>
        </Panel>
      </Box>
    </KitSectionShell>
  );
}
