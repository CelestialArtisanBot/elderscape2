/**
 * ElderScape Worker
 *
 * This Worker integrates Cloudflare Workers AI for an MMORPG-themed chat
 * and Cloudflare D1 for persistent storage, including player authentication
 * and game state management.
 *
 * @license MIT
 */
import { Env, ChatMessage, WebSocketMessage } from "./types";
import { Retries } from "durable-utils";
import { ChatRoomDO } from "./chat_room_do"; // Import the Durable Object class

export { ChatRoomDO } from "./chat_room_do"; // Explicit re-export for Wrangler

// Model ID for Workers AI model
// https://developers.cloudflare.com/workers-ai/models/
const MODEL_ID = "@cf/mistral/mistral-7b-instruct-v0.2";

// Default system prompt for Elara, the Loremaster
const SYSTEM_PROMPT =
  "You are Elara, the Loremaster of Oakhaven, a wise and ancient NPC in the world of Elderscape, a classic MMORPG reminiscent of Runescape. Your primary role is to act as a 'World Builder's Assistant' and 'Chat Helper'. Speak in a fantasy-appropriate tone, using language that fits a medieval setting. You can: \n\n1.  **Generate Lore & Descriptions**: Create detailed descriptions for new areas, NPCs, items, or events based on player requests. \n2.  **Suggest Quests**: Outline potential quests, including objectives, rewards, and challenges. \n3.  **Craft Dialogue**: Help write dialogue snippets for NPCs. \n4.  **Interpret Rules**: Explain game mechanics or lore. \n5.  **Offer Guidance**: Provide advice on skills, crafting, or combat, always within the Elderscape context. \n\nEncourage exploration and interaction within the world. Keep your responses concise but engaging, always staying in character and focusing on assisting the player in building or understanding the game world. When generating content, try to provide options or open-ended suggestions to foster creativity.";

export default {
  /**
   * Main request handler for the Worker
   */
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    // Handle static assets (frontend)
    if (url.pathname === "/" || !url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    // --- D1 Session Management ---
    const bookmark =
      request.headers.get("x-d1-bookmark") ?? "first-unconstrained";
    const session = env.ELDERSCAPE_DB.withSession(bookmark);

    try {
      // Wrap D1-related requests with table initialization and session handling
      const response = await withTablesInitialized(
        request,
        session,
        async (req, dbSession) => {
          // --- API Routes ---
          if (url.pathname === "/api/chat") {
            // Handle POST requests for AI chat
            if (request.method === "POST") {
              return handleAIChatRequest(req, env);
            }
            return new Response("Method not allowed", { status: 405 });
          } else if (url.pathname.startsWith("/api/auth")) {
            return handleAuthRequest(req, dbSession);
          } else if (url.pathname.startsWith("/api/player_stats")) {
            return handlePlayerStatsRequest(req, dbSession);
          } else if (url.pathname.startsWith("/api/settings")) { // KV settings
            return handleSettingsRequest(req, env);
          } else if (url.pathname === "/api/game_chat_ws") {
            // Handle WebSocket upgrade for game chat
            const id = env.CHAT_ROOM.idFromName("global-game-chat"); // A single global chat room
            const stub = env.CHAT_ROOM.get(id);
            return stub.fetch(request);
          }

          // Handle 404 for unmatched API routes
          return new Response("Not found", { status: 404 });
        },
      );

      // Return the bookmark so we can continue the Session in another request.
      response.headers.set("x-d1-bookmark", session.getBookmark() ?? "");
      return response;
    } catch (e) {
      console.error({
        message: "Failed to handle request with D1 session",
        error: String(e),
        errorProps: e,
        url,
        bookmark,
      });
      return Response.json(
        { error: String(e), errorDetails: e },
        { status: 500 },
      );
    }
  },
  // Durable Object Class binding
  // This is how the Worker knows about the Durable Object class
  // and can create/get instances of it.
  // The class name must match the class_name in wrangler.jsonc
  ChatRoomDO: ChatRoomDO,
};

/**
 * Handles AI chat API requests
 */
