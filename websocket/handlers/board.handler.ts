import { WebSocket } from "ws";
import { BaseHandler } from "./base.handler";
import { ConnectionContext } from "../types/room.types";

export class BoardHandler extends BaseHandler {
  types = [
    "cursor",
    "draw",
    "requestBoard",
    "sendBoard",
    "boardUpdate",
    "sessionState",
    "focus",
    "sidebarToggle",
  ];

  async handle(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    switch (data.type) {
      case "cursor":
        this.handleCursor(ws, data, context);
        break;
      case "draw":
        this.handleDraw(ws, data, context);
        break;
      case "requestBoard":
        this.handleRequestBoard(ws, data, context);
        break;
      case "sendBoard":
        this.handleSendBoard(ws, data, context);
        break;
      case "boardUpdate":
        await this.handleBoardUpdate(ws, data, context);
        break;
      case "sessionState":
        await this.handleSessionState(ws, data, context);
        break;
      case "focus":
        await this.handleFocus(ws, data, context);
        break;
      case "sidebarToggle":
        this.handleSidebarToggle(ws, data, context);
        break;
    }
  }

  private handleCursor(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (!context.currentRoomCode) return;

    this.broadcastToRoom(
      context.currentRoomCode,
      {
        type: "cursor",
        userId: context.participantId,
        x: data.x,
        y: data.y,
        color: data.color,
        name: data.name,
        isPointer: data.isPointer,
        viewingUserId: data.viewingUserId,
      },
      context.participantId
    );
  }

  private handleDraw(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (!context.currentRoomCode) return;

    this.broadcastToRoom(
      context.currentRoomCode,
      {
        type: "draw",
        userId: context.participantId,
        line: data.line,
      },
      context.participantId
    );
  }

  private handleRequestBoard(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (!context.currentRoomCode) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const target = room.get(data.targetUserId);
    if (target && target.ws.readyState === 1) {
      target.ws.send(
        JSON.stringify({
          type: "boardRequest",
          requesterId: context.participantId,
        })
      );
    }
  }

  private handleSendBoard(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (!context.currentRoomCode) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const target = room.get(data.targetUserId);
    if (target && target.ws.readyState === 1) {
      target.ws.send(
        JSON.stringify({
          type: "boardData",
          userId: context.participantId,
          lines: data.lines,
        })
      );
    }
  }

  private async handleBoardUpdate(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    if (!context.currentRoomCode) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    // Schedule debounced database persistence
    const targetUser = room.get(data.userId);
    const userName = targetUser?.name || data.userName || data.userId;

    this.roomService.scheduleBoardUpdate(
      context.currentRoomCode,
      data.userId,
      userName,
      data.lines || []
    );

    this.broadcastToRoom(
      context.currentRoomCode,
      {
        type: "boardUpdate",
        userId: data.userId,
        lines: data.lines,
      },
      context.participantId
    );
  }

  private async handleSessionState(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const sender = room.get(context.participantId);
    if (!sender?.isAdmin) return;

    const isEnded = data.isEnded;

    // Update database
    const board = await storage.getBoardByRoomCode(context.currentRoomCode);
    if (board) {
      await storage.updateBoard(board.id, { isEnded });
    }

    this.broadcastToRoom(context.currentRoomCode, {
      type: "sessionState",
      isEnded,
    });
  }

  private async handleFocus(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const sender = room.get(context.participantId);
    if (!sender?.isAdmin) return;

    const targetUserId = data.targetUserId;
    let focusState = this.roomService.roomFocusState.get(
      context.currentRoomCode
    );

    if (!focusState) {
      focusState = { focusedUserId: null, originalVisibility: null };
      this.roomService.roomFocusState.set(context.currentRoomCode, focusState);
    }

    if (targetUserId) {
      // Restore previous focus if different user was focused
      if (
        focusState.focusedUserId &&
        focusState.focusedUserId !== targetUserId &&
        focusState.originalVisibility !== null
      ) {
        const prevFocused = room.get(focusState.focusedUserId);
        if (prevFocused) {
          prevFocused.isPublic = focusState.originalVisibility;
          this.broadcastToRoom(context.currentRoomCode, {
            type: "presenceUpdate",
            userId: focusState.focusedUserId,
            isPublic: focusState.originalVisibility,
            isAdmin: prevFocused.isAdmin,
          });
        }
      }

      // Focusing on a board
      const target = room.get(targetUserId);
      if (target) {
        focusState.focusedUserId = targetUserId;
        focusState.originalVisibility = target.isPublic;
        target.isPublic = true;

        this.broadcastToRoom(context.currentRoomCode, {
          type: "presenceUpdate",
          userId: targetUserId,
          isPublic: true,
          isAdmin: target.isAdmin,
        });
      }
    } else {
      // Releasing focus
      if (focusState.focusedUserId && focusState.originalVisibility !== null) {
        const prevFocused = room.get(focusState.focusedUserId);
        if (prevFocused) {
          prevFocused.isPublic = focusState.originalVisibility;
          this.broadcastToRoom(context.currentRoomCode, {
            type: "presenceUpdate",
            userId: focusState.focusedUserId,
            isPublic: focusState.originalVisibility,
            isAdmin: prevFocused.isAdmin,
          });
        }
      }
      focusState.focusedUserId = null;
      focusState.originalVisibility = null;
    }

    this.broadcastToRoom(context.currentRoomCode, {
      type: "focus",
      targetUserId,
      focusedBy: context.participantId,
    });
  }

  private handleSidebarToggle(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): void {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const sender = room.get(context.participantId);
    if (!sender?.isAdmin) return;

    const isOpen = data.isOpen;

    this.broadcastToRoom(
      context.currentRoomCode,
      {
        type: "sidebarToggle",
        isOpen,
      },
      context.participantId
    );
  }
}
