import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import SearchIcon from "@mui/icons-material/Search";
import { Box, Dialog, DialogActions, InputAdornment, InputBase, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { Button, IconButton, StatusDot } from "../ui";
import { AgentMonogram } from "./AgentMonogram";
import { pop } from "./anim";
import {
  AGENTS,
  type AgentId,
  type AgentProfile,
  agentStatusKey,
  agentStatusLabel,
  getAgent,
  withAlpha,
} from "./agents";
import { useAgentStatus } from "./use-agent-status";

/** AgentPicker — a polished dialog for choosing the agent + variant, showing
 * each agent's status in the system. */
export function AgentPicker({
  open,
  value,
  onClose,
  onSelect,
}: {
  readonly open: boolean;
  readonly value: AgentProfile;
  readonly onClose: () => void;
  readonly onSelect: (profile: AgentProfile) => void;
}) {
  const [agent, setAgent] = useState<AgentId>(value.agent);
  const [variant, setVariant] = useState<string>(value.variant);
  const [query, setQuery] = useState("");
  const statusOf = useAgentStatus();

  const def = getAgent(agent);
  const selectedStatus = statusOf(agent);
  const canUse = selectedStatus !== "unavailable";

  const agents = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") {
      return AGENTS;
    }
    return AGENTS.filter((a) => a.name.toLowerCase().includes(q) || a.vendor.toLowerCase().includes(q));
  }, [query]);

  const choose = (id: AgentId) => {
    setAgent(id);
    setVariant("DEFAULT");
  };

  const confirm = () => {
    onSelect({ agent, variant });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <Stack
        direction="row"
        sx={{ alignItems: "center", justifyContent: "space-between", px: 2.5, pt: 2, pb: 1.5 }}
      >
        <Box>
          <Typography sx={{ fontSize: "1rem", fontWeight: 700, color: "text.primary" }}>Choose agent</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Every agent runs with full computer access.
          </Typography>
        </Box>
        <IconButton aria-label="Close" onClick={onClose}>
          <CloseIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      <Box sx={{ px: 2.5, pb: 1.5 }}>
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search agents…"
          autoFocus
          startAdornment={
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 17, color: "text.secondary" }} />
            </InputAdornment>
          }
          sx={{
            width: "100%",
            px: 1.25,
            py: 0.75,
            fontSize: "0.85rem",
            borderRadius: (t) => `${t.custom.radii.md}px`,
            backgroundColor: (t) => t.custom.surfaces.s3,
            border: (t) => `1px solid ${t.custom.borders.subtle}`,
          }}
        />
      </Box>

      <Box sx={{ px: 2.5, pb: 1, maxHeight: 360, overflow: "auto" }}>
        <Box sx={{ display: "grid", gap: 1, gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" } }}>
          {agents.map((a) => {
            const sys = statusOf(a.id);
            const active = a.id === agent;
            const disabled = sys === "unavailable";
            return (
              <Stack
                key={a.id}
                direction="row"
                spacing={1.25}
                onClick={() => choose(a.id)}
                sx={{
                  position: "relative",
                  alignItems: "center",
                  p: 1.25,
                  borderRadius: (t) => `${t.custom.radii.md}px`,
                  cursor: "pointer",
                  opacity: disabled ? 0.55 : 1,
                  border: (t) => `1px solid ${active ? withAlpha(a.accent, 0.5) : t.custom.borders.subtle}`,
                  backgroundColor: (t) => (active ? withAlpha(a.accent, 0.1) : t.custom.surfaces.s2),
                  transition: "transform 150ms ease, border-color 150ms ease, background-color 150ms ease",
                  "&:hover": { transform: "translateY(-1px)", borderColor: (t) => withAlpha(a.accent, 0.45) },
                }}
              >
                <AgentMonogram agent={a.id} size={32} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: "0.84rem", fontWeight: 600, color: "text.primary" }}>
                    {a.name}
                  </Typography>
                  <Typography noWrap sx={{ fontSize: "0.72rem", color: "text.secondary" }}>
                    {a.vendor}
                  </Typography>
                </Box>
                <Stack spacing={0.5} sx={{ alignItems: "flex-end", flex: "0 0 auto" }}>
                  <StatusDot status={agentStatusKey[sys]} label={agentStatusLabel[sys]} size="sm" pulse={sys === "running"} />
                </Stack>
                {active && (
                  <Box
                    sx={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "#fff",
                      backgroundColor: a.accent,
                      animation: `${pop} 220ms ease both`,
                    }}
                  >
                    <CheckIcon sx={{ fontSize: 11 }} />
                  </Box>
                )}
              </Stack>
            );
          })}
        </Box>
      </Box>

      {def.variants.length > 1 && (
        <Box sx={{ px: 2.5, pt: 1, pb: 0.5 }}>
          <Typography variant="microLabel" sx={{ color: "text.secondary", display: "block", mb: 0.75 }}>
            {def.name} · variant
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap", gap: 1 }}>
            {def.variants.map((v) => {
              const on = v === variant;
              return (
                <Box
                  key={v}
                  onClick={() => setVariant(v)}
                  sx={{
                    px: 1.25,
                    py: 0.5,
                    borderRadius: (t) => `${t.custom.radii.pill}px`,
                    cursor: "pointer",
                    fontFamily: (t) => t.custom.fonts.mono,
                    fontSize: "0.72rem",
                    fontWeight: 600,
                    color: (t) => (on ? t.palette.status.running.main : t.palette.text.secondary),
                    border: (t) => `1px solid ${on ? t.palette.status.running.border : t.custom.borders.subtle}`,
                    backgroundColor: (t) => (on ? t.palette.status.running.soft : t.custom.surfaces.s2),
                    transition: "all 140ms ease",
                  }}
                >
                  {v}
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}

      <DialogActions sx={{ px: 2.5, py: 2 }}>
        <Box sx={{ flex: 1 }}>
          {!canUse && (
            <Typography sx={{ fontSize: "0.74rem", color: (t) => t.palette.status.warn.main }}>
              {def.name} isn’t installed on this machine.
            </Typography>
          )}
        </Box>
        <Button variant="text" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="contained" onClick={confirm} disabled={!canUse}>
          Use {def.name}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
