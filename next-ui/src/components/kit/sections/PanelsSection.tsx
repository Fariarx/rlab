import InboxIcon from "@mui/icons-material/Inbox";
import { Box, Stack, Typography } from "@mui/material";
import { Button, EmptyState, Metric, Panel, StatusDot } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function PanelsSection() {
  return (
    <KitSectionShell
      id="panels"
      title="Panels & Metrics"
      description="The standard surface chrome plus headline metrics and the idle 'no output' state."
    >
      <Box
        sx={{
          display: "grid",
          gap: 2.5,
          gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
        }}
      >
        <Panel
          title="Runtime"
          titleAdornment={<StatusDot status="running" label="Running" />}
          actions={<Button variant="subtle" size="small">refresh</Button>}
        >
          <Stack direction="row" spacing={4} sx={{ flexWrap: "wrap", gap: 3 }}>
            <Metric label="Throughput" value="68" unit="%" delta={{ value: "4.2", direction: "up" }} status="ok" />
            <Metric label="Latency" value="42" unit="ms" delta={{ value: "11", direction: "down" }} />
            <Metric label="Queue" value="7" status="warn" />
          </Stack>
        </Panel>

        <Panel title="Raised tone" tone="raised">
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            A panel one surface level brighter — use for nested or focused content.
          </Typography>
        </Panel>

        <Panel title="Dense" dense>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Tighter padding for compact lists and sidebars.
          </Typography>
        </Panel>

        <Panel title="Empty">
          <EmptyState
            icon={<InboxIcon />}
            title="No runs yet"
            description="Launch a run to see activity here."
            action={<Button variant="subtle" size="small">new run</Button>}
          />
        </Panel>
      </Box>
    </KitSectionShell>
  );
}
