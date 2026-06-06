import { Box, Stack } from "@mui/material";
import { Message } from "./Message";
import { rise } from "./anim";
import { AgentAvatar, TypingDots } from "./parts";
import { type ChatMessage } from "./types";

/** Conversation — the message thread, with an optional trailing typing row. */
export function Conversation({
  messages,
  typing,
}: {
  readonly messages: readonly ChatMessage[];
  readonly typing?: boolean;
}) {
  return (
    <Stack spacing={3}>
      {messages.map((message, index) => (
        <Message key={message.id} message={message} index={index} />
      ))}
      {typing && (
        <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", ...rise(messages.length * 120) }}>
          <AgentAvatar />
          <Box
            sx={{
              px: 1.5,
              py: 1,
              borderRadius: (t) => `${t.custom.radii.lg}px`,
              borderTopLeftRadius: (t) => `${t.custom.radii.sm}px`,
              backgroundColor: (t) => t.custom.surfaces.s2,
              border: (t) => `1px solid ${t.custom.borders.subtle}`,
            }}
          >
            <TypingDots />
          </Box>
        </Stack>
      )}
    </Stack>
  );
}
