import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import RefreshIcon from "@mui/icons-material/Refresh";
import { Stack } from "@mui/material";
import { Button, Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function ButtonsSection() {
  return (
    <KitSectionShell id="buttons" title="Buttons" description="Standard MUI variants plus a mono `subtle` secondary variant.">
      <Panel title="Variants">
        <Stack spacing={2}>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <Button variant="contained" startIcon={<PlayArrowIcon />}>
              Launch run
            </Button>
            <Button variant="outlined">Outlined</Button>
            <Button variant="text">Text</Button>
            <Button variant="subtle" startIcon={<RefreshIcon />}>
              Subtle
            </Button>
            <Button variant="contained" color="error">
              Abort
            </Button>
          </Stack>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <Button variant="contained" size="small">
              Small
            </Button>
            <Button variant="subtle" size="small">
              Subtle sm
            </Button>
            <Button variant="contained" disabled>
              Disabled
            </Button>
            <Button variant="subtle" disabled>
              Subtle off
            </Button>
          </Stack>
        </Stack>
      </Panel>
    </KitSectionShell>
  );
}
