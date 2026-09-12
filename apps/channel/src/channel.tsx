import { createChannel } from "@copilotkit/channels";
import { isSearchConfigured, isWorkplaceConfigured, WORKPLACE_CONTEXT } from "agent-core";
import { makeChannelAgent } from "./agent";
import { required } from "./env";
import { IncidentCard, Timeline, welcomeMessage } from "./components";
import { runHandover } from "./silentops";
import { proposeAction, readThread, searchTheWeb } from "./tools";

// Tools are registered only when their credential is present, so the agent is
// never handed a tool that will fail when it calls it.
const tools = [
  readThread,
  proposeAction,
  ...(isSearchConfigured() ? [searchTheWeb] : []),
];

export const channel = createChannel({
  // Must equal the Channel Code in Intelligence, character for character. A
  // mismatch leaves the Channel at "Waiting for runtime" and is validated at
  // startup, not here.
  name: required("CHANNEL_CODE"),

  // Required. "platform" derives the canonical user from provider + workspace +
  // platform user id. Do NOT move this onto CopilotRuntime — that one is for
  // web requests and must be absent on a Channels-only runtime.
  identifyUser: "platform",

  agent: makeChannelAgent,
  tools,
  components: [IncidentCard, Timeline],

  // Injected into the agent's prompt on every run.
  context: [
    
    {
      description: "Rendering",
      value:
        "You can draw native UI by calling incident_card or timeline. Prefer them over prose whenever the answer has structure.",
    },
    ...(isWorkplaceConfigured()
      ? [{ description: "Workplace", value: WORKPLACE_CONTEXT }]
      : []),
    {
      description: "Surface",
      value:
        "This is a chat thread in a channel people are actively working in. Assume others are reading and that some joined late.",
    },
  ],

});

// A mention subscribes the conversation and replays the SilentOps detector
// against this thread: deterministic detection, then a proposal, then the
// approval card. The product's real trigger is the scheduled shift-boundary run
// (`npm run silentops:detect -w loop-core`); the mention is the development
// smoke test for the same code path and must not be presented as the proactive
// detection in the demo. Passing `origin: "manual-replay"` makes the card SAY so,
// so a frame filmed by accident cannot be mistaken for the real trigger.
channel.onMention(async ({ thread }) => {
  await thread.subscribe();
  await runHandover(thread, { origin: "manual-replay" });
});

// Non-mentioned turns only ever reach onMessage — gate them on the flag or the
// agent will answer every message in every channel it has been invited to.
channel.onMessage(async ({ thread }) => {
  if (await thread.isSubscribed()) {
    await thread.runAgent();
  }
});

channel.onWelcome(async ({ thread, platform }) => {
  await thread.post(welcomeMessage(platform));
});
