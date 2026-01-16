import { WebSocket } from "ws";
import { BaseHandler } from "./base.handler";
import { ConnectionContext } from "../types/room.types";
import { storage } from "../../storage";

export class QuizHandler extends BaseHandler {
  types = [
    "quiz:post",
    "quiz:close",
    "quiz:response",
    "quiz:shareResults",
    "quiz:showLeaderboard",
    "quiz:shareResultsById",
    "quiz:showLeaderboardByQuiz",
    "quiz:showCumulativeLeaderboard",
  ];

  async handle(
    ws: WebSocket,
    data: any,
    context: ConnectionContext
  ): Promise<void> {
    // Implement quiz handlers here
    // This would be similar to your existing quiz logic
  }
}
