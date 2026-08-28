export interface SubtitleSegmentTicket {
  responseId: number
  segmentId: number
  text: string
}

/**
 * Keeps subtitle presentation scoped to the current response/playback.
 * Queueing a segment never changes visible text; only an explicit playback
 * activation may do that. This makes synthesis speed independent from the UI.
 */
export class SubtitlePlaybackCoordinator {
  private responseId = 0;

  private nextSegmentId = 0;

  private lastActivatedSegmentId = -1;

  private silentResponseText = '';

  private currentSubtitle = '';

  startResponse(): void {
    this.responseId += 1;
    this.nextSegmentId = 0;
    this.lastActivatedSegmentId = -1;
    this.silentResponseText = '';
    this.currentSubtitle = '';
  }

  cancelResponse(): void {
    this.startResponse();
  }

  createSegment(text: string): SubtitleSegmentTicket {
    const ticket = {
      responseId: this.responseId,
      segmentId: this.nextSegmentId,
      text,
    };
    this.nextSegmentId += 1;
    return ticket;
  }

  activateForPlayback(ticket: SubtitleSegmentTicket): string | null {
    if (
      ticket.responseId !== this.responseId
      || ticket.segmentId <= this.lastActivatedSegmentId
    ) {
      return null;
    }
    this.lastActivatedSegmentId = ticket.segmentId;
    this.currentSubtitle = ticket.text;
    return ticket.text;
  }

  activateWithoutPlayback(ticket: SubtitleSegmentTicket): string | null {
    const text = this.activateForPlayback(ticket);
    if (text === null) return null;
    this.silentResponseText = this.silentResponseText
      ? `${this.silentResponseText} ${text}`
      : text;
    this.currentSubtitle = this.silentResponseText;
    return this.silentResponseText;
  }

  getCurrentSubtitle(): string {
    return this.currentSubtitle;
  }
}

export const subtitlePlaybackCoordinator = new SubtitlePlaybackCoordinator();
