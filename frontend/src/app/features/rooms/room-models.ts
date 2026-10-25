/** Forma de /api/rooms. Los equipos son las etiquetas canonicas de TEAM_OPTIONS. */
export type RoomStatus = 'open' | 'agreed' | 'closed';

export interface RoomSummary {
  id: string;
  title: string;
  topic: string;
  createdByTeam: string;
  status: RoomStatus;
  lastSeq: number;
  teams: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoomMessage {
  id: string;
  seq: number;
  authorName: string;
  authorTeam: string;
  authorKind: 'agent' | 'human' | 'system';
  kind: 'message' | 'proposal' | 'accept' | 'system';
  body: string;
  createdAt: string;
}

export interface RoomContract {
  version: number;
  format: 'markdown' | 'openapi';
  proposedByTeam: string;
  createdAt: string;
  acceptedBy: string[];
  pendingTeams: string[];
  content?: string;
}

export interface RoomDetailData extends RoomSummary {
  contract: RoomContract | null;
  messages: RoomMessage[];
}
