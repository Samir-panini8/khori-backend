import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'teacher'
      );
      
      CREATE TABLE IF NOT EXISTS boards (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        room_code TEXT NOT NULL UNIQUE,
        creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        end_time TIMESTAMP WITH TIME ZONE,
        is_ended BOOLEAN DEFAULT FALSE,
        is_public BOOLEAN DEFAULT TRUE,
        password TEXT
      );
      
      CREATE TABLE IF NOT EXISTS board_data (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        drawing_data JSONB DEFAULT '[]'::jsonb,
        UNIQUE(board_id, user_id)
      );
      
      CREATE TABLE IF NOT EXISTS session (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      );
      CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);
    `);
    console.log("Database tables initialized successfully");
  } catch (error) {
    console.error("Error initializing database tables:", error);
    throw error;
  } finally {
    client.release();
  }
}
