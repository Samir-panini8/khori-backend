import { WebSocket } from "ws";
import { RoomService } from "./room.service";
import { storage } from "../../storage";

export class ConnectionService {
  private heartbeatInterval: NodeJS.Timeout;

  constructor(private roomService: RoomService) {
    // Setup heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, 30000);
  }

  cleanup(): void {
    clearInterval(this.heartbeatInterval);
  }

  private sendHeartbeat(): void {
    // Send ping to all connected clients
    this.roomService.rooms.forEach((room) => {
      room.forEach((participant) => {
        if (participant.ws.readyState === 1) {
          participant.ws.send(JSON.stringify({ type: "ping" }));
        }
      });
    });
  }

  handleDisconnect(
    roomCode: string,
    participantId: string,
    wasAdmin: boolean
  ): void {
    const room = this.roomService.getRoom(roomCode);
    if (!room) return;

    const leavingUser = room.get(participantId);
    if (!leavingUser) return;

    const gracePeriod = wasAdmin
      ? this.roomService.ADMIN_DISCONNECT_GRACE_PERIOD_MS
      : this.roomService.DISCONNECT_GRACE_PERIOD_MS;

    const disconnectKey = `${roomCode}:${participantId}`;

    console.log(
      `[WS] ${wasAdmin ? "Admin" : "User"} ${
        leavingUser.name || participantId
      } disconnected, starting ${gracePeriod / 1000}s grace period`
    );

    const disconnectTimer = setTimeout(async () => {
      this.roomService.pendingDisconnects.delete(disconnectKey);

      const currentRoom = this.roomService.getRoom(roomCode);
      if (currentRoom) {
        const stillDisconnected = currentRoom.get(participantId);
        if (stillDisconnected && stillDisconnected.ws.readyState !== 1) {
          console.log(
            `[WS] Grace period expired for ${stillDisconnected.name}, removing from room`
          );
          currentRoom.delete(participantId);

          // If admin's grace period expired, end the session
          if (wasAdmin && currentRoom.size > 0) {
            const board = await storage.getBoardByRoomCode(roomCode);
            if (board) {
              await storage.updateBoard(board.id, { isEnded: true });
            }

            this.roomService.broadcastToRoom(roomCode, {
              type: "sessionState",
              isEnded: true,
            });
          }

          this.roomService.broadcastToRoom(
            roomCode,
            {
              type: "userLeft",
              userId: participantId,
            },
            participantId
          );

          if (currentRoom.size === 0) {
            this.roomService.removeRoom(roomCode);
          }
        }
      }
    }, gracePeriod);

    this.roomService.pendingDisconnects.set(disconnectKey, disconnectTimer);
  }

  cancelPendingDisconnect(roomCode: string, participantId: string): void {
    const disconnectKey = `${roomCode}:${participantId}`;
    const pendingDisconnect =
      this.roomService.pendingDisconnects.get(disconnectKey);
    if (pendingDisconnect) {
      clearTimeout(pendingDisconnect);
      this.roomService.pendingDisconnects.delete(disconnectKey);
      console.log(
        `[WS] Cancelled pending disconnect for ${participantId} in room ${roomCode}`
      );
    }
  }
}
