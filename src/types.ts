/**
 * Type definitions for the LLM chat application.
 */

export interface Env {
  /**
   * Binding for the Workers AI API.
   */
  AI: Ai;

  /**
   * Binding for static assets.
   */
  ASSETS: { fetch: (request: Request) => Promise<Response> };

  /**
   * Binding for the ElderScape D1 Database.
   */
  ELDERSCAPE_DB: D1Database;

  /**
   * Binding for the ElderScape KV Namespace.
   */
  ELDERSCAPE_KV: KVNamespace;

  /**
   * Binding for the ChatRoom Durable Object.
   */
  CHAT_ROOM: DurableObjectNamespace;
}

/**
 * Represents a chat message.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Type for messages sent over WebSocket to Durable Object
export interface WebSocketMessage {
  type: "chat" | "system";
  sender: string;
  content: string;
  timestamp: number;
}
