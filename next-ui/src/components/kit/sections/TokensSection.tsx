import { Box, Stack, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { Panel } from "../../ui";
import { KitSectionShell } from "../KitSectionShell";

function Swatch({ color, name, border }: { readonly color: string; readonly name: string; readonly border: string }) {
  return (
    <Stack spacing={0.75} sx={{ minWidth: 88 }}>
      <Box sx={{ height: 48, borderRadius: 2, backgroundColor: color, border: `1px solid ${border}` }} />
      <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
        {name}
      </Typography>
      <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.primary", opacity: 0.7 }}>
        {color}
      </Typography>
    </Stack>
  );
}

export function TokensSection() {
  const { custom } = useTheme();
  const { surfaces, status, borders, radii } = custom;

  return (
    <KitSectionShell
      id="tokens"
      title="Colors & Tokens"
      description="Surfaces, muted borders, and a tight status palette — the only color the UI spends. Adapts to the active theme."
    >
      <Stack spacing={2.5}>
        <Panel title="Surfaces">
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
            {Object.entries(surfaces).map(([name, color]) => (
              <Swatch key={name} name={name} color={color} border={borders.subtle} />
            ))}
          </Stack>
        </Panel>

        <Panel title="Status">
          <Stack direction="row" spacing={2} sx={{ flexWrap: "wrap", gap: 2 }}>
            {Object.entries(status).map(([name, tone]) => (
              <Stack key={name} spacing={0.75} sx={{ minWidth: 120 }}>
                <Stack direction="row" sx={{ height: 48, borderRadius: 2, overflow: "hidden" }}>
                  <Box sx={{ flex: 1, backgroundColor: tone.soft, border: `1px solid ${tone.border}` }} />
                  <Box sx={{ width: 18, backgroundColor: tone.main }} />
                </Stack>
                <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
                  {name}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </Panel>

        <Panel title="Radii & Borders">
          <Stack direction="row" spacing={3} sx={{ flexWrap: "wrap", gap: 3, alignItems: "flex-end" }}>
            {Object.entries(radii)
              .filter(([name]) => name !== "pill")
              .map(([name, value]) => (
                <Stack key={name} spacing={0.75} sx={{ alignItems: "center" }}>
                  <Box
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: `${value}px`,
                      backgroundColor: surfaces.s3,
                      border: `1px solid ${borders.strong}`,
                    }}
                  />
                  <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.7rem", color: "text.secondary" }}>
                    {name} · {value}px
                  </Typography>
                </Stack>
              ))}
          </Stack>
        </Panel>
      </Stack>
    </KitSectionShell>
  );
}
