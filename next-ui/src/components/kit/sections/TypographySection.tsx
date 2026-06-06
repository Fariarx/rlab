import { Stack, Typography } from "@mui/material";
import { Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function TypographySection() {
  return (
    <KitSectionShell
      id="typography"
      title="Typography"
      description="Inter for prose, JetBrains Mono for everything technical — labels, code, status, metrics."
    >
      <Stack spacing={2.5}>
        <Panel title="Scale">
          <Stack spacing={1.5}>
            <Typography variant="h1">Control Center</Typography>
            <Typography variant="h2">Release runs &amp; agent handoffs</Typography>
            <Typography variant="body1">
              Body copy uses Inter. The interface stays calm so the monospace accents read clearly.
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              Secondary body — muted, for supporting detail.
            </Typography>
            <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
              Micro label · tracked-out mono
            </Typography>
          </Stack>
        </Panel>

        <Panel title="Monospace">
          <Stack spacing={1}>
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.9rem" }}>
              const run = await rlab.runs.create(&#123; agent: "delta" &#125;)
            </Typography>
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.9rem", color: "text.secondary" }}>
              0O 1lI |&gt; =&gt; != &amp;&amp; ?? ::: AGENT · RUNNING · 42ms
            </Typography>
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
