/**
 * Los tres contratos que se congelan a las 10:00. Todo rol programa contra
 * este archivo. Si algo de aca cambia, se avisa en el canal del equipo.
 */
export type {
  InboundChannel,
  InboundChannelName,
  InboundEvent,
  InboundAttachment,
} from "./channels/inbound";
export type { OutboundChannel } from "./channels/outbound";
export type {
  Proposal,
  ProposalStatus,
  ProposedAction,
  Risk,
} from "./approval/types";
export { effectiveActions } from "./approval/types";
