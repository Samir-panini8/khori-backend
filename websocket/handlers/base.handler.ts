import { WebSocket } from "ws";
import { RoomService } from "../services/room.service";
import { ConnectionService } from "../services/connection.service";
import { ConnectionContext } from "../types/room.types";

export abstract class BaseHandler {
  abstract types: string[];

  constructor(
    protected roomService: RoomService,
    protected connectionService: ConnectionService
  ) {}

  abstract handle(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void>;

  protected broadcastToRoom(
    roomCode: string,
    message: any,
    excludeParticipantId?: string
  ): void {
    this.roomService.broadcastToRoom(roomCode, message, excludeParticipantId);
  }
}
