// src/chat_room_do.ts
import { WebSocketMessage } from "./types";

interface Client {
  ws: WebSocket;
  quit: boolean;
}

export class ChatRoomDO implements DurableObject {
  state: DurableObjectState;
  env: Env;
  clients: Client[] = [];
  messages: WebSocketMessage[] = []; // Store recent messages

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
  }

  // Handle HTTP requests to the Durable Object
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case "/websocket": {
        if (request.headers.get("Upgrade") !== "websocket") {
          return new Response("Expected WebSocket upgrade", { status: 426 });
        }

        const { 0: client, 1: server } = new WebSocketPair();

        await this.handleWebSocket(server);

        return new Response(null, { status: 101, webSocket: client });
      }
      default:
        return new Response("Not found", { status: 404 });
    }
  }

  async handleWebSocket(server: WebSocket) {
    server.accept();

    const client: Client = { ws: server, quit: false };
    this.clients.push(client);

    // Send recent message history to the new client
    client.ws.send(JSON.stringify({ type: "history", messages: this.messages }));

    server.addEventListener("message", async (event: MessageEvent) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data as string);
        this.messages.push(message); // Add to history
        // Keep history to a reasonable size
        if (this.messages.length > 100) {
          this.messages = this.messages.slice(-100);
        }

        // Broadcast to all clients
        this.clients = this.clients.filter((c) => {
          try {
            c.ws.send(JSON.stringify(message));
            return true;
          } catch (e) {
            c.quit = true;
            return false;
          }
        });
      } catch (e) {
        console.error("Error processing WebSocket message:", e);
      }
    });

    server.addEventListener("close", (event: CloseEvent) => {
      console.log(`WebSocket closed: ${event.code} ${event.reason}`);
      client.quit = true;
    });

    server.addEventListener("error", (event: Event) => {
      console.error("WebSocket error:", event);
      client.quit = true;
    });
  }
}