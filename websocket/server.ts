import { Server } from "http";
import { WebSocketServer as WSServer, WebSocket } from "ws";
import { sessionMiddleware } from "../session";
import { RoomService } from "./services/room.service";
import { ConnectionService } from "./services/connection.service";
import { MessageHandler } from "./handlers";
import { ConnectionContext } from "./types/room.types";

export class WebSocketServer {
  private wss: WSServer;
  private roomService: RoomService;
  private connectionService: ConnectionService;
  private messageHandler: MessageHandler;

  constructor(httpServer: Server) {
    this.wss = new WSServer({ noServer: true });
    this.roomService = new RoomService();
    this.connectionService = new ConnectionService(this.roomService);
    this.messageHandler = new MessageHandler(
      this.roomService,
      this.connectionService
    );

    this.setupServer(httpServer);
    this.setupConnectionHandlers();
  }

  private setupServer(httpServer: Server): void {
    httpServer.on("upgrade", (request, socket, head) => {
      const pathname = new URL(
        request.url || "",
        `http://${request.headers.host}`
      ).pathname;

      if (pathname !== "/ws") {
        return;
      }

      sessionMiddleware(request as any, {} as any, () => {
        const sessionUserId = (request as any).session?.userId;

        this.wss.handleUpgrade(request, socket, head, (ws) => {
          (ws as any).authenticatedUserId = sessionUserId || null;
          (ws as any).isGuest = !sessionUserId;

          this.wss.emit("connection", ws, request);
        });
      });
    });
  }

  private setupConnectionHandlers(): void {
    this.wss.on("connection", (ws: WebSocket) => {
      const context: ConnectionContext = {
        authenticatedUserId: (ws as any).authenticatedUserId,
        isGuest: (ws as any).isGuest,
      };

      ws.on("message", async (data: string) => {
        try {
          const message = JSON.parse(data.toString());
          await this.messageHandler.handle(ws, message, context);
        } catch (error) {
          console.error("WebSocket message error:", error);
        }
      });

      ws.on("close", () => {
        if (context.currentRoomCode && context.participantId) {
          // Flush pending board updates
          const updateKey = `${context.currentRoomCode}:${context.participantId}`;
          const pendingUpdate =
            this.roomService.pendingBoardUpdates.get(updateKey);
          if (pendingUpdate) {
            clearTimeout(pendingUpdate.timer);
            this.roomService.flushBoardUpdate(updateKey);
          }

          const room = this.roomService.getRoom(context.currentRoomCode);
          if (room) {
            const leavingUser = room.get(context.participantId);
            const wasAdmin = leavingUser?.isAdmin || false;
            this.connectionService.handleDisconnect(
              context.currentRoomCode,
              context.participantId,
              wasAdmin
            );
          }
        }
      });
    });
  }

  /**
   * Close the WebSocket server gracefully
   */
  public close(): void {
    console.log("Closing WebSocket server...");

    // Close all active connections
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(1001, "Server shutting down");
      }
    });

    // Close the server
    this.wss.close();

    // Clean up services
    this.cleanup();
  }

  /**
   * Get the number of active connections
   */
  public getConnectionCount(): number {
    return this.wss.clients.size;
  }

  cleanup(): void {
    this.connectionService.cleanup();
  }
}
