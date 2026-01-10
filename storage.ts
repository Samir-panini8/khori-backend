import { 
  users, 
  boards, 
  boardData,
  quizzes,
  quizSessions,
  quizResponses,
  quizCategories,
  quizClasses,
  studentAttendance,
  teacherAttendance,
  lectureRecordings,
  lectureTranscripts,
  aiChatSessions,
  aiChatParticipants,
  aiChatMessages,
  type User, 
  type InsertUser,
  type Board,
  type InsertBoard,
  type BoardData,
  type InsertBoardData,
  type Quiz,
  type InsertQuiz,
  type QuizSession,
  type InsertQuizSession,
  type QuizResponse,
  type InsertQuizResponse,
  type QuizCategory,
  type InsertQuizCategory,
  type QuizClass,
  type InsertQuizClass,
  type StudentAttendance,
  type InsertStudentAttendance,
  type TeacherAttendance,
  type InsertTeacherAttendance,
  type LectureRecording,
  type InsertLectureRecording,
  type LectureTranscript,
  type InsertLectureTranscript,
  type AiChatSession,
  type InsertAiChatSession,
  type AiChatParticipant,
  type InsertAiChatParticipant,
  type AiChatMessage,
  type InsertAiChatMessage
} from "./shared/schema";
import { db } from "./db";
import { eq, and, desc, asc, inArray, or } from "drizzle-orm";

