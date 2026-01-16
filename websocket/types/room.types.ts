import { WebSocket } from "ws";

export interface RoomParticipant {
  id: string;
  name: string;
  role: string;
  color: string;
  joinedAt: number;
  isAdmin: boolean;
  isPublic: boolean;
  ws: WebSocket;
  originalVisibility?: boolean;
  viewingUserId?: string | null;
}

export interface RoomFocusState {
  focusedUserId: string | null;
  originalVisibility: boolean | null;
}

export interface PendingBoardUpdate {
  roomCode: string;
  userId: string;
  userName: string;
  lines: unknown[];
  timer: NodeJS.Timeout;
}

export interface ConnectionContext {
  authenticatedUserId?: string;
  isGuest: boolean;
  currentRoomCode?: string;
  participantId?: string;
}
