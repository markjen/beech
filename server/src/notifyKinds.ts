// Shared by the push server and the client, which also sends Steam notifications.
export type NotifyPref = 'gifts' | 'neighbors' | 'invites';

export const PUSH_KINDS = {
  visit: 'gifts',
  gift: 'gifts',
  neighbor_request: 'neighbors',
  neighbor_linked: 'neighbors',
  invite_settled: 'invites',
} as const satisfies Record<string, NotifyPref>;
