import { db } from "../db";
import { users, type User, type InsertUser } from "../model/users";
import { eq, and, ilike, sql } from "drizzle-orm";

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

  async getAllPaginated(limit: number, offset: number): Promise<User[]> {
    return db.select().from(users).limit(limit).offset(offset);
  }

  async getUsersByRolePaginated(
    role: string,
    limit: number,
    offset: number,
    search?: string,
  ): Promise<User[]> {
    const conditions = [eq(users.role, role)];

    if (search && search.trim()) {
      const pattern = `%${search.trim()}%`;

      conditions.push(ilike(users.username, pattern));
    }

    return await db
      .select()
      .from(users)
      .where(and(...conditions))
      .limit(limit)
      .offset(offset);
  }

  async countUsersByRole(role: string, search?: string): Promise<number> {
    const conditions = [eq(users.role, role)];

    if (search && search.trim()) {
      const pattern = `%${search.trim()}%`;
      conditions.push(ilike(users.username, pattern));
    }

    const [result] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(users)
      .where(and(...conditions));

    return Number(result.count);
  }

  async updatePassword(id: string, hashedPassword: string): Promise<boolean> {
    await db
      .update(users)
      .set({ password: hashedPassword })
      .where(eq(users.id, id));
    return true;
  }
}
