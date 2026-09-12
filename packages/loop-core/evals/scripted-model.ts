/**
 * Modelo falso con guion. Es lo que hace que `npm run verify` corra el loop
 * entero en segundos, sin red, sin creditos y sin flakiness — y lo que permite
 * testear los casos adversarios (que el agente NO proponga la barbaridad)
 * de forma determinista.
 *
 * La forma sale de apps/channel/src/agent-factory.test.tsx: AI SDK v3,
 * doStream emitiendo tool-call o texto.
 */

export type ScriptedTurn =
  | { toolCalls: Array<{ name: string; args: unknown }> }
  | { text: string };

export function scriptedModel(turns: ScriptedTurn[]) {
  let call = 0;
  return {
    specificationVersion: "v3" as const,
    provider: "scripted",
    modelId: "scripted-model",
    supportedUrls: {},
    doGenerate: async () => ({
      content: [],
      finishReason: "stop" as const,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          const turn = turns[Math.min(call, turns.length - 1)];
          call += 1;

          controller.enqueue({ type: "stream-start", warnings: [] });

          if (turn && "toolCalls" in turn) {
            turn.toolCalls.forEach((tc, i) => {
              controller.enqueue({
                type: "tool-call",
                toolCallId: `call_${call}_${i}`,
                toolName: tc.name,
                input: tc.args,
              });
            });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "tool-calls", raw: "tool-calls" },
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
          } else {
            const text = turn && "text" in turn ? turn.text : "";
            controller.enqueue({ type: "text-start", id: `txt_${call}` });
            controller.enqueue({ type: "text-delta", id: `txt_${call}`, delta: text });
            controller.enqueue({ type: "text-end", id: `txt_${call}` });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
            });
          }
          controller.close();
        },
      }),
    }),
  } as never;
}
