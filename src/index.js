
import { DurableObject } from "cloudflare:workers";

const MAX_CODE_LENGTH = 8192;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("Turtle Remote Shell is running.");
    }

    if (!url.pathname.startsWith("/ws/")) {
      return new Response("Not found", { status: 404 });
    }

    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", {
        status: 426
      });
    }

    const parts = url.pathname.split("/");
    const role = parts[2];
    const turtleId = parts[3];

    const authorization = request.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "");

    if (role === "server") {
      if (!env.SERVER_TOKEN || token !== env.SERVER_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
    } else if (role === "turtle") {
      if (!turtleId || !/^[a-zA-Z0-9_-]{1,64}$/.test(turtleId)) {
        return new Response("Invalid turtle ID", { status: 400 });
      }

      if (!env.TURTLE_TOKEN || token !== env.TURTLE_TOKEN) {
        return new Response("Unauthorized", { status: 401 });
      }
    } else {
      return new Response("Invalid client role", { status: 400 });
    }

    const id = env.TURTLE_ROUTER.idFromName("main-fleet");
    const stub = env.TURTLE_ROUTER.get(id);

    const headers = new Headers(request.headers);
    headers.set("X-Client-Role", role);

    if (turtleId) {
      headers.set("X-Turtle-ID", turtleId);
    }

    return stub.fetch(new Request(request, { headers }));
  }
};

export class TurtleRouter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
  }

  async fetch(request) {
    const role = request.headers.get("X-Client-Role");
    const turtleId = request.headers.get("X-Turtle-ID");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Prevent two active connections claiming the same turtle ID.
    if (role === "turtle") {
      for (const socket of this.ctx.getWebSockets()) {
        const info = socket.deserializeAttachment();

        if (
          info?.role === "turtle" &&
          info.turtleId === turtleId
        ) {
          try {
            socket.close(4001, "Replaced by a new connection");
          } catch {}
        }
      }
    }

    server.serializeAttachment({
      role,
      turtleId: turtleId || null
    });

    this.ctx.acceptWebSocket(server);

    if (role === "server") {
      server.send(JSON.stringify({
        type: "connected",
        turtles: this.getConnectedTurtles()
      }));
    }

    if (role === "turtle") {
      this.broadcastToServers({
        type: "turtle_connected",
        turtleId
      });
    }

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  getConnectedTurtles() {
    return this.ctx.getWebSockets()
      .map(socket => socket.deserializeAttachment())
      .filter(info => info?.role === "turtle")
      .map(info => info.turtleId);
  }

  broadcastToServers(message) {
    const serialized = JSON.stringify(message);

    for (const socket of this.ctx.getWebSockets()) {
      const info = socket.deserializeAttachment();

      if (info?.role !== "server") continue;

      try {
        socket.send(serialized);
      } catch {
        // Ignore disconnected clients.
      }
    }
  }

  findTurtle(turtleId) {
    return this.ctx.getWebSockets().find(socket => {
      const info = socket.deserializeAttachment();

      return info?.role === "turtle" &&
             info.turtleId === turtleId;
    });
  }

  webSocketMessage(ws, message) {
    const client = ws.deserializeAttachment();

    if (!client) return;

    let data;

    try {
      data = JSON.parse(
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message)
      );
    } catch {
      return;
    }

    // Server -> Turtle
    if (client.role === "server") {
      if (data.type !== "shell_request") {
        return;
      }

      if (
        typeof data.turtleId !== "string" ||
        typeof data.requestId !== "string" ||
        typeof data.code !== "string"
      ) {
        this.sendError(ws, data.requestId, "Invalid request");
        return;
      }

      if (data.code.length > MAX_CODE_LENGTH) {
        this.sendError(ws, data.requestId, "Code exceeds maximum length");
        return;
      }

      const target = this.findTurtle(data.turtleId);

      if (!target) {
        this.sendError(ws, data.requestId, "Turtle not connected");
        return;
      }

      try {
        target.send(JSON.stringify({
          type: "shell_request",
          requestId: data.requestId,
          code: data.code
        }));
      } catch {
        this.sendError(ws, data.requestId, "Failed to deliver request");
      }

      return;
    }

    // Turtle -> Server
    if (client.role === "turtle") {
      if (data.type === "shell_response") {
        this.broadcastToServers({
          type: "shell_response",
          turtleId: client.turtleId,
          payload: data
        });
      } else {
        this.broadcastToServers({
          type: "turtle_message",
          turtleId: client.turtleId,
          payload: data
        });
      }
    }
  }

  sendError(ws, requestId, message) {
    try {
      ws.send(JSON.stringify({
        type: "shell_error",
        requestId: requestId || null,
        message
      }));
    } catch {}
  }

  webSocketClose(ws, code, reason) {
    const client = ws.deserializeAttachment();

    if (client?.role === "turtle") {
      this.broadcastToServers({
        type: "turtle_disconnected",
        turtleId: client.turtleId
      });
    }

    // Complete the WebSocket closing handshake.
    if (
      code >= 1000 &&
      code < 5000 &&
      ![1004, 1005, 1006, 1015].includes(code)
    ) {
      ws.close(code, reason);
    } else {
      ws.close();
    }
  }

  webSocketError(ws) {
    // The connection is no longer usable.
  }
}
