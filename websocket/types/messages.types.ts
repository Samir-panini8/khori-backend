export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

export interface JoinMessage extends WebSocketMessage {
  type: "join";
  roomCode: string;
  user: {
    id: string;
    name: string;
    role: string;
    color: string;
    isPublic: boolean;
  };
}

export interface DrawMessage extends WebSocketMessage {
  type: "draw";
  line: any;
}

export interface QuizPostMessage extends WebSocketMessage {
  type: "quiz:post";
  quizId: string;
  boardId: string;
}

// Add other message types as needed
