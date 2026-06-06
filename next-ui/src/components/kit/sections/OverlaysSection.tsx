import { useState, type MouseEvent } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Menu,
  MenuItem,
  Panel,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  useToast,
} from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

export function OverlaysSection() {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [anchor, setAnchor] = useState<null | HTMLElement>(null);
  const [tab, setTab] = useState(0);

  const openMenu = (event: MouseEvent<HTMLButtonElement>) => setAnchor(event.currentTarget);
  const closeMenu = () => setAnchor(null);

  return (
    <KitSectionShell
      id="overlays"
      title="Overlays & Navigation"
      description="Dialogs, menus, tooltips, tabs, and queued toasts — themed to match the surface."
    >
      <Stack spacing={2.5}>
        <Panel title="Triggers">
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <Button variant="subtle" onClick={() => setDialogOpen(true)}>
              open dialog
            </Button>
            <Button variant="subtle" onClick={openMenu}>
              open menu
            </Button>
            <Tooltip title="Runs the active agent">
              <Button variant="subtle">hover me</Button>
            </Tooltip>
            <Button variant="subtle" onClick={() => toast({ message: "Run queued · agent delta", severity: "info" })}>
              info toast
            </Button>
            <Button variant="subtle" onClick={() => toast({ message: "Run failed · exit 1", severity: "error" })}>
              error toast
            </Button>
          </Stack>
        </Panel>

        <Panel title="Tabs">
          <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
            <Tab label="overview" />
            <Tab label="logs" />
            <Tab label="config" />
          </Tabs>
          <Box sx={{ pt: 2, fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", color: "text.secondary" }}>
            panel {tab}
          </Box>
        </Panel>
      </Stack>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>Abort run?</DialogTitle>
        <DialogContent>
          <DialogContentText>This stops agent delta and discards in-flight work.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDialogOpen(false)}>
            cancel
          </Button>
          <Button variant="contained" color="error" onClick={() => setDialogOpen(false)}>
            abort
          </Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={anchor} open={anchor != null} onClose={closeMenu}>
        <MenuItem onClick={closeMenu}>Restart</MenuItem>
        <MenuItem onClick={closeMenu}>Inspect</MenuItem>
        <MenuItem onClick={closeMenu}>Remove</MenuItem>
      </Menu>
    </KitSectionShell>
  );
}
