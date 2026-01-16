import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import bcrypt from "bcryptjs";
import {
  insertUserSchema,
  insertBoardSchema,
  insertBoardDataSchema,
  insertQuizSchema,
} from "./shared/schema";
import { z } from "zod";
import { WebSocketServer, WebSocket } from "ws";
import { sessionMiddleware } from "./session";
import requireAuth from "./middleware/Authentication";
import { Server } from "http";

// Room participant tracking
interface RoomParticipant {
  id: string;
  name: string;
  role: string;
  color: string;
  joinedAt: number;
  isAdmin: boolean;
  isPublic: boolean;
  ws: WebSocket;
  originalVisibility?: boolean;
  viewingUserId?: string | null; // Track which board this user is viewing (null = own board)
}

const rooms = new Map<string, Map<string, RoomParticipant>>();

// Grace period for disconnections - allows participants to reconnect without being removed
const DISCONNECT_GRACE_PERIOD_MS = 300000; // 5 minutes grace period (devices can go to sleep)
const ADMIN_DISCONNECT_GRACE_PERIOD_MS = 600000; // 10 minutes grace period for admin
const pendingDisconnects = new Map<string, ReturnType<typeof setTimeout>>();

// Per-room focus state tracking
interface RoomFocusState {
  focusedUserId: string | null;
  originalVisibility: boolean | null;
}
const roomFocusState = new Map<string, RoomFocusState>();

// Debounced board data persistence
interface PendingBoardUpdate {
  roomCode: string;
  userId: string;
  userName: string;
  lines: unknown[];
  timer: ReturnType<typeof setTimeout>;
}
const pendingBoardUpdates = new Map<string, PendingBoardUpdate>();
const BOARD_UPDATE_DEBOUNCE_MS = 2000; // 2 second debounce

