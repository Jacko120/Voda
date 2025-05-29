import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const corsRequests = pgTable("cors_requests", {
  id: serial("id").primaryKey(),
  mainUrl: text("main_url").notNull(),
  apiUrl: text("api_url").notNull(),
  cookies: jsonb("cookies").$type<Record<string, string>>(),
  response: jsonb("response"),
  status: text("status").notNull(), // 'pending', 'success', 'error'
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCorsRequestSchema = createInsertSchema(corsRequests).pick({
  mainUrl: true,
  apiUrl: true,
});

export type InsertCorsRequest = z.infer<typeof insertCorsRequestSchema>;
export type CorsRequest = typeof corsRequests.$inferSelect;

// API response types
export interface CorsExecuteRequest {
  mainUrl: string;
  journeyUrl?: string;
  apiUrl: string;
}

export interface CorsExecuteResponse {
  id: number;
  cookies: Record<string, string>;
  apiResponse: any;
  status: 'success' | 'error';
  error?: string;
}

export interface CorsProgressResponse {
  step: 'fetching_cookies' | 'making_api_call' | 'complete';
  status: 'in_progress' | 'complete' | 'error';
  cookies?: Record<string, string>;
  apiResponse?: any;
  error?: string;
}