export interface IStorage {
  // User methods
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: string): Promise<boolean>;
  updateUserPassword(id: string, hashedPassword: string): Promise<boolean>;
  updateUserScreenName(id: string, screenName: string | null): Promise<boolean>;
  
  // Board methods
  getBoard(id: string): Promise<Board | undefined>;
  getBoardByRoomCode(roomCode: string): Promise<Board | undefined>;
  createBoard(board: InsertBoard): Promise<Board>;
  updateBoard(id: string, updates: Partial<InsertBoard>): Promise<Board | undefined>;
  getAllBoards(): Promise<Board[]>;
  getBoardsByCreator(creatorId: string): Promise<Board[]>;
  getBoardsByLecturer(lecturerId: string): Promise<Board[]>;
  deleteBoard(id: string): Promise<boolean>;
  
  // Board data methods
  getBoardData(boardId: string, userId: string): Promise<BoardData | undefined>;
  getAllBoardData(boardId: string): Promise<BoardData[]>;
  upsertBoardData(data: InsertBoardData): Promise<BoardData>;
  
  // Quiz methods
  getQuiz(id: string): Promise<Quiz | undefined>;
  getQuizzesByCreator(creatorId: string): Promise<Quiz[]>;
  createQuiz(quiz: InsertQuiz): Promise<Quiz>;
  updateQuiz(id: string, updates: Partial<InsertQuiz>): Promise<Quiz | undefined>;
  deleteQuiz(id: string): Promise<boolean>;
  
  // Quiz session methods
  getQuizSession(id: string): Promise<QuizSession | undefined>;
  getActiveQuizSession(boardId: string): Promise<QuizSession | undefined>;
  createQuizSession(session: InsertQuizSession): Promise<QuizSession>;
  updateQuizSession(id: string, updates: Partial<InsertQuizSession>): Promise<QuizSession | undefined>;
  
  // Quiz response methods
  getQuizResponse(sessionId: string, participantId: string): Promise<QuizResponse | undefined>;
  getQuizResponses(sessionId: string): Promise<QuizResponse[]>;
  getQuizResponsesByQuizId(quizId: string): Promise<QuizResponse[]>;
  getQuizResponsesByQuizIdAndBoard(quizId: string, boardId?: string): Promise<QuizResponse[]>;
  getQuizResponsesByBoardId(boardId: string): Promise<QuizResponse[]>;
  upsertQuizResponse(response: InsertQuizResponse): Promise<QuizResponse>;
  
  // Quiz category methods
  getQuizCategories(): Promise<QuizCategory[]>;
  createQuizCategory(category: InsertQuizCategory): Promise<QuizCategory>;
  updateQuizCategory(id: string, name: string): Promise<QuizCategory | undefined>;
  deleteQuizCategory(id: string): Promise<boolean>;
  
  // Quiz class methods
  getQuizClasses(): Promise<QuizClass[]>;
  createQuizClass(quizClass: InsertQuizClass): Promise<QuizClass>;
  updateQuizClass(id: string, name: string): Promise<QuizClass | undefined>;
  deleteQuizClass(id: string): Promise<boolean>;
  
  // Student attendance methods
  getStudentAttendance(studentId: string): Promise<StudentAttendance[]>;
  createStudentAttendance(attendance: InsertStudentAttendance): Promise<StudentAttendance>;
  updateStudentAttendance(id: string, updates: Partial<InsertStudentAttendance>): Promise<StudentAttendance | undefined>;
  getActiveAttendance(boardId: string, studentId: string): Promise<StudentAttendance | undefined>;
  getStudentAttendanceByBoard(boardId: string): Promise<StudentAttendance[]>;
  
  // Student performance methods
  getStudentQuizResponses(studentId: string): Promise<QuizResponse[]>;
  
  // Teacher attendance methods
  getTeacherAttendance(teacherId: string): Promise<TeacherAttendance[]>;
  createTeacherAttendance(attendance: InsertTeacherAttendance): Promise<TeacherAttendance>;
  updateTeacherAttendance(id: string, updates: Partial<InsertTeacherAttendance>): Promise<TeacherAttendance | undefined>;
  getActiveTeacherAttendance(boardId: string, teacherId: string): Promise<TeacherAttendance | undefined>;
  
  // Quiz sessions by board
  getQuizSessionsByBoard(boardId: string): Promise<QuizSession[]>;
  
  // Lecture recording methods
  getLectureRecording(id: string): Promise<LectureRecording | undefined>;
  getActiveRecording(boardId: string): Promise<LectureRecording | undefined>;
  createLectureRecording(recording: InsertLectureRecording): Promise<LectureRecording>;
  updateLectureRecording(id: string, updates: Partial<InsertLectureRecording>): Promise<LectureRecording | undefined>;
  getRecordingsByBoard(boardId: string): Promise<LectureRecording[]>;
  
  // Lecture transcript methods
  getLectureTranscript(id: string): Promise<LectureTranscript | undefined>;
  getTranscriptByRecording(recordingId: string): Promise<LectureTranscript | undefined>;
  createLectureTranscript(transcript: InsertLectureTranscript): Promise<LectureTranscript>;
  
  // AI chat session methods
  getAiChatSession(id: string): Promise<AiChatSession | undefined>;
  getActiveAiChatSession(boardId: string): Promise<AiChatSession | undefined>;
  getAiChatSessionsByBoard(boardId: string): Promise<AiChatSession[]>;
  createAiChatSession(session: InsertAiChatSession): Promise<AiChatSession>;
  updateAiChatSession(id: string, updates: Partial<InsertAiChatSession>): Promise<AiChatSession | undefined>;
  
  // AI chat participant methods
  getAiChatParticipant(sessionId: string, participantId: string): Promise<AiChatParticipant | undefined>;
  getAiChatParticipantById(id: string): Promise<AiChatParticipant | undefined>;
  getAiChatParticipants(sessionId: string): Promise<AiChatParticipant[]>;
  createAiChatParticipant(participant: InsertAiChatParticipant): Promise<AiChatParticipant>;
  updateAiChatParticipant(id: string, updates: Partial<InsertAiChatParticipant>): Promise<AiChatParticipant | undefined>;
  
  // AI chat message methods
  getAiChatMessages(sessionId: string, participantId: string): Promise<AiChatMessage[]>;
  createAiChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage>;
}

