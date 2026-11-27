// specs/tla/SystemMessages.tla in TypeScript: the design that's built
// (Fixed = TRUE: one statement, the unique day and request id decide).

export class SystemMessagesModel {
  /** the days that have a message, and the requests that were sent */
  days = new Set<string>();
  requests = new Set<string>();
  /** each message: who got it */
  rows = new Map<string, Set<string>>();

  /** POST /api/system-messages: 200 and who it reached, or 409 */
  send(day: string, request: string, players: readonly string[]): { status: number; recipients?: number } {
    if (this.days.has(day) || this.requests.has(request)) return { status: 409 };
    this.days.add(day);
    this.requests.add(request);
    this.rows.set(request, new Set(players));
    return { status: 200, recipients: players.length };
  }
}