async function flushBoardUpdate(key: string) {
  const pending = pendingBoardUpdates.get(key);
  if (!pending) return;

  pendingBoardUpdates.delete(key);

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

function scheduleBoardUpdate(
  roomCode: string,
  userId: string,
  userName: string,
  lines: unknown[]
) {
  const key = `${roomCode}:${userId}`;

  // Clear existing timer if any
  const existing = pendingBoardUpdates.get(key);
  if (existing) {
    clearTimeout(existing.timer);
  }

  // Schedule new debounced write
  const timer = setTimeout(
    () => flushBoardUpdate(key),
    BOARD_UPDATE_DEBOUNCE_MS
  );
  pendingBoardUpdates.set(key, { roomCode, userId, userName, lines, timer });
}

// Session user type
declare module "express-session" {
  interface SessionData {
    userId: string;
  }
}

// Middleware to check if user is admin
async function requireAdmin(req: Request, res: Response, next: Function) {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const user = await storage.getUser(req.session.userId);
  if (!user || user.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }

  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Initialize default admin user if not exists
  const adminUser = await storage.getUserByUsername("admin");
  if (!adminUser) {
    const hashedPassword = await bcrypt.hash("admin", 10);
    await storage.createUser({
      username: "admin",
      password: hashedPassword,
      role: "admin",
    });
  }

  // ========== Authentication Routes ==========

  // Check session
  app.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
        screenName: user.screenName,
      });
    } catch (error) {
      console.error("Get user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== User Management Routes (Admin only) ==========

  // Get all users
  app.get("/api/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const users = await storage.getAllUsers();
      res.json(
        users.map((u) => ({
          id: u.id,
          username: u.username,
          role: u.role,
          screenName: u.screenName,
        }))
      );
    } catch (error) {
      console.error("Get users error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Delete user (admin only)
  app.delete(
    "/api/users/:id",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        if (user.role === "admin") {
          return res.status(403).json({ error: "Cannot delete admin user" });
        }

        await storage.deleteUser(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete user error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Update user screen name (admin only)
  app.patch(
    "/api/users/:id/screen-name",
    requireAdmin,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.params.id);
        if (!user) {
          return res.status(404).json({ error: "User not found" });
        }

        const { screenName } = req.body;
        await storage.updateUserScreenName(req.params.id, screenName || null);
        res.json({ success: true, screenName: screenName || null });
      } catch (error) {
        console.error("Update screen name error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Create user (teacher)
  app.post("/api/users", requireAdmin, async (req: Request, res: Response) => {
    try {
      const validatedData = insertUserSchema.parse(req.body);

      // Check if user already exists
      const existingUser = await storage.getUserByUsername(
        validatedData.username
      );
      if (existingUser) {
        return res.status(400).json({ error: "Username already exists" });
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(validatedData.password, 10);

      const user = await storage.createUser({
        ...validatedData,
        password: hashedPassword,
        role: validatedData.role || "teacher",
      });

      res.json({
        id: user.id,
        username: user.username,
        role: user.role,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create user error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== Board Routes ==========

  // Get all boards (for current user or all if admin)
  app.get("/api/boards", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      let allBoards;

      if (user?.role === "admin") {
        allBoards = await storage.getAllBoards();
      } else {
        // Get boards where user is creator OR lecturer
        const createdBoards = await storage.getBoardsByCreator(
          req.session.userId!
        );
        const lecturerBoards = await storage.getBoardsByLecturer(
          req.session.userId!
        );

        // Merge and deduplicate by board id
        const boardMap = new Map();
        [...createdBoards, ...lecturerBoards].forEach((board) => {
          boardMap.set(board.id, board);
        });
        allBoards = Array.from(boardMap.values());
      }

      res.json(allBoards);
    } catch (error) {
      console.error("Get boards error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create board
  // Generate a unique 9-character alphanumeric code
  function generateRoomCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Excluding confusing chars like 0, O, 1, I
    let code = "";
    for (let i = 0; i < 9; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  app.post("/api/boards", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.role === "student") {
        return res.status(403).json({ error: "Students cannot create boards" });
      }

      // Generate unique room code
      let roomCode = generateRoomCode();
      let attempts = 0;
      while ((await storage.getBoardByRoomCode(roomCode)) && attempts < 10) {
        roomCode = generateRoomCode();
        attempts++;
      }

      // Admin can assign a lecturer, otherwise creator is lecturer
      let lecturerId = req.session.userId;
      if (user.role === "admin" && req.body.lecturerId) {
        // Verify the lecturer exists and is a teacher
        const lecturerIdStr = String(req.body.lecturerId);
        const lecturer = await storage.getUser(lecturerIdStr);
        if (
          lecturer &&
          (lecturer.role === "teacher" || lecturer.role === "admin")
        ) {
          lecturerId = lecturerIdStr;
        }
      }

      const validatedData = insertBoardSchema.parse({
        ...req.body,
        roomCode,
        creatorId: req.session.userId,
        lecturerId,
      });

      const board = await storage.createBoard(validatedData);
      res.json(board);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create board error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get board by room code
  app.get(
    "/api/boards/:roomCode",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoardByRoomCode(req.params.roomCode);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        res.json(board);
      } catch (error) {
        console.error("Get board error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get board info by ID or room code (public - for guest access)
  app.get("/api/join/:boardIdOrCode", async (req: Request, res: Response) => {
    try {
      const param = req.params.boardIdOrCode;

      console.log(param);
      // Try to find by room code first (if it looks like a room code - 9 chars alphanumeric)
      // Then fall back to UUID lookup
      let board = await storage.getBoardByRoomCode(param);
      if (!board) {
        console.log(board);
        board = await storage.getBoard(param);
      }

      if (!board) {
        console.log(board);
        return res.status(404).json({ error: "Board not found" });
      }

      console.log(board);

      // Return limited info for guest access
      res.json({
        id: board.id,
        roomCode: board.roomCode,
        hasPassword: !!board.password,
        isPublic: board.isPublic,
        isEnded: board.isEnded,
        accessType: board.accessType,
      });
    } catch (error) {
      console.error("Get board for guest error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Validate password for guest access (no auth required)
  app.post(
    "/api/join/:boardIdOrCode/validate-password",
    async (req: Request, res: Response) => {
      try {
        const param = req.params.boardIdOrCode;
        let board = await storage.getBoardByRoomCode(param);
        if (!board) {
          board = await storage.getBoard(param);
        }

        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        if (!board.password) {
          return res.json({ valid: true });
        }

        const { password } = req.body;
        const valid = password === board.password;
        res.json({ valid });
      } catch (error) {
        console.error("Validate guest password error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Update board (creator only)
  app.patch(
    "/api/boards/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoard(req.params.id);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        // Only creator or lecturer can update board
        const isCreatorOrLecturer =
          board.creatorId === req.session.userId ||
          board.lecturerId === req.session.userId;
        if (!isCreatorOrLecturer) {
          return res
            .status(403)
            .json({ error: "Only board creator or lecturer can update" });
        }

        const updatedBoard = await storage.updateBoard(req.params.id, req.body);
        res.json(updatedBoard);
      } catch (error) {
        console.error("Update board error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Delete board (creator or admin only)
  app.delete(
    "/api/boards/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoard(req.params.id);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        const user = await storage.getUser(req.session.userId!);
        if (board.creatorId !== req.session.userId && user?.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Not authorized to delete this board" });
        }

        await storage.deleteBoard(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete board error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Board Data Routes ==========

  // Save board data
  app.post(
    "/api/board-data",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const validatedData = insertBoardDataSchema.parse(req.body);

        // Verify board exists
        const board = await storage.getBoard(validatedData.boardId);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        const data = await storage.upsertBoardData(validatedData);
        res.json(data);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return res.status(400).json({ error: error.errors });
        }
        console.error("Save board data error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get all board data for a board
  app.get(
    "/api/board-data/:boardId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoard(req.params.boardId);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        const data = await storage.getAllBoardData(req.params.boardId);
        res.json(data);
      } catch (error) {
        console.error("Get board data error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get specific user's board data
  app.get(
    "/api/board-data/:boardId/:userId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const data = await storage.getBoardData(
          req.params.boardId,
          req.params.userId
        );
        if (!data) {
          return res.json({
            boardId: req.params.boardId,
            userId: req.params.userId,
            linesData: [],
          });
        }

        res.json(data);
      } catch (error) {
        console.error("Get user board data error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get all teachers (for admin to select lecturer)
  app.get("/api/teachers", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || user.role !== "admin") {
        return res
          .status(403)
          .json({ error: "Only admins can view teachers list" });
      }

      const allUsers = await storage.getAllUsers();
      const teachers = allUsers.filter((u) => u.role === "teacher");
      res.json(
        teachers.map((t) => ({
          id: t.id,
          username: t.username,
          screenName: t.screenName,
        }))
      );
    } catch (error) {
      console.error("Get teachers error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ========== Quiz Library Routes ==========

  // Get quizzes for current user (teachers/admins)
  app.get("/api/quizzes", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "teacher")) {
        return res
          .status(403)
          .json({ error: "Only teachers and admins can access quiz library" });
      }

      const quizzes = await storage.getQuizzesByCreator(req.session.userId!);
      res.json(quizzes);
    } catch (error) {
      console.error("Get quizzes error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create quiz
  app.post("/api/quizzes", requireAuth, async (req: Request, res: Response) => {
    try {
      const user = await storage.getUser(req.session.userId!);
      if (!user || (user.role !== "admin" && user.role !== "teacher")) {
        return res
          .status(403)
          .json({ error: "Only teachers and admins can create quizzes" });
      }

      const validatedData = insertQuizSchema.parse({
        ...req.body,
        creatorId: req.session.userId,
      });

      const quiz = await storage.createQuiz(validatedData);
      res.json(quiz);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create quiz error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update quiz
  app.patch(
    "/api/quizzes/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const quiz = await storage.getQuiz(req.params.id);
        if (!quiz) {
          return res.status(404).json({ error: "Quiz not found" });
        }

        const user = await storage.getUser(req.session.userId!);
        if (quiz.creatorId !== req.session.userId && user?.role !== "admin") {
          return res.status(403).json({ error: "Not authorized" });
        }

        const updated = await storage.updateQuiz(req.params.id, req.body);
        res.json(updated);
      } catch (error) {
        console.error("Update quiz error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Delete quiz
  app.delete(
    "/api/quizzes/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const quiz = await storage.getQuiz(req.params.id);
        if (!quiz) {
          return res.status(404).json({ error: "Quiz not found" });
        }

        const user = await storage.getUser(req.session.userId!);
        if (quiz.creatorId !== req.session.userId && user?.role !== "admin") {
          return res.status(403).json({ error: "Not authorized" });
        }

        await storage.deleteQuiz(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete quiz error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get quiz session for a board
  app.get(
    "/api/boards/:boardId/quiz-session",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = await storage.getActiveQuizSession(req.params.boardId);
        if (!session) {
          return res.json(null);
        }

        const quiz = await storage.getQuiz(session.quizId);
        res.json({ session, quiz });
      } catch (error) {
        console.error("Get quiz session error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get quiz responses for a session (admin only)
  app.get(
    "/api/quiz-sessions/:sessionId/responses",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res.status(403).json({ error: "Admin access required" });
        }

        const responses = await storage.getQuizResponses(req.params.sessionId);
        res.json(responses);
      } catch (error) {
        console.error("Get quiz responses error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get quiz responses by quiz ID (admin/teacher only), optionally filtered by boardId
  app.get(
    "/api/quizzes/:id/responses",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || (user.role !== "admin" && user.role !== "teacher")) {
          return res.status(403).json({ error: "Access required" });
        }

        const boardId = req.query.boardId as string | undefined;
        const responses = await storage.getQuizResponsesByQuizIdAndBoard(
          req.params.id,
          boardId
        );
        res.json(responses);
      } catch (error) {
        console.error("Get quiz responses by quiz ID error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Quiz Category Routes ==========

  app.get(
    "/api/quiz-categories",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const categories = await storage.getQuizCategories();
        res.json(categories);
      } catch (error) {
        console.error("Get quiz categories error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.post(
    "/api/quiz-categories",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can create categories" });
        }
        const { name } = req.body;
        if (!name?.trim()) {
          return res.status(400).json({ error: "Name is required" });
        }
        const category = await storage.createQuizCategory({
          name: name.trim(),
        });
        res.json(category);
      } catch (error) {
        console.error("Create quiz category error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.patch(
    "/api/quiz-categories/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can edit categories" });
        }
        const { name } = req.body;
        if (!name?.trim()) {
          return res.status(400).json({ error: "Name is required" });
        }
        const category = await storage.updateQuizCategory(
          req.params.id,
          name.trim()
        );
        res.json(category);
      } catch (error) {
        console.error("Update quiz category error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.delete(
    "/api/quiz-categories/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can delete categories" });
        }
        await storage.deleteQuizCategory(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete quiz category error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Quiz Class Routes ==========

  app.get(
    "/api/quiz-classes",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const classes = await storage.getQuizClasses();
        res.json(classes);
      } catch (error) {
        console.error("Get quiz classes error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.post(
    "/api/quiz-classes",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can create classes" });
        }
        const { name } = req.body;
        if (!name?.trim()) {
          return res.status(400).json({ error: "Name is required" });
        }
        const quizClass = await storage.createQuizClass({ name: name.trim() });
        res.json(quizClass);
      } catch (error) {
        console.error("Create quiz class error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.patch(
    "/api/quiz-classes/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can edit classes" });
        }
        const { name } = req.body;
        if (!name?.trim()) {
          return res.status(400).json({ error: "Name is required" });
        }
        const quizClass = await storage.updateQuizClass(
          req.params.id,
          name.trim()
        );
        res.json(quizClass);
      } catch (error) {
        console.error("Update quiz class error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  app.delete(
    "/api/quiz-classes/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user || user.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can delete classes" });
        }
        await storage.deleteQuizClass(req.params.id);
        res.json({ success: true });
      } catch (error) {
        console.error("Delete quiz class error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Student Performance Routes ==========

  // Get student's attendance records
  app.get(
    "/api/student-performance/attendance",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        const studentId =
          (req.query.studentId as string) || req.session.userId!;

        if (studentId !== req.session.userId && user?.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Not authorized to view other student's data" });
        }

        const attendance = await storage.getStudentAttendance(studentId);
        // Get board info for each attendance record
        const attendanceWithBoards = await Promise.all(
          attendance.map(async (record) => {
            const board = await storage.getBoard(record.boardId);
            return {
              ...record,
              roomCode: board?.roomCode,
              boardStartTime: board?.startTime,
            };
          })
        );
        res.json(attendanceWithBoards);
      } catch (error) {
        console.error("Get student attendance error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Get student's quiz responses with quiz details
  app.get(
    "/api/student-performance/quizzes",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        const studentId =
          (req.query.studentId as string) || req.session.userId!;

        if (studentId !== req.session.userId && user?.role !== "admin") {
          return res
            .status(403)
            .json({ error: "Not authorized to view other student's data" });
        }

        const responses = await storage.getStudentQuizResponses(studentId);
        // Get quiz and session details for each response
        const responsesWithDetails = await Promise.all(
          responses.map(async (response) => {
            const session = await storage.getQuizSession(response.sessionId);
            if (!session) return null;
            const quiz = await storage.getQuiz(session.quizId);
            const board = await storage.getBoard(session.boardId);
            return {
              ...response,
              questionText: quiz?.questionText,
              questionType: quiz?.questionType,
              correctAnswer: quiz?.correctAnswer,
              categoryId: quiz?.categoryId,
              classId: quiz?.classId,
              roomCode: board?.roomCode,
              boardId: session.boardId,
            };
          })
        );
        res.json(responsesWithDetails.filter(Boolean));
      } catch (error) {
        console.error("Get student quiz responses error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Record student joining a room (called when student enters a board)
  app.post(
    "/api/student-performance/attendance",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { boardId } = req.body;
        if (!boardId) {
          return res.status(400).json({ error: "Board ID is required" });
        }

        // Check if there's already an active attendance for this board
        const existing = await storage.getActiveAttendance(
          boardId,
          req.session.userId!
        );
        if (existing && !existing.leftAt) {
          return res.json(existing);
        }

        const attendance = await storage.createStudentAttendance({
          boardId,
          studentId: req.session.userId!,
          joinedAt: new Date(),
        });
        res.json(attendance);
      } catch (error) {
        console.error("Record student attendance error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Update attendance when student leaves
  app.patch(
    "/api/student-performance/attendance/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { timeSpentSeconds } = req.body;
        const attendance = await storage.updateStudentAttendance(
          req.params.id,
          {
            leftAt: new Date(),
            timeSpentSeconds: timeSpentSeconds || 0,
          }
        );
        res.json(attendance);
      } catch (error) {
        console.error("Update student attendance error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Teacher Performance Routes ==========

  // Get teacher performance data (for admin or self)
  app.get(
    "/api/teacher-performance/:teacherId",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const user = await storage.getUser(req.session.userId!);
        if (!user) {
          return res.status(401).json({ error: "Not authenticated" });
        }

        // Only admin or the teacher themselves can view performance
        if (
          user.role !== "admin" &&
          req.params.teacherId !== req.session.userId
        ) {
          return res.status(403).json({ error: "Not authorized" });
        }

        const teacherId = req.params.teacherId;
        const teacher = await storage.getUser(teacherId);
        if (
          !teacher ||
          (teacher.role !== "teacher" && teacher.role !== "admin")
        ) {
          return res.status(404).json({ error: "Teacher not found" });
        }

        // Get all boards where teacher is lecturer (or created by them if no lecturerId set)
        const lecturerBoards = await storage.getBoardsByLecturer(teacherId);
        const creatorBoards = await storage.getBoardsByCreator(teacherId);
        // Combine and deduplicate
        const boardMap = new Map<string, (typeof creatorBoards)[0]>();
        for (const b of creatorBoards) {
          if (!b.lecturerId || b.lecturerId === teacherId) {
            boardMap.set(b.id, b);
          }
        }
        for (const b of lecturerBoards) {
          boardMap.set(b.id, b);
        }
        const boards = Array.from(boardMap.values());

        // Get teacher attendance records
        const teacherAttendance = await storage.getTeacherAttendance(teacherId);

        // Build performance data for each board
        const performanceData = await Promise.all(
          boards.map(async (board) => {
            // Get students who joined this room
            const studentAttendance = await storage.getStudentAttendanceByBoard(
              board.id
            );
            const uniqueStudents = Array.from(
              new Set(studentAttendance.map((a) => a.studentId))
            );

            // Get quiz sessions for this board
            const quizSessions = await storage.getQuizSessionsByBoard(board.id);
            const quizCount = quizSessions.length;

            // Get all quiz responses for this board
            let totalQuizResponses = 0;
            let studentsWhoAttemptedQuiz = new Set<string>();
            for (const session of quizSessions) {
              const responses = await storage.getQuizResponses(session.id);
              totalQuizResponses += responses.length;
              responses.forEach((r) =>
                studentsWhoAttemptedQuiz.add(r.participantId)
              );
            }

            // Get board data to check two-way board work
            const allBoardData = await storage.getAllBoardData(board.id);
            const teacherBoardData = allBoardData.find(
              (bd) => bd.userId === teacherId
            );
            const teacherHasWritten =
              teacherBoardData &&
              Array.isArray(teacherBoardData.linesData) &&
              (teacherBoardData.linesData as unknown[]).length > 0;

            // Count students with two-way board work (both teacher and student wrote on student's subboard)
            let twoWayBoardWorkCount = 0;
            for (const studentId of uniqueStudents) {
              const studentBoardData = allBoardData.find(
                (bd) => bd.userId === studentId
              );
              const studentHasWritten =
                studentBoardData &&
                Array.isArray(studentBoardData.linesData) &&
                (studentBoardData.linesData as unknown[]).length > 0;

              // For two-way work, we need the teacher to have interacted with student's board
              // In a multiboard setup, we check if both teacher and student have board data
              if (studentHasWritten && teacherHasWritten) {
                twoWayBoardWorkCount++;
              }
            }

            // Calculate participation score
            const studentCount = uniqueStudents.length;
            let quizScore = 0;
            let twoWayScore = 0;

            if (studentCount > 0 && quizCount > 0) {
              quizScore = Math.round(
                (studentsWhoAttemptedQuiz.size / studentCount) * 50
              );
            }
            if (studentCount > 0) {
              twoWayScore = Math.round(
                (twoWayBoardWorkCount / studentCount) * 50
              );
            }

            const participationScore = quizScore + twoWayScore;

            // Get teacher duration for this board
            const teacherAttendanceForBoard = teacherAttendance.filter(
              (a) => a.boardId === board.id
            );
            const totalDuration = teacherAttendanceForBoard.reduce(
              (sum, a) => sum + (a.timeSpentSeconds || 0),
              0
            );

            return {
              boardId: board.id,
              roomCode: board.roomCode,
              title: board.title,
              createdAt: board.startTime,
              endTime: board.endTime,
              isEnded: board.isEnded,
              duration: totalDuration,
              studentCount,
              quizCount,
              studentsWhoAttemptedQuiz: studentsWhoAttemptedQuiz.size,
              twoWayBoardWorkCount,
              quizScore,
              twoWayScore,
              participationScore,
            };
          })
        );

        res.json({
          teacher: {
            id: teacher.id,
            username: teacher.username,
            screenName: teacher.screenName,
          },
          boards: performanceData,
        });
      } catch (error) {
        console.error("Get teacher performance error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Record teacher joining a room
  app.post(
    "/api/teacher-performance/attendance",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { boardId } = req.body;
        if (!boardId) {
          return res.status(400).json({ error: "Board ID is required" });
        }

        const user = await storage.getUser(req.session.userId!);
        if (!user || (user.role !== "teacher" && user.role !== "admin")) {
          return res
            .status(403)
            .json({ error: "Only teachers can record attendance" });
        }

        // Check if there's already an active attendance for this board
        const existing = await storage.getActiveTeacherAttendance(
          boardId,
          req.session.userId!
        );
        if (existing && !existing.leftAt) {
          return res.json(existing);
        }

        const attendance = await storage.createTeacherAttendance({
          boardId,
          teacherId: req.session.userId!,
          joinedAt: new Date(),
        });
        res.json(attendance);
      } catch (error) {
        console.error("Record teacher attendance error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Update teacher attendance when leaving
  app.patch(
    "/api/teacher-performance/attendance/:id",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { timeSpentSeconds } = req.body;
        const attendance = await storage.updateTeacherAttendance(
          req.params.id,
          {
            leftAt: new Date(),
            timeSpentSeconds: timeSpentSeconds || 0,
          }
        );
        res.json(attendance);
      } catch (error) {
        console.error("Update teacher attendance error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Room Password Routes ==========

  // Update room password (creator only)
  app.post(
    "/api/boards/:roomCode/password",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoardByRoomCode(req.params.roomCode);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        const isCreatorOrLecturer =
          board.creatorId === req.session.userId ||
          board.lecturerId === req.session.userId;
        if (!isCreatorOrLecturer) {
          return res
            .status(403)
            .json({ error: "Only board creator or lecturer can set password" });
        }

        const { password } = req.body;
        const updatedBoard = await storage.updateBoard(board.id, {
          password: password || null,
          isPublic: !password,
        });
        res.json({ success: true, hasPassword: !!password });
      } catch (error) {
        console.error("Set password error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Validate room password
  app.post(
    "/api/boards/:roomCode/validate-password",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoardByRoomCode(req.params.roomCode);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        // If no password set, allow access
        if (!board.password) {
          return res.json({ valid: true, hasPassword: false });
        }

        // Check if user is the creator or lecturer (bypass password)
        const isCreatorOrLecturer =
          board.creatorId === req.session.userId ||
          board.lecturerId === req.session.userId;
        if (isCreatorOrLecturer) {
          return res.json({ valid: true, isCreator: true });
        }

        const { password } = req.body;
        if (password === board.password) {
          return res.json({ valid: true });
        }

        res.json({ valid: false, hasPassword: true });
      } catch (error) {
        console.error("Validate password error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Check if room has password (authenticated)
  app.get(
    "/api/boards/:roomCode/has-password",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoardByRoomCode(req.params.roomCode);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        // Get lecturer info if set
        const lecturerId = board.lecturerId || board.creatorId;
        let lecturerName = "";
        if (lecturerId) {
          const lecturer = await storage.getUser(lecturerId);
          lecturerName = lecturer?.screenName || lecturer?.username || "";
        }

        // Creator or lecturer always has access
        const isCreator = board.creatorId === req.session.userId;
        const isLecturer = board.lecturerId === req.session.userId;
        res.json({
          boardId: board.id,
          hasPassword: !!board.password,
          isCreator: isCreator || isLecturer,
          isPublic: board.isPublic,
          title: board.title || "",
          lecturerName,
        });
      } catch (error) {
        console.error("Check password error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // Public board info for guests (no auth required)
  app.get(
    "/api/boards/:roomCode/public-info",
    async (req: Request, res: Response) => {
      try {
        const board = await storage.getBoardByRoomCode(req.params.roomCode);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        // Get lecturer info if set
        const lecturerId = board.lecturerId || board.creatorId;
        let lecturerName = "";
        if (lecturerId) {
          const lecturer = await storage.getUser(lecturerId);
          lecturerName = lecturer?.screenName || lecturer?.username || "";
        }

        // Only return public boards or boards that allow guest access
        res.json({
          boardId: board.id,
          hasPassword: !!board.password,
          isCreator: false,
          isPublic: board.isPublic,
          title: board.title || "",
          lecturerName,
        });
      } catch (error) {
        console.error("Public info error:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  );

  // ========== Audio Recording Routes ==========

  // Start a new recording
  app.post(
    "/api/audio/start",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { boardId } = req.body;

        if (!boardId) {
          return res.status(400).json({ error: "Board ID is required" });
        }

        const board = await storage.getBoard(boardId);
        if (!board) {
          return res.status(404).json({ error: "Board not found" });
        }

        // Check if user is the board creator or lecturer
        const isCreator = board.creatorId === req.session.userId;
        const isLecturer = board.lecturerId === req.session.userId;
        if (!isCreator && !isLecturer) {
          return res
            .status(403)
            .json({ error: "Only the lecturer can record" });
        }

        // Check if there's already an active recording
        const existingRecording = await storage.getActiveRecording(boardId);
        if (existingRecording) {
          return res
            .status(400)
            .json({ error: "A recording is already in progress" });
        }

        const recording = await storage.createLectureRecording({
          boardId,
          lecturerId: req.session.userId!,
          status: "recording",
        });

        res.json(recording);
      } catch (error) {
        console.error("Start recording error:", error);
        res.status(500).json({ error: "Failed to start recording" });
      }
    }
  );

  // Stop recording and transcribe
  app.post(
    "/api/audio/stop",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { recordingId, audioData, durationMs } = req.body;

        if (!recordingId || !audioData) {
          return res
            .status(400)
            .json({ error: "Recording ID and audio data are required" });
        }

        const recording = await storage.getLectureRecording(recordingId);
        if (!recording) {
          return res.status(404).json({ error: "Recording not found" });
        }

        // Check if user owns this recording
        if (recording.lecturerId !== req.session.userId) {
          return res.status(403).json({ error: "Not authorized" });
        }

        // Update recording with audio data
        await storage.updateLectureRecording(recordingId, {
          status: "completed",
          audioData: audioData,
          durationMs: durationMs || 0,
          endedAt: new Date(),
        });

        // Transcribe the audio using Gemini
        let transcriptText = "";
        try {
          const { transcribeAudio } = await import(
            "./replit_integrations/audio"
          );
          transcriptText = await transcribeAudio(audioData);
        } catch (transcriptionError) {
          console.error("Transcription error:", transcriptionError);
          transcriptText = "[Transcription failed - audio was saved]";
        }

        // Save the transcript
        const transcript = await storage.createLectureTranscript({
          recordingId,
          transcriptText,
        });

        // Update recording status to transcribed
        await storage.updateLectureRecording(recordingId, {
          status: "transcribed",
        });

        res.json({ recording, transcript });
      } catch (error) {
        console.error("Stop recording error:", error);
        res.status(500).json({ error: "Failed to stop recording" });
      }
    }
  );

  // Get recordings for a board
  app.get(
    "/api/boards/:boardId/recordings",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const recordings = await storage.getRecordingsByBoard(
          req.params.boardId
        );
        res.json(recordings);
      } catch (error) {
        console.error("Get recordings error:", error);
        res.status(500).json({ error: "Failed to get recordings" });
      }
    }
  );

  // Get transcript for a recording
  app.get(
    "/api/recordings/:recordingId/transcript",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const transcript = await storage.getTranscriptByRecording(
          req.params.recordingId
        );
        if (!transcript) {
          return res.status(404).json({ error: "Transcript not found" });
        }
        res.json(transcript);
      } catch (error) {
        console.error("Get transcript error:", error);
        res.status(500).json({ error: "Failed to get transcript" });
      }
    }
  );

  // ========== AI Chat Session Routes ==========

  // Create a new chat session (admin only)
  app.post(
    "/api/chat/sessions",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { boardId, transcriptId, boardImageData, timerSeconds, context } =
          req.body;

        if (!boardId || !timerSeconds) {
          return res
            .status(400)
            .json({ error: "Board ID and timer are required" });
        }

        const session = await storage.createAiChatSession({
          boardId,
          transcriptId: transcriptId || null,
          boardImageData: boardImageData || null,
          context: context || null,
          createdBy: req.session.userId!,
          status: "draft",
          timerSeconds,
        });

        res.json(session);
      } catch (error) {
        console.error("Create chat session error:", error);
        res.status(500).json({ error: "Failed to create chat session" });
      }
    }
  );

  // Start a chat session (admin only)
  app.put(
    "/api/chat/sessions/:id/start",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const session = await storage.getAiChatSession(req.params.id);
        if (!session) {
          return res.status(404).json({ error: "Session not found" });
        }

        if (session.createdBy !== req.session.userId) {
          return res.status(403).json({ error: "Not authorized" });
        }

        const updated = await storage.updateAiChatSession(req.params.id, {
          status: "active",
          startedAt: new Date(),
        });

        res.json(updated);
      } catch (error) {
        console.error("Start chat session error:", error);
        res.status(500).json({ error: "Failed to start chat session" });
      }
    }
  );

  // Get active chat session for a board
  app.get(
    "/api/boards/:boardId/chat/active",
    async (req: Request, res: Response) => {
      try {
        const session = await storage.getActiveAiChatSession(
          req.params.boardId
        );
        if (!session) {
          return res.json(null);
        }
        res.json(session);
      } catch (error) {
        console.error("Get active chat session error:", error);
        res.status(500).json({ error: "Failed to get active chat session" });
      }
    }
  );

  // Get all chat sessions for a board
  app.get(
    "/api/boards/:boardId/chat/sessions",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const sessions = await storage.getAiChatSessionsByBoard(
          req.params.boardId
        );
        res.json(sessions);
      } catch (error) {
        console.error("Get chat sessions error:", error);
        res.status(500).json({ error: "Failed to get chat sessions" });
      }
    }
  );

  // Get participants for a chat session (admin)
  app.get(
    "/api/chat/sessions/:sessionId/participants",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const participants = await storage.getAiChatParticipants(
          req.params.sessionId
        );
        res.json(participants);
      } catch (error) {
        console.error("Get chat participants error:", error);
        res.status(500).json({ error: "Failed to get participants" });
      }
    }
  );

  // Join a chat session (student)
  app.post(
    "/api/chat/sessions/:sessionId/join",
    async (req: Request, res: Response) => {
      try {
        const { participantId, participantName } = req.body;

        if (!participantId || !participantName) {
          return res
            .status(400)
            .json({ error: "Participant ID and name are required" });
        }

        // Check if already joined
        const existing = await storage.getAiChatParticipant(
          req.params.sessionId,
          participantId
        );
        if (existing) {
          return res.json(existing);
        }

        const participant = await storage.createAiChatParticipant({
          sessionId: req.params.sessionId,
          participantId,
          participantName,
          status: "started",
          startedAt: new Date(),
        });

        res.json(participant);
      } catch (error) {
        console.error("Join chat session error:", error);
        res.status(500).json({ error: "Failed to join chat session" });
      }
    }
  );

  // Send message and get AI response (student)
  app.post(
    "/api/chat/sessions/:sessionId/message",
    async (req: Request, res: Response) => {
      try {
        const { participantId, content } = req.body;
        const { sessionId } = req.params;

        if (!participantId || !content) {
          return res
            .status(400)
            .json({ error: "Participant ID and content are required" });
        }

        // Get session with transcript context
        const session = await storage.getAiChatSession(sessionId);
        if (!session) {
          return res.status(404).json({ error: "Session not found" });
        }

        // Save user message
        await storage.createAiChatMessage({
          sessionId,
          participantId,
          role: "user",
          content,
        });

        // Get conversation history
        const messages = await storage.getAiChatMessages(
          sessionId,
          participantId
        );

        // Set up SSE for streaming
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        try {
          const { GoogleGenAI } = await import("@google/genai");
          const ai = new GoogleGenAI({
            apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
            httpOptions: {
              apiVersion: "",
              baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
            },
          });

          // Build chat messages - use board image if available, fall back to transcript
          let chatMessages: Array<{
            role: "user" | "model";
            parts: Array<{
              text?: string;
              inlineData?: { mimeType: string; data: string };
            }>;
          }> = [];

          if (session.boardImageData) {
            // Use board image with Gemini vision
            // Detect MIME type from data URL
            const mimeMatch = session.boardImageData.match(
              /^data:(image\/\w+);base64,/
            );
            const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
            const base64Data = session.boardImageData.replace(
              /^data:image\/\w+;base64,/,
              ""
            );

            // Build the prompt with context if available
            const contextInfo = session.context
              ? `\n\nAdditional context from the teacher: ${session.context}`
              : "";
            const systemPrompt = `You are an interactive teaching assistant helping students learn and verify their understanding of the material taught on the whiteboard. Study the whiteboard image carefully.${contextInfo}

Your role is to:
1. Ask students questions about the material on the board to check their understanding
2. Start by asking a simple question about what they see or understand from the board
3. If they answer correctly, praise them and ask a follow-up question to go deeper
4. If they answer incorrectly or are unsure, give hints and guide them to the correct understanding
5. Be encouraging, supportive, and adapt your questions to their level
6. Keep responses conversational and concise
7. Focus on key concepts visible on the board

Begin by greeting the student and asking your first question about the material on the whiteboard.`;

            chatMessages = [
              {
                role: "user" as const,
                parts: [
                  { text: systemPrompt },
                  { inlineData: { mimeType, data: base64Data } },
                ],
              },
              {
                role: "model" as const,
                parts: [
                  {
                    text: "Hi there! I can see the whiteboard from today's lesson. Let me ask you a quick question to check your understanding...",
                  },
                ],
              },
              ...messages.map((m) => ({
                role: (m.role === "user" ? "user" : "model") as
                  | "user"
                  | "model",
                parts: [{ text: m.content }],
              })),
            ];
          } else if (session.transcriptId) {
            // Fall back to transcript if available
            const transcript = await storage.getTranscriptByRecording(
              session.transcriptId
            );
            const transcriptContext = transcript?.transcriptText || "";
            const systemPrompt = transcriptContext
              ? `You are a helpful teaching assistant. The following is a transcript of the lecture that was just given:\n\n${transcriptContext}\n\nHelp the student understand the lecture content by answering their questions. Be supportive and encouraging. Keep responses concise but helpful.`
              : `You are a helpful teaching assistant. Help the student understand the subject matter by answering their questions. Be supportive and encouraging. Keep responses concise but helpful.`;

            chatMessages = [
              { role: "user" as const, parts: [{ text: systemPrompt }] },
              {
                role: "model" as const,
                parts: [
                  {
                    text: "I understand. I'll help students understand the lecture content. How can I assist you?",
                  },
                ],
              },
              ...messages.map((m) => ({
                role: (m.role === "user" ? "user" : "model") as
                  | "user"
                  | "model",
                parts: [{ text: m.content }],
              })),
            ];
          } else {
            // No context available
            chatMessages = [
              {
                role: "user" as const,
                parts: [
                  {
                    text: "You are a helpful teaching assistant. Help the student understand the subject matter by answering their questions. Be supportive and encouraging. Keep responses concise but helpful.",
                  },
                ],
              },
              {
                role: "model" as const,
                parts: [
                  {
                    text: "I understand. I'll help students with their questions. How can I assist you?",
                  },
                ],
              },
              ...messages.map((m) => ({
                role: (m.role === "user" ? "user" : "model") as
                  | "user"
                  | "model",
                parts: [{ text: m.content }],
              })),
            ];
          }

          const stream = await ai.models.generateContentStream({
            model: "gemini-2.5-flash",
            contents: chatMessages,
          });

          let fullResponse = "";

          for await (const chunk of stream) {
            const text = chunk.text || "";
            if (text) {
              fullResponse += text;
              res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
            }
          }

          // Save assistant message
          await storage.createAiChatMessage({
            sessionId,
            participantId,
            role: "assistant",
            content: fullResponse,
          });

          res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          res.end();
        } catch (aiError) {
          console.error("AI response error:", aiError);
          res.write(
            `data: ${JSON.stringify({
              error: "Failed to get AI response",
            })}\n\n`
          );
          res.end();
        }
      } catch (error) {
        console.error("Send chat message error:", error);
        if (res.headersSent) {
          res.write(
            `data: ${JSON.stringify({ error: "Failed to send message" })}\n\n`
          );
          res.end();
        } else {
          res.status(500).json({ error: "Failed to send message" });
        }
      }
    }
  );

  // Get chat messages for a participant
  app.get(
    "/api/chat/sessions/:sessionId/participants/:participantId/messages",
    async (req: Request, res: Response) => {
      try {
        const messages = await storage.getAiChatMessages(
          req.params.sessionId,
          req.params.participantId
        );
        res.json(messages);
      } catch (error) {
        console.error("Get chat messages error:", error);
        res.status(500).json({ error: "Failed to get messages" });
      }
    }
  );

  // Complete a chat session
  app.put(
    "/api/chat/sessions/:id/complete",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const updated = await storage.updateAiChatSession(req.params.id, {
          status: "completed",
        });

        res.json(updated);
      } catch (error) {
        console.error("Complete chat session error:", error);
        res.status(500).json({ error: "Failed to complete chat session" });
      }
    }
  );

  // Calculate understanding score for a participant
  app.post(
    "/api/chat/sessions/:sessionId/participants/:participantRowId/score",
    requireAuth,
    async (req: Request, res: Response) => {
      try {
        const { sessionId, participantRowId } = req.params;

        // Look up the participant record by row ID to get the user's participantId
        const participant = await storage.getAiChatParticipantById(
          participantRowId
        );
        if (!participant) {
          return res.status(404).json({ error: "Participant not found" });
        }

        // Get all messages for this participant (using the user's participantId)
        const messages = await storage.getAiChatMessages(
          sessionId,
          participant.participantId
        );

        if (messages.length === 0) {
          // No messages - score is 0
          await storage.updateAiChatParticipant(participantRowId, {
            status: "completed",
            score: 0,
          } as any);
          return res.json({
            score: 0,
            feedback: "No conversation took place.",
          });
        }

        // Get the session to find the transcript
        const session = await storage.getAiChatSession(sessionId);
        let transcriptContext = "";

        if (session?.transcriptId) {
          const transcript = await storage.getLectureTranscript(
            session.transcriptId
          );
          if (transcript) {
            transcriptContext = transcript.transcriptText.substring(0, 2000);
          }
        }

        // Format conversation for analysis
        const conversationText = messages
          .map((m) => `${m.role === "user" ? "Student" : "AI"}: ${m.content}`)
          .join("\n");

        // Use AI to calculate understanding score
        const { GoogleGenAI } = await import("@google/genai");
        const ai = new GoogleGenAI({
          apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
          httpOptions: {
            apiVersion: "",
            baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
          },
        });

        const analysisPrompt = `You are an educational assessment expert. Analyze this student's conversation with an AI tutor about a lecture and provide an understanding score.

${
  transcriptContext
    ? `Lecture Context (excerpt):
${transcriptContext}

`
    : ""
}Conversation:
${conversationText}

Based on this conversation, evaluate the student's understanding on a scale of 0-100. Consider:
- Quality and depth of questions asked
- Whether the student showed engagement with the material
- Evidence of comprehension in their responses
- Critical thinking and curiosity demonstrated

Respond in exactly this JSON format:
{"score": <number 0-100>, "feedback": "<brief 1-2 sentence feedback about their understanding>"}`;

        const result = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
        });

        let score = 50;
        let feedback = "Thank you for participating in the discussion.";

        try {
          const responseText = result.text || "";
          const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            score = Math.max(0, Math.min(100, parsed.score || 50));
            feedback = parsed.feedback || feedback;
          }
        } catch (parseError) {
          console.error("Failed to parse AI score response:", parseError);
        }

        // Update participant with score
        await storage.updateAiChatParticipant(participantRowId, {
          status: "completed",
          score: score,
        } as any);

        res.json({ score, feedback });
      } catch (error) {
        console.error("Calculate understanding score error:", error);
        res.status(500).json({ error: "Failed to calculate score" });
      }
    }
  );

  // ========== WebSocket Server ==========
  const wss = new WebSocketServer({ noServer: true });

  // Add heartbeat to keep connections alive
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    });
  }, 30000); // 30 seconds

  wss.on("close", () => clearInterval(heartbeat));

  // Cache board creatorId and lecturerId per room to avoid repeated DB lookups
  const boardCreatorCache = new Map<string, string>();
  const boardLecturerCache = new Map<string, string>();

  // Handle WebSocket upgrade with session authentication
  httpServer.on("upgrade", (request, socket, head) => {
    // Use URL parser to handle cases like "/ws?token=..." which request.url misses
    const pathname = new URL(
      request.url || "",
      `http://${request.headers.host}`
    ).pathname;

    if (pathname !== "/ws") {
      return;
    }

    // Parse session, but DON'T kill the connection if it fails
    sessionMiddleware(request as any, {} as any, () => {
      // If there's no session, sessionUserId will simply be undefined (which is fine!)
      const sessionUserId = (request as any).session?.userId;

      wss.handleUpgrade(request, socket, head, (ws) => {
        // Attach info so we know who they are later
        (ws as any).authenticatedUserId = sessionUserId || null;
        (ws as any).isGuest = !sessionUserId;

        wss.emit("connection", ws, request);
      });
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    let currentRoomCode: string | null = null;
    let participantId: string | null = null;
    // Get the authenticated userId from the upgrade handler
    const authenticatedUserId = (ws as any).authenticatedUserId;

    ws.on("message", async (message: string) => {
      try {
        const data = JSON.parse(message.toString());

        switch (data.type) {
          case "join": {
            const { roomCode, user } = data;
            currentRoomCode = roomCode;
            participantId = user.id;

            // Cancel any pending disconnect for this user (they're reconnecting)
            const disconnectKey = `${roomCode}:${user.id}`;
            const pendingDisconnect = pendingDisconnects.get(disconnectKey);
            if (pendingDisconnect) {
              clearTimeout(pendingDisconnect);
              pendingDisconnects.delete(disconnectKey);
              console.log(
                `[WS] Cancelled pending disconnect for ${user.name} in room ${roomCode}`
              );
            }

            // Get board creatorId and lecturerId from cache or DB
            let creatorId = boardCreatorCache.get(roomCode);
            let lecturerId = boardLecturerCache.get(roomCode);
            if (!creatorId) {
              const board = await storage.getBoardByRoomCode(roomCode);
              if (board) {
                creatorId = board.creatorId;
                boardCreatorCache.set(roomCode, creatorId);
                if (board.lecturerId) {
                  lecturerId = board.lecturerId;
                  boardLecturerCache.set(roomCode, lecturerId);
                }
              }
            }

            if (!rooms.has(roomCode)) {
              rooms.set(roomCode, new Map());
            }

            const room = rooms.get(roomCode)!;

            // Server determines admin status using authenticated session userId (not client-provided)
            // Both creator and lecturer get admin privileges
            const isCreatorAdmin =
              authenticatedUserId &&
              ((creatorId && authenticatedUserId === creatorId) ||
                (lecturerId && authenticatedUserId === lecturerId));

            // Check if user is reconnecting (exists in room from grace period)
            const existingParticipant = room.get(user.id);
            const isReconnecting = existingParticipant !== undefined;

            const participant: RoomParticipant = {
              id: user.id,
              name: user.name,
              role: user.role || "student",
              color: user.color,
              // Preserve joinedAt if reconnecting, otherwise use current time
              joinedAt: isReconnecting
                ? existingParticipant.joinedAt
                : Date.now(),
              isAdmin: isCreatorAdmin || false,
              // Preserve isPublic state if reconnecting
              isPublic: isReconnecting
                ? existingParticipant.isPublic
                : user.isPublic || false,
              ws,
              // Preserve original visibility if reconnecting
              originalVisibility: isReconnecting
                ? existingParticipant.originalVisibility
                : undefined,
              // Preserve viewing state if reconnecting
              viewingUserId: isReconnecting
                ? existingParticipant.viewingUserId
                : null,
            };
            room.set(user.id, participant);

            if (isReconnecting) {
              console.log(
                `[WS] User ${
                  user.name
                } reconnected to room ${roomCode}, was viewing: ${
                  existingParticipant.viewingUserId || "own board"
                }`
              );
            }

            // Send current participants to the new user
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

            // Send current focus state to the new user if there is one
            const focusState = roomFocusState.get(roomCode);
            if (focusState?.focusedUserId) {
              ws.send(
                JSON.stringify({
                  type: "focus",
                  targetUserId: focusState.focusedUserId,
                  focusedBy: "system",
                })
              );
            } else if (isCreatorAdmin) {
              // Default: focus on admin's board when room is new or has no focus
              roomFocusState.set(roomCode, {
                focusedUserId: user.id,
                originalVisibility: participant.isPublic,
              });
              // Broadcast focus to all including the admin
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "focus",
                      targetUserId: user.id,
                      focusedBy: user.id,
                    })
                  );
                }
              });
            }

            // Send current session state to the new user
            const board = await storage.getBoardByRoomCode(roomCode);

            // If admin is returning, resume session automatically
            if (isCreatorAdmin && board?.isEnded) {
              await storage.updateBoard(board.id, { isEnded: false });
              // Broadcast session resumed to all
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "sessionState",
                      isEnded: false,
                    })
                  );
                }
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
            room.forEach((p, id) => {
              if (id !== user.id && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
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
                  })
                );
              }
            });
            break;
          }

          case "updatePresence": {
            if (!currentRoomCode || !participantId) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const participant = room.get(participantId);
            if (participant) {
              // Only allow updating isPublic - isAdmin is server-controlled
              participant.isPublic = data.isPublic ?? participant.isPublic;
              // Note: isAdmin cannot be changed by client, it's determined at join time

              // Broadcast update to all
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "presenceUpdate",
                      userId: participantId,
                      isPublic: participant.isPublic,
                      isAdmin: participant.isAdmin,
                    })
                  );
                }
              });
            }
            break;
          }

          case "presencePing": {
            // Lightweight presence refresh when mobile device wakes up
            // Just confirm the user is still in the room, no broadcast needed
            if (!currentRoomCode || !participantId) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            // If user not in room anymore, they'll need to rejoin via normal flow
            // The visibility handler on client will trigger reconnect if socket was closed
            break;
          }

          case "ping": {
            // Heartbeat ping - respond with pong to keep connection alive
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
            break;
          }

          case "setViewingState": {
            // Track which board this user is viewing (for reconnection restoration)
            if (!currentRoomCode || !participantId) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const participant = room.get(participantId);
            if (participant) {
              participant.viewingUserId = data.viewingUserId || null;
            }
            break;
          }

          case "cursor": {
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "cursor",
                    userId: participantId,
                    x: data.x,
                    y: data.y,
                    color: data.color,
                    name: data.name,
                    isPointer: data.isPointer,
                    viewingUserId: data.viewingUserId,
                  })
                );
              }
            });
            break;
          }

          case "draw": {
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "draw",
                    userId: participantId,
                    line: data.line,
                  })
                );
              }
            });
            break;
          }

          case "requestBoard": {
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const target = room.get(data.targetUserId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: "boardRequest",
                  requesterId: participantId,
                })
              );
            }
            break;
          }

          case "sendBoard": {
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const target = room.get(data.targetUserId);
            if (target && target.ws.readyState === WebSocket.OPEN) {
              target.ws.send(
                JSON.stringify({
                  type: "boardData",
                  userId: participantId,
                  lines: data.lines,
                })
              );
            }
            break;
          }

          case "boardUpdate": {
            // Broadcast board update to all users in the room
            // data.userId = whose board was updated (can be sender or someone else if admin)
            // data.lines = the full board lines
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            // Schedule debounced database persistence
            const targetUser = room.get(data.userId);
            const userName = targetUser?.name || data.userName || data.userId;
            scheduleBoardUpdate(
              currentRoomCode,
              data.userId,
              userName,
              data.lines || []
            );

            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "boardUpdate",
                    userId: data.userId,
                    lines: data.lines,
                  })
                );
              }
            });
            break;
          }

          case "sessionState": {
            // Admin broadcasts session state (ended/resumed) to all users
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can toggle session state

            const isEnded = data.isEnded;

            // Update database
            const board = await storage.getBoardByRoomCode(currentRoomCode);
            if (board) {
              await storage.updateBoard(board.id, { isEnded });
            }

            // Broadcast to all users in the room
            room.forEach((p) => {
              if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "sessionState",
                    isEnded,
                  })
                );
              }
            });
            break;
          }

          case "focus": {
            // Admin broadcasts focus command to all users
            // data.targetUserId = whose board to focus on (null to release focus)
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can focus

            const targetUserId = data.targetUserId;

            // Get or create room focus state
            let focusState = roomFocusState.get(currentRoomCode);
            if (!focusState) {
              focusState = { focusedUserId: null, originalVisibility: null };
              roomFocusState.set(currentRoomCode, focusState);
            }

            if (targetUserId) {
              // First, restore previous focus if different user was focused
              if (
                focusState.focusedUserId &&
                focusState.focusedUserId !== targetUserId &&
                focusState.originalVisibility !== null
              ) {
                const prevFocused = room.get(focusState.focusedUserId);
                if (prevFocused) {
                  prevFocused.isPublic = focusState.originalVisibility;

                  room.forEach((p) => {
                    if (p.ws.readyState === WebSocket.OPEN) {
                      p.ws.send(
                        JSON.stringify({
                          type: "presenceUpdate",
                          userId: focusState!.focusedUserId,
                          isPublic: focusState!.originalVisibility,
                          isAdmin: prevFocused.isAdmin,
                        })
                      );
                    }
                  });
                }
              }

              // Focusing on a board - track original visibility and force public
              const target = room.get(targetUserId);
              if (target) {
                // Store original visibility in room focus state
                focusState.focusedUserId = targetUserId;
                focusState.originalVisibility = target.isPublic;
                target.isPublic = true;

                // Broadcast visibility update to all users
                room.forEach((p) => {
                  if (p.ws.readyState === WebSocket.OPEN) {
                    p.ws.send(
                      JSON.stringify({
                        type: "presenceUpdate",
                        userId: targetUserId,
                        isPublic: true,
                        isAdmin: target.isAdmin,
                      })
                    );
                  }
                });
              }
            } else {
              // Releasing focus - restore original visibility from room focus state
              if (
                focusState.focusedUserId &&
                focusState.originalVisibility !== null
              ) {
                const prevFocused = room.get(focusState.focusedUserId);
                if (prevFocused) {
                  prevFocused.isPublic = focusState.originalVisibility;

                  // Broadcast visibility restoration
                  room.forEach((p) => {
                    if (p.ws.readyState === WebSocket.OPEN) {
                      p.ws.send(
                        JSON.stringify({
                          type: "presenceUpdate",
                          userId: focusState!.focusedUserId,
                          isPublic: focusState!.originalVisibility,
                          isAdmin: prevFocused.isAdmin,
                        })
                      );
                    }
                  });
                }
              }
              // Clear room focus state
              focusState.focusedUserId = null;
              focusState.originalVisibility = null;
            }

            // Broadcast focus command to all users
            room.forEach((p) => {
              if (p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "focus",
                    targetUserId: targetUserId,
                    focusedBy: participantId,
                  })
                );
              }
            });
            break;
          }

          case "sidebarToggle": {
            // Admin broadcasts sidebar collapse/expand state to all users
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can toggle sidebar for all

            const isOpen = data.isOpen;

            // Broadcast to all users in the room (except sender)
            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "sidebarToggle",
                    isOpen,
                  })
                );
              }
            });
            break;
          }

          case "chatSession": {
            // Admin broadcasts chat session start to all participants
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can start chat sessions

            const { session } = data;

            // Broadcast to all users in the room (except sender)
            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "chatSession",
                    session,
                  })
                );
              }
            });
            break;
          }

          case "chatSessionEnded": {
            // Admin broadcasts chat session end to all participants
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can end chat sessions

            // Broadcast to all users in the room (except sender)
            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "chatSessionEnded",
                  })
                );
              }
            });
            break;
          }

          case "quiz:post": {
            // Admin posts a quiz - all participants are taken to quiz view
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can post quizzes

            const { quizId, boardId } = data;

            try {
              // Fetch the quiz from database
              const quiz = await storage.getQuiz(quizId);
              if (!quiz) {
                console.error("Quiz not found:", quizId);
                return;
              }

              const board = await storage.getBoardByRoomCode(currentRoomCode);
              if (!board) return;

              // Create quiz session
              const closesAt = new Date(Date.now() + quiz.timerSeconds * 1000);
              const session = await storage.createQuizSession({
                boardId: board.id,
                quizId: quizId,
                status: "active",
                postedAt: new Date(),
                closesAt: closesAt,
                resultsShared: false,
                leaderboardShared: false,
              });

              // Broadcast quiz to all users
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:posted",
                      sessionId: session.id,
                      quiz: quiz,
                      closesAt: closesAt.toISOString(),
                    })
                  );
                }
              });

              // Schedule timer end
              setTimeout(async () => {
                await storage.updateQuizSession(session.id, {
                  status: "closed",
                });
                if (!currentRoomCode) return;
                const currentRoom = rooms.get(currentRoomCode);
                if (currentRoom) {
                  currentRoom.forEach((p) => {
                    if (p.ws.readyState === WebSocket.OPEN) {
                      p.ws.send(
                        JSON.stringify({
                          type: "quiz:ended",
                          sessionId: session.id,
                        })
                      );
                    }
                  });
                }
              }, quiz.timerSeconds * 1000);
            } catch (err) {
              console.error("Failed to post quiz:", err);
            }
            break;
          }

          case "quiz:close": {
            // Admin closes quiz - broadcast to all participants
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return; // Only admins can close

            // Broadcast close to all other users
            room.forEach((p, id) => {
              if (id !== participantId && p.ws.readyState === WebSocket.OPEN) {
                p.ws.send(
                  JSON.stringify({
                    type: "quiz:closed",
                  })
                );
              }
            });
            break;
          }

          case "quiz:response": {
            // Participant submits their answer
            if (!currentRoomCode) return;
            const { sessionId, answer, participantName } = data;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            try {
              const session = await storage.getQuizSession(sessionId);
              if (!session || session.status !== "active") return;

              const quiz = await storage.getQuiz(session.quizId);
              if (!quiz) return;

              const isCorrect = answer === quiz.correctAnswer;

              await storage.upsertQuizResponse({
                sessionId,
                participantId: participantId!,
                participantName: participantName || participantId!,
                answer,
                isCorrect,
              });

              // Broadcast live response to all admins in the room
              room.forEach((p) => {
                if (p.isAdmin && p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:liveResponse",
                      sessionId,
                      participantId: participantId!,
                      participantName: participantName || participantId!,
                      answer,
                      isCorrect,
                      submittedAt: new Date().toISOString(),
                    })
                  );
                }
              });
            } catch (err) {
              console.error("Failed to save quiz response:", err);
            }
            break;
          }

          case "quiz:shareResults": {
            // Admin shares results - everyone sees their own score
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return;

            const { sessionId } = data;

            try {
              await storage.updateQuizSession(sessionId, {
                resultsShared: true,
              });
              const responses = await storage.getQuizResponses(sessionId);

              // Send each participant their own result
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  const myResponse = responses.find(
                    (r) => r.participantId === p.id
                  );
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:results",
                      sessionId,
                      isCorrect: myResponse?.isCorrect || false,
                      answer: myResponse?.answer || null,
                    })
                  );
                }
              });
            } catch (err) {
              console.error("Failed to share results:", err);
            }
            break;
          }

          case "quiz:showLeaderboard": {
            // Admin shows leaderboard - top 5 names (no scores)
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return;

            const { sessionId } = data;

            try {
              await storage.updateQuizSession(sessionId, {
                leaderboardShared: true,
              });
              const responses = await storage.getQuizResponses(sessionId);

              // Get top 5 correct answers
              const correct = responses.filter((r) => r.isCorrect);
              const top5 = correct.slice(0, 5).map((r) => r.participantName);

              // Broadcast leaderboard to all users
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:leaderboard",
                      sessionId,
                      topParticipants: top5,
                    })
                  );
                }
              });
            } catch (err) {
              console.error("Failed to show leaderboard:", err);
            }
            break;
          }

          case "quiz:shareResultsById": {
            // Admin shares results by quiz ID - everyone sees their own score
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return;

            const { quizId, boardId } = data;

            try {
              const responses = await storage.getQuizResponsesByQuizIdAndBoard(
                quizId,
                boardId
              );

              // Send each participant their own result
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  const myResponse = responses.find(
                    (r) => r.participantId === p.id
                  );
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:results",
                      quizId,
                      isCorrect: myResponse?.isCorrect || false,
                      answer: myResponse?.answer || null,
                    })
                  );
                }
              });
            } catch (err) {
              console.error("Failed to share results by quiz ID:", err);
            }
            break;
          }

          case "quiz:showLeaderboardByQuiz": {
            // Admin shares leaderboard by quiz ID - everyone sees top 5
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return;

            const { quizId, boardId } = data;

            try {
              const responses = await storage.getQuizResponsesByQuizIdAndBoard(
                quizId,
                boardId
              );

              // Get top 5 correct answers
              const correct = responses.filter((r) => r.isCorrect);
              const top5 = correct.slice(0, 5).map((r) => r.participantName);

              // Broadcast leaderboard to all users
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:leaderboard",
                      quizId,
                      topParticipants: top5,
                    })
                  );
                }
              });
            } catch (err) {
              console.error("Failed to show leaderboard by quiz ID:", err);
            }
            break;
          }

          case "quiz:showCumulativeLeaderboard": {
            // Admin shares cumulative leaderboard - aggregates correct answers across all quizzes for the board
            if (!currentRoomCode) return;
            const room = rooms.get(currentRoomCode);
            if (!room) return;

            const sender = room.get(participantId!);
            if (!sender?.isAdmin) return;

            const { boardId } = data;

            try {
              // Get all responses for this board
              const allResponses = await storage.getQuizResponsesByBoardId(
                boardId
              );

              // Aggregate correct answers per participant
              const scoreMap = new Map<
                string,
                { name: string; correct: number }
              >();

              for (const response of allResponses) {
                if (response.isCorrect) {
                  const existing = scoreMap.get(response.participantId);
                  if (existing) {
                    existing.correct += 1;
                  } else {
                    scoreMap.set(response.participantId, {
                      name: response.participantName,
                      correct: 1,
                    });
                  }
                }
              }

              // Sort by correct count descending and get top 5
              const sorted = Array.from(scoreMap.values())
                .sort((a, b) => b.correct - a.correct)
                .slice(0, 5);

              // Format as array with scores
              const topWithScores = sorted.map((s) => ({
                name: s.name,
                score: s.correct,
              }));

              // Broadcast cumulative leaderboard to all users
              room.forEach((p) => {
                if (p.ws.readyState === WebSocket.OPEN) {
                  p.ws.send(
                    JSON.stringify({
                      type: "quiz:cumulativeLeaderboard",
                      topParticipants: topWithScores,
                    })
                  );
                }
              });
            } catch (err) {
              console.error("Failed to show cumulative leaderboard:", err);
            }
            break;
          }
        }
      } catch (error) {
        console.error("WebSocket message error:", error);
      }
    });

    ws.on("close", async () => {
      if (currentRoomCode && participantId) {
        // Flush any pending board updates for this user before removing them
        const updateKey = `${currentRoomCode}:${participantId}`;
        const pendingUpdate = pendingBoardUpdates.get(updateKey);
        if (pendingUpdate) {
          clearTimeout(pendingUpdate.timer);
          flushBoardUpdate(updateKey);
        }

        const room = rooms.get(currentRoomCode);
        if (room) {
          const leavingUser = room.get(participantId);
          const wasAdmin = leavingUser?.isAdmin;

          // Both admins and non-admins get a grace period to reconnect
          // Admins get a shorter grace period
          const gracePeriod = wasAdmin
            ? ADMIN_DISCONNECT_GRACE_PERIOD_MS
            : DISCONNECT_GRACE_PERIOD_MS;
          const disconnectKey = `${currentRoomCode}:${participantId}`;
          const capturedRoomCode = currentRoomCode;
          const capturedParticipantId = participantId;
          const capturedWasAdmin = wasAdmin;

          console.log(
            `[WS] ${wasAdmin ? "Admin" : "User"} ${
              leavingUser?.name || participantId
            } disconnected, starting ${gracePeriod / 1000}s grace period`
          );

          const disconnectTimer = setTimeout(async () => {
            pendingDisconnects.delete(disconnectKey);

            const currentRoom = rooms.get(capturedRoomCode);
            if (currentRoom) {
              const stillDisconnected = currentRoom.get(capturedParticipantId);
              // Only remove if the user hasn't reconnected with a new WebSocket
              if (
                stillDisconnected &&
                stillDisconnected.ws.readyState !== WebSocket.OPEN
              ) {
                console.log(
                  `[WS] Grace period expired for ${stillDisconnected.name}, removing from room`
                );
                currentRoom.delete(capturedParticipantId);

                // If admin's grace period expired, end the session
                if (capturedWasAdmin && currentRoom.size > 0) {
                  const board = await storage.getBoardByRoomCode(
                    capturedRoomCode
                  );
                  if (board) {
                    await storage.updateBoard(board.id, { isEnded: true });
                  }

                  currentRoom.forEach((p) => {
                    if (p.ws.readyState === WebSocket.OPEN) {
                      p.ws.send(
                        JSON.stringify({
                          type: "sessionState",
                          isEnded: true,
                        })
                      );
                    }
                  });
                }

                currentRoom.forEach((p) => {
                  if (p.ws.readyState === WebSocket.OPEN) {
                    p.ws.send(
                      JSON.stringify({
                        type: "userLeft",
                        userId: capturedParticipantId,
                      })
                    );
                  }
                });

                if (currentRoom.size === 0) {
                  rooms.delete(capturedRoomCode);
                }
              }
            }
          }, gracePeriod);

          pendingDisconnects.set(disconnectKey, disconnectTimer);
        }
      }
    });
  });

  return httpServer;
}
