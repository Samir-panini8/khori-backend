import { WebSocket } from "ws";
import { BaseHandler } from "./base.handler";
import { ConnectionContext } from "../types/room.types";

export class ChatHandler extends BaseHandler {
  types = ["chatSession", "chatSessionEnded"];

  async handle(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    switch (data.type) {
      case "chatSession":
        await this.handleChatSession(ws, data, context);
        break;
      case "chatSessionEnded":
        await this.handleChatSessionEnded(ws, data, context);
        break;
    }
  }

  private async handleChatSession(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const sender = room.get(context.participantId);
    if (!sender?.isAdmin) return; // Only admins can start chat sessions

    const { session } = data;

    this.broadcastToRoom(
      context.currentRoomCode,
      {
        type: "chatSession",
        session,
      },
      context.participantId
    );
  }

  private async handleChatSessionEnded(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    if (!context.currentRoomCode || !context.participantId) return;

    const room = this.roomService.getRoom(context.currentRoomCode);
    if (!room) return;

    const sender = room.get(context.participantId);
    if (!sender?.isAdmin) return; // Only admins can end chat sessions

    this.broadcastToRoom(
      context.currentRoomCode,
      {
        type: "chatSessionEnded",
      },
      context.participantId
    );
  }
}