export class DatabaseStorage implements IStorage {
  // User methods
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async deleteUser(id: string): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id));
    return true;
  }

  async updateUserPassword(id: string, hashedPassword: string): Promise<boolean> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, id));
    return true;
  }

  async updateUserScreenName(id: string, screenName: string | null): Promise<boolean> {
    await db.update(users).set({ screenName }).where(eq(users.id, id));
    return true;
  }

  // Board methods
  async getBoard(id: string): Promise<Board | undefined> {
    const [board] = await db.select().from(boards).where(eq(boards.id, id));
    return board || undefined;
  }

  async getBoardByRoomCode(roomCode: string): Promise<Board | undefined> {
    const [board] = await db.select().from(boards).where(eq(boards.roomCode, roomCode));
    return board || undefined;
  }

  async createBoard(insertBoard: InsertBoard): Promise<Board> {
    const [board] = await db
      .insert(boards)
      .values(insertBoard)
      .returning();
    return board;
  }

  async updateBoard(id: string, updates: Partial<InsertBoard>): Promise<Board | undefined> {
    const [board] = await db
      .update(boards)
      .set(updates)
      .where(eq(boards.id, id))
      .returning();
    return board || undefined;
  }

  async getAllBoards(): Promise<Board[]> {
    return db.select().from(boards);
  }

  async getBoardsByCreator(creatorId: string): Promise<Board[]> {
    return db.select().from(boards).where(eq(boards.creatorId, creatorId));
  }

  async getBoardsByLecturer(lecturerId: string): Promise<Board[]> {
    return db.select().from(boards).where(
      eq(boards.lecturerId, lecturerId)
    ).orderBy(desc(boards.startTime));
  }

  async deleteBoard(id: string): Promise<boolean> {
    await db.delete(boardData).where(eq(boardData.boardId, id));
    await db.delete(boards).where(eq(boards.id, id));
    return true;
  }

  // Board data methods
  async getBoardData(boardId: string, userId: string): Promise<BoardData | undefined> {
    const [data] = await db
      .select()
      .from(boardData)
      .where(and(
        eq(boardData.boardId, boardId),
        eq(boardData.userId, userId)
      ));
    return data || undefined;
  }

  async getAllBoardData(boardId: string): Promise<BoardData[]> {
    return db.select().from(boardData).where(eq(boardData.boardId, boardId));
  }

  async upsertBoardData(data: InsertBoardData): Promise<BoardData> {
    const existing = await this.getBoardData(data.boardId, data.userId);
    
    if (existing) {
      const [updated] = await db
        .update(boardData)
        .set({ linesData: data.linesData, updatedAt: new Date() })
        .where(eq(boardData.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db
        .insert(boardData)
        .values(data)
        .returning();
      return created;
    }
  }

  // Quiz methods
  async getQuiz(id: string): Promise<Quiz | undefined> {
    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.id, id));
    return quiz || undefined;
  }

  async getQuizzesByCreator(creatorId: string): Promise<Quiz[]> {
    return db.select().from(quizzes).where(eq(quizzes.creatorId, creatorId)).orderBy(desc(quizzes.createdAt));
  }

  async createQuiz(quiz: InsertQuiz): Promise<Quiz> {
    const [created] = await db.insert(quizzes).values(quiz).returning();
    return created;
  }

  async updateQuiz(id: string, updates: Partial<InsertQuiz>): Promise<Quiz | undefined> {
    const [updated] = await db.update(quizzes).set(updates).where(eq(quizzes.id, id)).returning();
    return updated || undefined;
  }

  async deleteQuiz(id: string): Promise<boolean> {
    await db.delete(quizzes).where(eq(quizzes.id, id));
    return true;
  }

  // Quiz session methods
  async getQuizSession(id: string): Promise<QuizSession | undefined> {
    const [session] = await db.select().from(quizSessions).where(eq(quizSessions.id, id));
    return session || undefined;
  }

  async getActiveQuizSession(boardId: string): Promise<QuizSession | undefined> {
    const [session] = await db.select().from(quizSessions).where(
      and(eq(quizSessions.boardId, boardId), eq(quizSessions.status, "active"))
    );
    return session || undefined;
  }

  async createQuizSession(session: InsertQuizSession): Promise<QuizSession> {
    const [created] = await db.insert(quizSessions).values(session).returning();
    return created;
  }

  async updateQuizSession(id: string, updates: Partial<InsertQuizSession>): Promise<QuizSession | undefined> {
    const [updated] = await db.update(quizSessions).set(updates).where(eq(quizSessions.id, id)).returning();
    return updated || undefined;
  }

  // Quiz response methods
  async getQuizResponse(sessionId: string, participantId: string): Promise<QuizResponse | undefined> {
    const [response] = await db.select().from(quizResponses).where(
      and(eq(quizResponses.sessionId, sessionId), eq(quizResponses.participantId, participantId))
    );
    return response || undefined;
  }

  async getQuizResponses(sessionId: string): Promise<QuizResponse[]> {
    return db.select().from(quizResponses).where(eq(quizResponses.sessionId, sessionId));
  }

  async getQuizResponsesByQuizId(quizId: string): Promise<QuizResponse[]> {
    // Get all sessions for this quiz
    const sessions = await db.select().from(quizSessions).where(eq(quizSessions.quizId, quizId));
    if (sessions.length === 0) return [];
    
    // Get all responses in one query, ordered by submission time
    const sessionIds = sessions.map(s => s.id);
    return db.select()
      .from(quizResponses)
      .where(inArray(quizResponses.sessionId, sessionIds))
      .orderBy(asc(quizResponses.updatedAt));
  }

  async getQuizResponsesByQuizIdAndBoard(quizId: string, boardId?: string): Promise<QuizResponse[]> {
    // Get sessions for this quiz, optionally filtered by board
    let sessions;
    if (boardId) {
      sessions = await db.select().from(quizSessions).where(
        and(eq(quizSessions.quizId, quizId), eq(quizSessions.boardId, boardId))
      );
    } else {
      sessions = await db.select().from(quizSessions).where(eq(quizSessions.quizId, quizId));
    }
    if (sessions.length === 0) return [];
    
    // Get all responses in one query, ordered by submission time (fastest first)
    const sessionIds = sessions.map(s => s.id);
    return db.select()
      .from(quizResponses)
      .where(inArray(quizResponses.sessionId, sessionIds))
      .orderBy(asc(quizResponses.updatedAt));
  }

  async getQuizResponsesByBoardId(boardId: string): Promise<QuizResponse[]> {
    // Get all sessions for this board
    const sessions = await db.select().from(quizSessions).where(eq(quizSessions.boardId, boardId));
    if (sessions.length === 0) return [];
    
    // Get all responses for all sessions
    const sessionIds = sessions.map(s => s.id);
    return db.select()
      .from(quizResponses)
      .where(inArray(quizResponses.sessionId, sessionIds));
  }

  async upsertQuizResponse(response: InsertQuizResponse): Promise<QuizResponse> {
    const existing = await this.getQuizResponse(response.sessionId, response.participantId);
    
    if (existing) {
      const [updated] = await db
        .update(quizResponses)
        .set({ answer: response.answer, isCorrect: response.isCorrect, updatedAt: new Date() })
        .where(eq(quizResponses.id, existing.id))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(quizResponses).values(response).returning();
      return created;
    }
  }

  // Quiz category methods
  async getQuizCategories(): Promise<QuizCategory[]> {
    return db.select().from(quizCategories).orderBy(asc(quizCategories.name));
  }

  async createQuizCategory(category: InsertQuizCategory): Promise<QuizCategory> {
    const [created] = await db.insert(quizCategories).values(category).returning();
    return created;
  }

  async updateQuizCategory(id: string, name: string): Promise<QuizCategory | undefined> {
    const [updated] = await db
      .update(quizCategories)
      .set({ name })
      .where(eq(quizCategories.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteQuizCategory(id: string): Promise<boolean> {
    await db.delete(quizCategories).where(eq(quizCategories.id, id));
    return true;
  }

  // Quiz class methods
  async getQuizClasses(): Promise<QuizClass[]> {
    return db.select().from(quizClasses).orderBy(asc(quizClasses.name));
  }

  async createQuizClass(quizClass: InsertQuizClass): Promise<QuizClass> {
    const [created] = await db.insert(quizClasses).values(quizClass).returning();
    return created;
  }

  async updateQuizClass(id: string, name: string): Promise<QuizClass | undefined> {
    const [updated] = await db
      .update(quizClasses)
      .set({ name })
      .where(eq(quizClasses.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteQuizClass(id: string): Promise<boolean> {
    await db.delete(quizClasses).where(eq(quizClasses.id, id));
    return true;
  }

  // Student attendance methods
  async getStudentAttendance(studentId: string): Promise<StudentAttendance[]> {
    return db.select()
      .from(studentAttendance)
      .where(eq(studentAttendance.studentId, studentId))
      .orderBy(desc(studentAttendance.joinedAt));
  }

  async createStudentAttendance(attendance: InsertStudentAttendance): Promise<StudentAttendance> {
    const [created] = await db.insert(studentAttendance).values(attendance).returning();
    return created;
  }

  async updateStudentAttendance(id: string, updates: Partial<InsertStudentAttendance>): Promise<StudentAttendance | undefined> {
    const [updated] = await db
      .update(studentAttendance)
      .set(updates)
      .where(eq(studentAttendance.id, id))
      .returning();
    return updated || undefined;
  }

  async getActiveAttendance(boardId: string, studentId: string): Promise<StudentAttendance | undefined> {
    const [attendance] = await db.select()
      .from(studentAttendance)
      .where(and(
        eq(studentAttendance.boardId, boardId),
        eq(studentAttendance.studentId, studentId)
      ))
      .orderBy(desc(studentAttendance.joinedAt))
      .limit(1);
    return attendance || undefined;
  }

  // Student performance methods
  async getStudentQuizResponses(studentId: string): Promise<QuizResponse[]> {
    return db.select()
      .from(quizResponses)
      .where(eq(quizResponses.participantId, studentId))
      .orderBy(desc(quizResponses.updatedAt));
  }

  async getStudentAttendanceByBoard(boardId: string): Promise<StudentAttendance[]> {
    return db.select()
      .from(studentAttendance)
      .where(eq(studentAttendance.boardId, boardId))
      .orderBy(desc(studentAttendance.joinedAt));
  }

  // Teacher attendance methods
  async getTeacherAttendance(teacherId: string): Promise<TeacherAttendance[]> {
    return db.select()
      .from(teacherAttendance)
      .where(eq(teacherAttendance.teacherId, teacherId))
      .orderBy(desc(teacherAttendance.joinedAt));
  }

  async createTeacherAttendance(attendance: InsertTeacherAttendance): Promise<TeacherAttendance> {
    const [created] = await db.insert(teacherAttendance).values(attendance).returning();
    return created;
  }

  async updateTeacherAttendance(id: string, updates: Partial<InsertTeacherAttendance>): Promise<TeacherAttendance | undefined> {
    const [updated] = await db
      .update(teacherAttendance)
      .set(updates)
      .where(eq(teacherAttendance.id, id))
      .returning();
    return updated || undefined;
  }

  async getActiveTeacherAttendance(boardId: string, teacherId: string): Promise<TeacherAttendance | undefined> {
    const [attendance] = await db.select()
      .from(teacherAttendance)
      .where(and(
        eq(teacherAttendance.boardId, boardId),
        eq(teacherAttendance.teacherId, teacherId)
      ))
      .orderBy(desc(teacherAttendance.joinedAt))
      .limit(1);
    return attendance || undefined;
  }

  // Quiz sessions by board
  async getQuizSessionsByBoard(boardId: string): Promise<QuizSession[]> {
    return db.select()
      .from(quizSessions)
      .where(eq(quizSessions.boardId, boardId))
      .orderBy(desc(quizSessions.postedAt));
  }

  // Lecture recording methods
  async getLectureRecording(id: string): Promise<LectureRecording | undefined> {
    const [recording] = await db.select().from(lectureRecordings).where(eq(lectureRecordings.id, id));
    return recording || undefined;
  }

  async getActiveRecording(boardId: string): Promise<LectureRecording | undefined> {
    const [recording] = await db.select().from(lectureRecordings).where(
      and(eq(lectureRecordings.boardId, boardId), eq(lectureRecordings.status, "recording"))
    );
    return recording || undefined;
  }

  async createLectureRecording(recording: InsertLectureRecording): Promise<LectureRecording> {
    const [created] = await db.insert(lectureRecordings).values(recording).returning();
    return created;
  }

  async updateLectureRecording(id: string, updates: Partial<InsertLectureRecording>): Promise<LectureRecording | undefined> {
    const [updated] = await db.update(lectureRecordings).set(updates).where(eq(lectureRecordings.id, id)).returning();
    return updated || undefined;
  }

  async getRecordingsByBoard(boardId: string): Promise<LectureRecording[]> {
    return db.select().from(lectureRecordings).where(eq(lectureRecordings.boardId, boardId)).orderBy(desc(lectureRecordings.startedAt));
  }

  // Lecture transcript methods
  async getLectureTranscript(id: string): Promise<LectureTranscript | undefined> {
    const [transcript] = await db.select().from(lectureTranscripts).where(eq(lectureTranscripts.id, id));
    return transcript || undefined;
  }

  async getTranscriptByRecording(recordingId: string): Promise<LectureTranscript | undefined> {
    const [transcript] = await db.select().from(lectureTranscripts).where(eq(lectureTranscripts.recordingId, recordingId));
    return transcript || undefined;
  }

  async createLectureTranscript(transcript: InsertLectureTranscript): Promise<LectureTranscript> {
    const [created] = await db.insert(lectureTranscripts).values(transcript).returning();
    return created;
  }

  // AI chat session methods
  async getAiChatSession(id: string): Promise<AiChatSession | undefined> {
    const [session] = await db.select().from(aiChatSessions).where(eq(aiChatSessions.id, id));
    return session || undefined;
  }

  async getActiveAiChatSession(boardId: string): Promise<AiChatSession | undefined> {
    const [session] = await db.select().from(aiChatSessions).where(
      and(eq(aiChatSessions.boardId, boardId), eq(aiChatSessions.status, "active"))
    );
    return session || undefined;
  }

  async getAiChatSessionsByBoard(boardId: string): Promise<AiChatSession[]> {
    return db.select().from(aiChatSessions).where(eq(aiChatSessions.boardId, boardId)).orderBy(desc(aiChatSessions.createdAt));
  }

  async createAiChatSession(session: InsertAiChatSession): Promise<AiChatSession> {
    const [created] = await db.insert(aiChatSessions).values(session).returning();
    return created;
  }

  async updateAiChatSession(id: string, updates: Partial<InsertAiChatSession>): Promise<AiChatSession | undefined> {
    const [updated] = await db.update(aiChatSessions).set(updates).where(eq(aiChatSessions.id, id)).returning();
    return updated || undefined;
  }

  // AI chat participant methods
  async getAiChatParticipant(sessionId: string, participantId: string): Promise<AiChatParticipant | undefined> {
    const [participant] = await db.select().from(aiChatParticipants).where(
      and(eq(aiChatParticipants.sessionId, sessionId), eq(aiChatParticipants.participantId, participantId))
    );
    return participant || undefined;
  }

  async getAiChatParticipantById(id: string): Promise<AiChatParticipant | undefined> {
    const [participant] = await db.select().from(aiChatParticipants).where(eq(aiChatParticipants.id, id));
    return participant || undefined;
  }

  async getAiChatParticipants(sessionId: string): Promise<AiChatParticipant[]> {
    return db.select().from(aiChatParticipants).where(eq(aiChatParticipants.sessionId, sessionId));
  }

  async createAiChatParticipant(participant: InsertAiChatParticipant): Promise<AiChatParticipant> {
    const [created] = await db.insert(aiChatParticipants).values(participant).returning();
    return created;
  }

  async updateAiChatParticipant(id: string, updates: Partial<InsertAiChatParticipant>): Promise<AiChatParticipant | undefined> {
    const [updated] = await db.update(aiChatParticipants).set(updates).where(eq(aiChatParticipants.id, id)).returning();
    return updated || undefined;
  }

  // AI chat message methods
  async getAiChatMessages(sessionId: string, participantId: string): Promise<AiChatMessage[]> {
    return db.select().from(aiChatMessages).where(
      and(eq(aiChatMessages.sessionId, sessionId), eq(aiChatMessages.participantId, participantId))
    ).orderBy(asc(aiChatMessages.createdAt));
  }

  async createAiChatMessage(message: InsertAiChatMessage): Promise<AiChatMessage> {
    const [created] = await db.insert(aiChatMessages).values(message).returning();
    return created;
  }
}

export const storage = new DatabaseStorage();
