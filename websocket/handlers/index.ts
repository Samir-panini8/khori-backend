import { WebSocket } from "ws";
import { RoomService } from "../services/room.service";
import { ConnectionService } from "../services/connection.service";
import { RoomHandler } from "./room.handler.ts";
import { BoardHandler } from "./board.handler.ts";
import { QuizHandler } from "./quiz.handler.ts";
import { ChatHandler } from "./chat.handler.ts";
import { ConnectionContext } from "../types/room.types";

export class MessageHandler {
  private handlers = new Map<string, any>();

  constructor(
    private roomService: RoomService,
    private connectionService: ConnectionService
  ) {
    this.registerHandlers();
  }

  private registerHandlers(): void {
    const roomHandler = new RoomHandler(
      this.roomService,
      this.connectionService
    );
    const boardHandler = new BoardHandler(
      this.roomService,
      this.connectionService
    );
    const quizHandler = new QuizHandler(
      this.roomService,
      this.connectionService
    );
    const chatHandler = new ChatHandler(
      this.roomService,
      this.connectionService
    );

    // Register all handler types
    roomHandler.types.forEach((type) => this.handlers.set(type, roomHandler));
    boardHandler.types.forEach((type) => this.handlers.set(type, boardHandler));
    quizHandler.types.forEach((type) => this.handlers.set(type, quizHandler));
    chatHandler.types.forEach((type) => this.handlers.set(type, chatHandler));
  }

  async handle(
    ws: WebSocket,
    message: any,
    context: ConnectionContext
  ): Promise<void> {
    const handler = this.handlers.get(message.type);
    if (!handler) {
      console.warn(`No handler for message type: ${message.type}`);
      return;
    }

    await handler.handle(ws, message, context);
  }
}
