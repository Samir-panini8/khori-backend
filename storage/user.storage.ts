import { db } from "../db";
import { users, type User, type InsertUser } from "../model/users";
import { eq } from "drizzle-orm";

export class UsersStorage {
  async getById(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getByUsername(username: string): Promise<User | undefined> {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.username, username));
    return user;
  }

  async create(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async getAll(): Promise<User[]> {
    return db.select().from(users);
  }

  async getUsersByRole(role: string): Promise<User[]> {
    return await db.select().from(users).where(eq(users.role, role));
  }

  async updatePassword(id: string, hashedPassword: string): Promise<boolean> {
    await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, id));
    return true;
  }
}
