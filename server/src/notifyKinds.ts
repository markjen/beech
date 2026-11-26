// Shared by the push server and the client, which also sends Steam notifications.
export type NotifyPref = 'gifts' | 'neighbors' | 'invites' | 'beach';

export const PUSH_KINDS = {
  visit: 'gifts',
  gift: 'gifts',
  neighbor_request: 'neighbors',
  neighbor_linked: 'neighbors',
  invite_settled: 'invites',
  // away events: the sea working on your beach, and visitors feeding your pet
  tide: 'beach',
  pet_fed: 'beach',
} as const satisfies Record<string, NotifyPref>;
