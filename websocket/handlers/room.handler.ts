import { WebSocket } from "ws";
import { BaseHandler } from "./base.handler";
import { ConnectionContext } from "../types/room.types";
import { storage } from "../../storage";

export class RoomHandler extends BaseHandler {
  types = ["join", "updatePresence", "presencePing", "setViewingState", "ping"];

  async handle(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    switch (data.type) {
      case "join":
        await this.handleJoin(ws, data, context);
        break;
      case "updatePresence":
        await this.handleUpdatePresence(ws, data, context);
        break;
      case "presencePing":
        this.handlePresencePing(ws, data, context);
        break;
      case "setViewingState":
        this.handleSetViewingState(ws, data, context);
        break;
      case "ping":
        this.handlePing(ws, data, context);
        break;
    }
  }

  private async handleJoin(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    const { roomCode, user } = data;

    // Cancel any pending disconnect
    this.connectionService.cancelPendingDisconnect(roomCode, user.id);

    // Get board admin IDs
    const { creatorId, lecturerId } = await this.roomService.getBoardAdminIds(
      roomCode
    );

    const room = this.roomService.getOrCreateRoom(roomCode);

    // Determine admin status
    const isCreatorAdmin =
      context.authenticatedUserId &&
      ((creatorId && context.authenticatedUserId === creatorId) ||
        (lecturerId && context.authenticatedUserId === lecturerId));

    // Check if user is reconnecting
    const existingParticipant = room.get(user.id);
    const isReconnecting = existingParticipant !== undefined;

    const participant = {
      id: user.id,
      name: user.name,
      role: user.role || "student",
      color: user.color,
      joinedAt: isReconnecting ? existingParticipant.joinedAt : Date.now(),
      isAdmin: isCreatorAdmin || false,
      isPublic: isReconnecting
        ? existingParticipant.isPublic
        : user.isPublic || false,
      ws,
      originalVisibility: isReconnecting
        ? existingParticipant.originalVisibility
        : undefined,
      viewingUserId: isReconnecting ? existingParticipant.viewingUserId : null,
    };

    room.set(user.id, participant);

    // Update context
    context.currentRoomCode = roomCode;
    context.participantId = user.id;

    // Send participants list to new user
    const participants = Array.from(room.values()).map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      joinedAt: p.joinedAt,
      isAdmin: p.isAdmin,
      isPublic: p.isPublic,
    }));

    ws.send(JSON.stringify({ type: "participants", participants }));

    // Send restored viewing state if user was viewing another board
    if (isReconnecting && participant.viewingUserId) {
      ws.send(
        JSON.stringify({
          type: "restoreViewingState",
          viewingUserId: participant.viewingUserId,
        })
      );
    }

    // Send current focus state
    const focusState = this.roomService.roomFocusState.get(roomCode);
    if (focusState?.focusedUserId) {
      ws.send(
        JSON.stringify({
          type: "focus",
          targetUserId: focusState.focusedUserId,
          focusedBy: "system",
        })
      );
    } else if (isCreatorAdmin) {
      // Default: focus on admin's board
      this.roomService.roomFocusState.set(roomCode, {
        focusedUserId: user.id,
        originalVisibility: participant.isPublic,
      });

      this.broadcastToRoom(roomCode, {
        type: "focus",
        targetUserId: user.id,
        focusedBy: user.id,
      });
    }

    // Send current session state
    const board = await storage.getBoardByRoomCode(roomCode);
    if (isCreatorAdmin && board?.isEnded) {
      await storage.updateBoard(board.id, { isEnded: false });
      this.broadcastToRoom(roomCode, {
        type: "sessionState",
        isEnded: false,
      });
    } else if (board?.isEnded) {
      ws.send(
        JSON.stringify({
          type: "sessionState",
          isEnded: true,
        })
      );
    }

    // Broadcast new user to others
    this.broadcastToRoom(
      roomCode,
      {
        type: "userJoined",
        user: {
          id: participant.id,
          name: participant.name,
          role: participant.role,
          color: participant.color,
          joinedAt: participant.joinedAt,
          isAdmin: participant.isAdmin,
          isPublic: participant.isPublic,
        },
      },
      user.id
    );
  }

  private async handleUpdatePresence(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const participant = room.get(context.participantId);
    if (participant) {
      participant.isPublic = data.isPublic ?? participant.isPublic;

      this.broadcastToRoom(context.currentRoomCode, {
        type: "presenceUpdate",
        userId: context.participantId,
        isPublic: participant.isPublic,
        isAdmin: participant.isAdmin,
      });
    }
  }

  private handlePresencePing(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    // Lightweight presence refresh
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;
  }

  private handleSetViewingState(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const participant = room.get(context.participantId);
    if (participant) {
      participant.viewingUserId = data.viewingUserId || null;
    }
  }

  private handlePing(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  }
}
