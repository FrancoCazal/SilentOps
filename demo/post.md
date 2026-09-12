# Post para redes (LinkedIn / X)

Publicar con el link del repo y del video. Etiquetar a los sponsors y a los organizadores locales según las instrucciones del portal (AI Tinkerers Asunción / San Lorenzo).

---

**SilentOps — continuity for critical cold-chain operations.**

Critical facilities don't fail only when equipment breaks. They fail when the next shift doesn't know what is still open.

We built SilentOps at #AgentsEverywhere, the @AITinkerers global hackathon: an agent that lives in the operations Slack channel of a refrigerated logistics hub. At 05:45 a deterministic detector checks the roster and searches for the shift handover that should exist. When it finds nothing, it records that absence as evidence and the agent proposes a sourced handover, the open work orders to reassign, and the Slack notice. A supervisor approves before a single write happens.

What makes it safe to run in a critical place:
• The model can only propose. Its one tool is propose_action; there is no path from the model to a write.
• Every write crosses one boundary: an Auth0 scope per action and an idempotency key, so a retried webhook or a second click never duplicates a document.
• The model never names a provider tool: domain intents map to the Ambiguous AI workspace in one adapter, and a handover bullet without a source never enters the document.
• A failure path that survives: the primary model provider fails and the same run completes on the fallback.

Built with @CopilotKit Channels (Slack), @Ambiguous AI (documents, work orders, chat over MCP), @Auth0 (machine-to-machine scopes), and the Agents, Everywhere starter kit. Team: Club de Programación FIUNA — Franco Cazal, Rodrigo Argüello, David Giménez, Iván Arturo.

Repo: https://github.com/FrancoCazal/SilentOps
Video: (link)

SilentOps never controls equipment or decides safety. It prepares a sourced handover for the responsible human to approve.

#AgentsEverywhere #AITinkerers #CopilotKit #Auth0 #AmbiguousAI #OpenAI #OpenRouter #Exa
