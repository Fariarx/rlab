import SearchIcon from "@mui/icons-material/Search";
import { InputAdornment, MenuItem, Stack, TextField } from "@mui/material";
import { Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function InputsSection() {
  return (
    <KitSectionShell id="inputs" title="Inputs & Forms" description="Text fields, search, and select — quiet by default.">
      <Stack spacing={2.5}>
        <Panel title="Search">
          <TextField
            placeholder="Filter agents, runs, logs…"
            size="small"
            fullWidth
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  </InputAdornment>
                ),
              },
            }}
          />
        </Panel>

        <Panel title="Fields">
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
            <TextField label="Agent" defaultValue="delta" size="small" />
            <TextField label="Environment" defaultValue="staging" size="small" select sx={{ minWidth: 160 }}>
              <MenuItem value="staging">staging</MenuItem>
              <MenuItem value="production">production</MenuItem>
            </TextField>
            <TextField label="Disabled" defaultValue="locked" size="small" disabled />
            <TextField label="Error" defaultValue="bad-value" size="small" error helperText="invalid" />
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
