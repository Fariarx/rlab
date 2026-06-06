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
      title="Оверлеи и навигация"
      description="Диалоги, меню, подсказки, вкладки и очередь тостов в общей surface-теме."
    >
      <Stack spacing={2.5}>
        <Panel title="Триггеры">
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
            <Button variant="subtle" onClick={() => setDialogOpen(true)}>
              открыть диалог
            </Button>
            <Button variant="subtle" onClick={openMenu}>
              открыть меню
            </Button>
            <Tooltip title="Запускает активного агента">
              <Button variant="subtle">подсказка</Button>
            </Tooltip>
            <Button variant="subtle" onClick={() => toast({ message: "Прогон поставлен в очередь · agent delta", severity: "info" })}>
              инфо-тост
            </Button>
            <Button variant="subtle" onClick={() => toast({ message: "Прогон упал · код выхода 1", severity: "error" })}>
              тост ошибки
            </Button>
          </Stack>
        </Panel>

        <Panel title="Вкладки">
          <Tabs value={tab} onChange={(_, value: number) => setTab(value)}>
            <Tab label="обзор" />
            <Tab label="логи" />
            <Tab label="конфиг" />
          </Tabs>
          <Box sx={{ pt: 2, fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", color: "text.secondary" }}>
            панель {tab}
          </Box>
        </Panel>
      </Stack>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <DialogTitle>Остановить прогон?</DialogTitle>
        <DialogContent>
          <DialogContentText>Это остановит агент delta и отбросит работу в процессе.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setDialogOpen(false)}>
            отмена
          </Button>
          <Button variant="contained" color="error" onClick={() => setDialogOpen(false)}>
            остановить
          </Button>
        </DialogActions>
      </Dialog>

      <Menu anchorEl={anchor} open={anchor != null} onClose={closeMenu}>
        <MenuItem onClick={closeMenu}>Перезапустить</MenuItem>
        <MenuItem onClick={closeMenu}>Инспектировать</MenuItem>
        <MenuItem onClick={closeMenu}>Удалить</MenuItem>
      </Menu>
    </KitSectionShell>
  );
}