async function handleAIChatRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  try {
    const { messages = [] } = (await request.json()) as {
      messages: ChatMessage[];
    };

    if (!messages.some((msg) => msg.role === "system")) {
      messages.unshift({ role: "system", content: SYSTEM_PROMPT });
    }

    const response = await env.AI.run(
      MODEL_ID,
      {
        messages,
        max_tokens: 1024,
      },
      {
        returnRawResponse: true,
      },
    );

    return response;
  } catch (error) {
    console.error("Error processing AI chat request:", error);
    return new Response(
      JSON.stringify({ error: "Failed to process AI chat request" }),
      {
        status: 500,
        headers: { "content-type": "application/json" },
      },
    );
  }
}

/**
 * Handles authentication requests (register, login)
 */
async function handleAuthRequest(
  request: Request,
  db: D1DatabaseSession,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "POST") {
    if (url.pathname === "/api/auth/register") {
      return await registerUser(request, db);
    } else if (url.pathname === "/api/auth/login") {
      return await loginUser(request, db);
    }
  }
  return new Response("Not found", { status: 404 });
}

async function registerUser(request: Request, db: D1DatabaseSession) {
  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return Response.json({ error: "Username and password required" }, { status: 400 });
    }

    // Hash password (for production, use a proper hashing library)
    const password_hash = await hashPassword(password); // Placeholder for actual hashing

    const { success } = await db
      .prepare(
        "INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)",
      )
      .bind(crypto.randomUUID(), username, password_hash)
      .run();

    if (success) {
      return Response.json({ message: "Registration successful" }, { status: 201 });
    } else {
      return Response.json({ error: "Registration failed" }, { status: 500 });
    }
  } catch (e: any) {
    if (e.message && e.message.includes("UNIQUE constraint failed")) {
      return Response.json({ error: "Username already exists" }, { status: 409 });
    }
    console.error("Error registering user:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function loginUser(request: Request, db: D1DatabaseSession) {
  try {
    const { username, password } = (await request.json()) as {
      username?: string;
      password?: string;
    };
    if (!username || !password) {
      return Response.json({ error: "Username and password required" }, { status: 400 });
    }

    const { results } = await db
      .prepare("SELECT id, password_hash FROM players WHERE username = ?")
      .bind(username)
      .all();

    if (results && results.length > 0) {
      const player = results[0] as { id: string; password_hash: string };
      // Compare password (for production, use a proper hashing library)
      const isPasswordValid = await verifyPassword(password, player.password_hash); // Placeholder

      if (isPasswordValid) {
        // In a real app, you'd generate a session token here
        return Response.json({ message: "Login successful", playerId: player.id }, { status: 200 });
      }
    }
    return Response.json({ error: "Invalid credentials" }, { status: 401 });
  } catch (e) {
    console.error("Error logging in user:", e);
    return Response.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Placeholder for password hashing (use a robust library in production)
async function hashPassword(password: string): Promise<string> {
  // For demo purposes, a simple hash. In production, use Argon2, bcrypt, etc.
  return btoa(password); // Base64 encode as a very weak "hash"
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return btoa(password) === hash;
}


/**
 * Handles player stats requests
 */
async function handlePlayerStatsRequest(
  request: Request,
  db: D1DatabaseSession,
): Promise<Response> {
  const url = new URL(request.url);
  const playerId = url.searchParams.get("playerId"); // Assuming playerId is passed as a query param for now

  if (!playerId) {
    return Response.json({ error: "Player ID required" }, { status: 400 });
  }

  if (request.method === "GET") {
    try {
      const { results } = await db
        .prepare("SELECT * FROM player_stats WHERE player_id = ?")
        .bind(playerId)
        .all();

      if (results && results.length > 0) {
        return Response.json(results[0], { status: 200 });
      } else {
        // If no stats, create default ones
        await db.prepare(
          "INSERT INTO player_stats (player_id, health, coins) VALUES (?, ?, ?)"
        ).bind(playerId, 100, 0).run();
        const { results: newStats } = await db
        .prepare("SELECT * FROM player_stats WHERE player_id = ?")
        .bind(playerId)
        .all();
        return Response.json(newStats[0], { status: 200 });
      }
    } catch (e) {
      console.error("Error fetching player stats:", e);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }
  return new Response("Method not allowed", { status: 405 });
}

/**
 * Handles settings requests using KV.
 */
async function handleSettingsRequest(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.pathname.replace("/api/settings/", "");

  if (!key) {
    return Response.json({ error: "Setting key required" }, { status: 400 });
  }

  if (request.method === "GET") {
    try {
      const value = await env.ELDERSCAPE_KV.get(key);
      if (value === null) {
        return Response.json({ error: "Setting not found" }, { status: 404 });
      }
      return Response.json({ key, value }, { status: 200 });
    } catch (e) {
      console.error("Error getting setting from KV:", e);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  } else if (request.method === "PUT") {
    try {
      const { value } = (await request.json()) as { value: string };
      if (value === undefined) {
        return Response.json({ error: "Value required" }, { status: 400 });
      }
      await env.ELDERSCAPE_KV.put(key, value);
      return Response.json({ message: "Setting updated", key, value }, { status: 200 });
    } catch (e) {
      console.error("Error putting setting to KV:", e);
      return Response.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  return new Response("Method not allowed", { status: 405 });
}


// --- D1 Helper Functions (adapted from d1-starter-sessions-api-template) ---

function shouldRetry(err: unknown, nextAttempt: number) {
  const errMsg = String(err);
  const isRetryableError =
    errMsg.includes("Network connection lost") ||
    errMsg.includes("storage caused object to be reset") ||
    errMsg.includes("reset because its code was updated");
  if (nextAttempt <= 5 && isRetryableError) {
    return true;
  }
  return false;
}

/**
 * This is mostly for DEMO purposes to avoid having to do separate schema migrations step.
 * This will check if the error is because our main table is missing, and if it is create the table
 * and rerun the handler.
 */
async function withTablesInitialized(
  request: Request,
  session: D1DatabaseSession,
  handler: (request: Request, session: D1DatabaseSession) => Promise<Response>,
) {
  // We use clones of the body since if we parse it once, and then retry with the
  // same request, it will fail due to the body stream already being consumed.
  try {
    return await handler(request.clone(), session);
  } catch (e) {
    // Check for specific D1 error indicating missing table
    if (String(e).includes("no such table") || String(e).includes("SQLITE_ERROR")) {
      console.warn("D1 table(s) not found, attempting to initialize schema...");
      await initTables(session);
      return await handler(request.clone(), session);
    }
    throw e;
  }
}

async function initTables(session: D1DatabaseSession) {
  console.log("Initializing D1 tables...");
  // This should ideally read from src/schema.sql, but for simplicity,
  // we'll hardcode the CREATE TABLE statements here for auto-initialization.
  // In a production setup, schema migrations should be managed separately.
  const schema = `
    CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      race TEXT,
      created_at INTEGER DEFAULT (strftime('%s', 'now')),
      last_login INTEGER DEFAULT (strftime('%s', 'now')),
      subscription_expires INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS player_stats (
      player_id TEXT PRIMARY KEY,
      level INTEGER DEFAULT 1,
      total_xp INTEGER DEFAULT 0,
      fatigue INTEGER DEFAULT 0,
      health INTEGER DEFAULT 100,
      location_x REAL DEFAULT 0.0,
      location_y REAL DEFAULT 0.0,
      location_z REAL DEFAULT 0.0,
      coins INTEGER DEFAULT 0,
      skills_json TEXT,
      FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS world_zones (
      id TEXT PRIMARY KEY,
      first_discoverer TEXT,
      discovered_at INTEGER DEFAULT (strftime('%s', 'now')),
      geographic_coords TEXT,
      biome_type TEXT,
      folklore_region TEXT,
      generated_content TEXT,
      FOREIGN KEY (first_discoverer) REFERENCES players(id) ON DELETE SET NULL
    );
  `;
  await session.exec(schema);
  console.log("D1 tables initialized.");
}

// This function is not currently used but kept for completeness from the template
async function resetTables(session: D1DatabaseSession) {
  return await session
    .prepare(
      `DROP TABLE IF EXISTS players;
       DROP TABLE IF EXISTS player_stats;
       DROP TABLE IF EXISTS world_zones;`
    )
    .all();
}
