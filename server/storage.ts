import { corsRequests, type CorsRequest, type InsertCorsRequest } from "@shared/schema";

export interface IStorage {
  createCorsRequest(request: InsertCorsRequest): Promise<CorsRequest>;
  getCorsRequest(id: number): Promise<CorsRequest | undefined>;
  updateCorsRequest(id: number, data: Partial<CorsRequest>): Promise<CorsRequest | undefined>;
}

export class MemStorage implements IStorage {
  private corsRequests: Map<number, CorsRequest>;
  private currentId: number;

  constructor() {
    this.corsRequests = new Map();
    this.currentId = 1;
  }

  async createCorsRequest(insertRequest: InsertCorsRequest): Promise<CorsRequest> {
    const id = this.currentId++;
    const request: CorsRequest = {
      ...insertRequest,
      id,
      cookies: null,
      response: null,
      status: 'pending',
      error: null,
      createdAt: new Date(),
    };
    this.corsRequests.set(id, request);
    return request;
  }

  async getCorsRequest(id: number): Promise<CorsRequest | undefined> {
    return this.corsRequests.get(id);
  }

  async updateCorsRequest(id: number, data: Partial<CorsRequest>): Promise<CorsRequest | undefined> {
    const existing = this.corsRequests.get(id);
    if (!existing) return undefined;
    
    const updated = { ...existing, ...data };
    this.corsRequests.set(id, updated);
    return updated;
  }
}

export const storage = new MemStorage();
