/**
 * HEREDADO DEL KIT (apps/channel/src/agent.ts, clase ChannelRunAgent), movido a
 * un package para poder correr el loop fuera de Slack (evals, cron, WhatsApp).
 *
 * Por que existe: BuiltInAgent limpia su abort controller privado en una
 * limpieza asincrona posterior, asi que volver a correr la MISMA instancia
 * despues de un tool result explota con "Agent is already running". Esta
 * fachada mantiene el transcript AG-UI afuera y le da a cada run una instancia
 * interna nueva.
 */
import { AbstractAgent } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/core";
import { Observable, type Subscription } from "rxjs";

export type AgentFactory = (threadId: string) => AbstractAgent;

export class FreshRunAgent extends AbstractAgent {
  private activeInner: AbstractAgent | undefined;

  constructor(
    private agentFactory: AgentFactory,
    threadId?: string,
  ) {
    super({ threadId });
  }

  override run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let inner: AbstractAgent | undefined;
      let subscription: Subscription | undefined;

      const release = () => {
        if (this.activeInner === inner) this.activeInner = undefined;
      };

      try {
        inner = this.agentFactory(input.threadId);
        inner.threadId = input.threadId;
        this.activeInner = inner;
        subscription = inner.run(input).subscribe({
          next: (event) => subscriber.next(event),
          error: (error) => {
            release();
            subscriber.error(error);
          },
          complete: () => {
            release();
            subscriber.complete();
          },
        });
      } catch (error) {
        release();
        subscriber.error(error);
      }

      return () => {
        subscription?.unsubscribe();
        inner?.abortRun();
        release();
      };
    });
  }

  override abortRun() {
    this.activeInner?.abortRun();
    super.abortRun();
  }

  override clone(): FreshRunAgent {
    const cloned = super.clone() as FreshRunAgent;
    cloned.agentFactory = this.agentFactory;
    cloned.activeInner = undefined;
    return cloned;
  }
}
