import { WebSocket } from "ws";
import { storage } from "../../storage";
import {
  RoomParticipant,
  RoomFocusState,
  PendingBoardUpdate,
} from "../types/room.types";

export class RoomService {
  rooms = new Map<string, Map<string, RoomParticipant>>();
  roomFocusState = new Map<string, RoomFocusState>();
  pendingBoardUpdates = new Map<string, PendingBoardUpdate>();
  pendingDisconnects = new Map<string, NodeJS.Timeout>();

  // Board creator/lecturer cache
  boardCreatorCache = new Map<string, string>();
  boardLecturerCache = new Map<string, string>();

  // Constants
  readonly DISCONNECT_GRACE_PERIOD_MS = 300000;
  readonly ADMIN_DISCONNECT_GRACE_PERIOD_MS = 600000;
  readonly BOARD_UPDATE_DEBOUNCE_MS = 2000;

  async flushBoardUpdate(key: string) {
    const pending = this.pendingBoardUpdates.get(key);
    if (!pending) return;

    this.pendingBoardUpdates.delete(key);

    try {
      const board = await storage.getBoardByRoomCode(pending.roomCode);
      if (board) {
        await storage.upsertBoardData({
          boardId: board.id,
          userId: pending.userId,
          userName: pending.userName,
          linesData: pending.lines,
        });
      }
    } catch (err) {
      console.error("Failed to persist board data:", err);
    }
  }

  scheduleBoardUpdate(
    roomCode: string,
    userId: string,
    userName: string,
    lines: unknown[]
  ) {
    const key = `${roomCode}:${userId}`;

    // Clear existing timer if any
    const existing = this.pendingBoardUpdates.get(key);
    if (existing) {
      clearTimeout(existing.timer);
    }

    // Schedule new debounced write
    const timer = setTimeout(
      () => this.flushBoardUpdate(key),
      this.BOARD_UPDATE_DEBOUNCE_MS
    );
    this.pendingBoardUpdates.set(key, {
      roomCode,
      userId,
      userName,
      lines,
      timer,
    });
  }

  async getBoardAdminIds(
    roomCode: string
  ): Promise<{ creatorId: string; lecturerId: string | null }> {
    let creatorId = this.boardCreatorCache.get(roomCode);
    let lecturerId = this.boardLecturerCache.get(roomCode);

    if (!creatorId) {
      const board = await storage.getBoardByRoomCode(roomCode);
      if (board) {
        creatorId = board.creatorId;
        this.boardCreatorCache.set(roomCode, creatorId);
        if (board.lecturerId) {
          lecturerId = board.lecturerId;
          this.boardLecturerCache.set(roomCode, lecturerId);
        }
      }
    }

    return { creatorId: creatorId || "", lecturerId: lecturerId || null };
  }

  getRoom(roomCode: string): Map<string, RoomParticipant> | undefined {
    return this.rooms.get(roomCode);
  }

  getOrCreateRoom(roomCode: string): Map<string, RoomParticipant> {
    let room = this.getRoom(roomCode);
    if (!room) {
      room = new Map();
      this.rooms.set(roomCode, room);
    }
    return room;
  }

  removeRoom(roomCode: string): boolean {
    return this.rooms.delete(roomCode);
  }

  broadcastToRoom(
    roomCode: string,
    message: any,
    excludeParticipantId?: string
  ): void {
    const room = this.getRoom(roomCode);
    if (!room) return;

    room.forEach((participant, id) => {
      if (id !== excludeParticipantId && participant.ws.readyState === 1) {
        participant.ws.send(JSON.stringify(message));
      }
    });
  }
}
