import { Box, Stack, Typography } from "@mui/material";
import { AgentBlockRenderer } from "./AgentBlockRenderer";
import { rise } from "./anim";
import { AgentAvatar, UserAvatar } from "./parts";
import { type ChatMessage } from "./types";

function UserMessage({ message, delay }: { readonly message: ChatMessage; readonly delay: number }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ justifyContent: "flex-end", alignItems: "flex-start", ...rise(delay) }}>
      <Stack spacing={0.5} sx={{ alignItems: "flex-end", maxWidth: "82%" }}>
        <Box
          sx={{
            px: 1.75,
            py: 1.25,
            borderRadius: (t) => `${t.custom.radii.lg}px`,
            borderTopRightRadius: (t) => `${t.custom.radii.sm}px`,
            backgroundColor: (t) => t.custom.surfaces.s3,
            border: (t) => `1px solid ${t.custom.borders.subtle}`,
          }}
        >
          <Typography sx={{ fontSize: "0.9rem", lineHeight: 1.6, color: "text.primary", whiteSpace: "pre-line" }}>
            {message.text}
          </Typography>
        </Box>
        {message.time && (
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
            {message.time}
          </Typography>
        )}
      </Stack>
      <UserAvatar />
    </Stack>
  );
}

function AgentMessage({ message, delay }: { readonly message: ChatMessage; readonly delay: number }) {
  return (
    <Stack direction="row" spacing={1.25} sx={{ alignItems: "flex-start", ...rise(delay) }}>
      <AgentAvatar />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "baseline", mb: 1 }}>
          <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.8rem", fontWeight: 700, color: "text.primary" }}>
            Agent
          </Typography>
          {message.time && (
            <Typography sx={{ fontFamily: (t) => t.custom.fonts.mono, fontSize: "0.66rem", color: "text.secondary" }}>
              {message.time}
            </Typography>
          )}
        </Stack>
        <Stack spacing={1.25}>
          {message.blocks?.map((block, index) => (
            <Box key={index} sx={rise(delay + 120 + index * 90)}>
              <AgentBlockRenderer block={block} />
            </Box>
          ))}
        </Stack>
      </Box>
    </Stack>
  );
}

export function Message({ message, index = 0 }: { readonly message: ChatMessage; readonly index?: number }) {
  const delay = index * 120;
  return message.role === "user" ? <UserMessage message={message} delay={delay} /> : <AgentMessage message={message} delay={delay} />;
}
