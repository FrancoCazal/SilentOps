import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { startChannelsWithGatewayControl } from "@copilotkit/channels-intelligence";
import {
  bootstrapBoundary,
  fixtureReader,
  proposals,
  TOOLS,
} from "loop-core";
import {
  ManagedGateway,
  preparedDelivery,
} from "./testing/managed-gateway";

const previousChannelCode = process.env.CHANNEL_CODE;
const previousTelemetryDisabled = process.env.COPILOTKIT_TELEMETRY_DISABLED;
process.env.CHANNEL_CODE = "silentops-test";
process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";

// CHANNEL_CODE is read while createChannel runs, so this import must stay dynamic.
const { silentopsChannel } = await import("./silentops-channel");

const SHIFT = {
  name: "Noche",
  start: "22:00",
  end: "06:00",
  outgoing: ["Ana"],
  incoming: ["Bruno"],
};

type WorkspaceWrite = {
  tool: string;
  args: Record<string, unknown>;
};

describe("SilentOps managed Slack", () => {
  const gateway = new ManagedGateway();
  const workspaceWrites: WorkspaceWrite[] = [];
  const appApiRequests: string[] = [];
  const previousFetch = globalThis.fetch;
  let handle: Awaited<ReturnType<typeof startChannelsWithGatewayControl>>;

  const appApiFetch: typeof fetch = async (input) => {
    const url = String(input);
    appApiRequests.push(url);

    if (url.endsWith("/charge")) {
      return Response.json({ charged: true });
    }
    if (url.endsWith("/transcript")) {
      return Response.json({
        messages: [],
        truncation: {
          messageLimit: false,
          byteLimit: false,
          omittedMessageCount: 0,
        },
      });
    }
    if (url.endsWith("/api/channels/kv/set")) {
      return Response.json({});
    }

    throw new Error(`Unexpected app API request: ${url}`);
  };

  before(async () => {
    proposals.reset();
    await bootstrapBoundary({
      log: () => {},
      persist: false,
      workspaceExecutor: async (tool, args) => {
        workspaceWrites.push({ tool, args });
        return { ok: true };
      },
      workspaceReader: fixtureReader({
        [TOOLS.currentShift]: { shift: SHIFT },
        [TOOLS.searchDocuments]: [],
        [TOOLS.channelHistory]: [
          {
            id: "m1",
            at: "01:20",
            text: "camara 3 con la puerta trabada",
          },
        ],
        [TOOLS.openWorkOrders]: [
          {
            id: "OT-88",
            assignee: "Ana",
            title: "Inspeccion camara 3",
          },
        ],
      }),
    });

    // IntelligenceStateStore 0.9.2 does not forward appApiFetch to its KV
    // client, so fence global fetch with the same offline fake as well.
    globalThis.fetch = appApiFetch;
    handle = await startChannelsWithGatewayControl([silentopsChannel], {
      session: gateway,
      scope: { projectId: 1, channelName: "silentops-test" },
      runtimeInstanceId: "rti_silentops_test",
      appApiBaseUrl: "https://api.example",
      apiKey: "cpk-offline-test",
      appApiFetch,
      loadHistory: async () => [],
      runCanonical: async () => {
        throw new Error("SilentOps channel tests must not invoke a model");
      },
    });
  });

  after(async () => {
    await handle?.stop();
    globalThis.fetch = previousFetch;
    proposals.reset();
    if (previousChannelCode === undefined) {
      delete process.env.CHANNEL_CODE;
    } else {
      process.env.CHANNEL_CODE = previousChannelCode;
    }
    if (previousTelemetryDisabled === undefined) {
      delete process.env.COPILOTKIT_TELEMETRY_DISABLED;
    } else {
      process.env.COPILOTKIT_TELEMETRY_DISABLED = previousTelemetryDisabled;
    }
  });

  it("publishes a Vigilancia armada card when @silentops is mentioned", async () => {
    const packetOffset = gateway.packets.length;
    const delivery = preparedDelivery("silentops_arm", "slack", {
      kind: "text",
      text: "@silentops vigilá",
      messageRef: { id: "pref_v1_silentops_arm_message" },
      operation: {
        kind: "created",
        logicalMessageId:
          "pid_v1_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ",
        revisionId:
          "pid_v1_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq",
        mentioned: true,
      },
    });

    await gateway.deliver({ ...delivery, channelName: "silentops-test" });

    const payloads = gateway.packets
      .slice(packetOffset)
      .map(({ payload }) => payload);
    const messages = payloads.filter(
      (payload) => payload.kind === "slack.message.create",
    );
    assert.equal(messages.length, 1, JSON.stringify(payloads));
    assert.match(JSON.stringify(messages[0]), /Vigilancia armada/);
    assert.match(JSON.stringify(messages[0]), /Ada/);
    assert.equal(workspaceWrites.length, 0);
    assert.ok(
      appApiRequests.some((url) => url.endsWith("/api/channels/kv/set")),
      JSON.stringify(appApiRequests),
    );
  });

  it("ignores a bot mention without posting messages or writing", async () => {
    const packetOffset = gateway.packets.length;
    const writeOffset = workspaceWrites.length;
    const delivery = preparedDelivery("silentops_bot", "slack", {
      kind: "text",
      text: "@silentops vigilá",
      messageRef: { id: "pref_v1_silentops_bot_message" },
      operation: {
        kind: "created",
        logicalMessageId:
          "pid_v1_bot_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL",
        revisionId:
          "pid_v1_bot_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkl",
        mentioned: true,
      },
    });

    await gateway.deliver({
      ...delivery,
      channelName: "silentops-test",
      turn: {
        ...delivery.turn,
        actor: {
          externalUserId: "bot_silentops",
          kind: "bot",
          displayName: "SilentOps",
        },
      },
    });

    const payloads = gateway.packets
      .slice(packetOffset)
      .map(({ payload }) => payload);
    assert.equal(
      payloads.filter((payload) =>
        payload.kind.startsWith("slack.message."),
      ).length,
      0,
      JSON.stringify(payloads),
    );
    assert.equal(workspaceWrites.length, writeOffset);
  });

  it(
    "runs the detector from a mention with a scripted model",
    {
      skip:
        "silentopsChannel closes over handleEvent/makeChannelAgent and exposes no scripted-model injection seam; running this path could call a real provider",
    },
    () => {},
  );
});
