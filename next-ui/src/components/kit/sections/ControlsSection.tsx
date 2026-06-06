import DeleteIcon from "@mui/icons-material/Delete";
import RefreshIcon from "@mui/icons-material/Refresh";
import SettingsIcon from "@mui/icons-material/Settings";
import StarIcon from "@mui/icons-material/StarBorder";
import { useState } from "react";
import {
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  Panel,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function ControlsSection() {
  const [view, setView] = useState("list");
  const [env, setEnv] = useState("staging");

  return (
    <KitSectionShell
      id="controls"
      title="Controls"
      description="Checkboxes, switches, radios, icon buttons, segmented toggles, and sliders."
    >
      <Box sx={{ display: "grid", gap: 2.5, gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" } }}>
        <Panel title="Toggles">
          <Stack spacing={1}>
            <FormControlLabel control={<Checkbox defaultChecked />} label="Watch run" />
            <FormControlLabel control={<Checkbox indeterminate />} label="Partial selection" />
            <FormControlLabel control={<Checkbox />} label="Notify on failure" />
            <FormControlLabel control={<Checkbox disabled />} label="Disabled" />
          </Stack>
        </Panel>

        <Panel title="Switches">
          <Stack spacing={1}>
            <FormControlLabel control={<Switch defaultChecked />} label="Auto-retry" />
            <FormControlLabel control={<Switch />} label="Verbose logs" />
            <FormControlLabel control={<Switch disabled />} label="Disabled" />
          </Stack>
        </Panel>

        <Panel title="Radio">
          <RadioGroup value={env} onChange={(_, value) => setEnv(value)}>
            <FormControlLabel value="staging" control={<Radio />} label="Staging" />
            <FormControlLabel value="production" control={<Radio />} label="Production" />
            <FormControlLabel value="local" control={<Radio />} label="Local" disabled />
          </RadioGroup>
        </Panel>

        <Panel title="Icon buttons">
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <IconButton aria-label="Settings">
                <SettingsIcon fontSize="small" />
              </IconButton>
              <IconButton tone="subtle" aria-label="Refresh">
                <RefreshIcon fontSize="small" />
              </IconButton>
              <IconButton tone="subtle" aria-label="Favorite">
                <StarIcon fontSize="small" />
              </IconButton>
              <IconButton tone="danger" aria-label="Delete">
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Stack>
            <Typography variant="microLabel" sx={{ color: "text.secondary" }}>
              default · subtle · danger
            </Typography>
          </Stack>
        </Panel>

        <Panel title="Segmented">
          <ToggleButtonGroup
            exclusive
            value={view}
            onChange={(_, value: string | null) => value != null && setView(value)}
          >
            <ToggleButton value="list">list</ToggleButton>
            <ToggleButton value="board">board</ToggleButton>
            <ToggleButton value="graph">graph</ToggleButton>
          </ToggleButtonGroup>
        </Panel>

        <Panel title="Slider">
          <Box sx={{ px: 1, pt: 1 }}>
            <Slider defaultValue={64} valueLabelDisplay="auto" />
            <Slider defaultValue={[20, 70]} valueLabelDisplay="auto" />
          </Box>
        </Panel>
      </Box>
    </KitSectionShell>
  );
}
