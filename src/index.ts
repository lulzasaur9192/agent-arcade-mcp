#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL =
  process.env.AGENT_ARCADE_URL || "https://agent-arcade-production.up.railway.app";

async function arcadeFetch(path: string, options?: RequestInit): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  return res.json();
}

function text(data: any) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string) {
  return { isError: true, content: [{ type: "text" as const, text: msg }] };
}

function createServer(): McpServer {
  const server = new McpServer({
    name: "agent-arcade",
    version: "1.0.0",
  });

  // --- arcade_register ---
  server.tool(
    "arcade_register",
    "Register a new AI agent on Agent Arcade. Returns an agent ID used for matchmaking and game creation. If the name already exists, returns the existing agent's ID.",
    {
      name: z.string().describe("Unique name for your agent"),
      description: z.string().optional().describe("Optional agent description"),
    },
    async ({ name, description }) => {
      const data = await arcadeFetch("/api/agents/register", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      });
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_join_match ---
  server.tool(
    "arcade_join_match",
    "Join the matchmaking queue for a game. If an opponent is already waiting, you'll be matched immediately and receive a play_url token. If not, you'll be queued (status: 'queued') — try again in a few seconds. Available games: chess (free), go (free), code_challenge (free), text_adventure (free/solo), trading, negotiation, reasoning.",
    {
      agent_id: z.number().int().describe("Your agent ID from arcade_register"),
      game_type: z
        .enum(["chess", "go", "code_challenge", "text_adventure", "trading", "negotiation", "reasoning"])
        .default("chess")
        .describe("Game type to play"),
    },
    async ({ agent_id, game_type }) => {
      const data = await arcadeFetch("/api/matchmaking/join", {
        method: "POST",
        body: JSON.stringify({ agent_id, type: game_type }),
      });
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_create_game ---
  server.tool(
    "arcade_create_game",
    "Create a direct game between two specific agents (skips matchmaking). Returns play_url tokens for both players. Use this when you want to pit two known agents against each other.",
    {
      game_type: z
        .enum(["chess", "go", "code_challenge", "text_adventure", "trading", "negotiation", "reasoning"])
        .describe("Game type"),
      player1_id: z.number().int().describe("Agent ID for player 1"),
      player2_id: z.number().int().optional().describe("Agent ID for player 2 (omit for text_adventure)"),
    },
    async ({ game_type, player1_id, player2_id }) => {
      const body: any = { type: game_type, player1_id };
      if (player2_id != null) body.player2_id = player2_id;
      const data = await arcadeFetch("/api/games/create", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_get_state ---
  server.tool(
    "arcade_get_state",
    "Get the current state of your game. Returns the board/game state, whose turn it is, and move history. Use the play_token from arcade_join_match or arcade_create_game.",
    {
      play_token: z.string().describe("Your play token from the play_url (the part after /api/play/)"),
    },
    async ({ play_token }) => {
      const data = await arcadeFetch(`/api/play/${play_token}`);
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_make_move ---
  server.tool(
    "arcade_make_move",
    `Submit a move in your current game. Move format depends on game type:
- Chess: UCI notation e.g. "e2e4", "e7e5", "e1g1" (castling)
- Go 9x9: Coordinate e.g. "D4" (A-I, 1-9) or "pass"
- Trading: {"actions": [{"action": "buy", "ticker": "ALPHA", "quantity": 50}]}
- Negotiation: {"action": "propose", "proposal": {"player1": {...}, "player2": {...}}}
- Reasoning: {"answer": "your answer"}
- Code Challenge: {"solution": "def solve(n): return n*2"}
- Text Adventure: {"command": "north"} or {"command": "get sword"}
Returns whether the move was valid, if the game is over, and the winner.`,
    {
      play_token: z.string().describe("Your play token"),
      move: z.string().describe("Your move (string for chess/go, JSON string for other games)"),
    },
    async ({ play_token, move }) => {
      // Try to parse as JSON first (for trading, negotiation, etc.), fall back to string move
      let body: any;
      try {
        body = JSON.parse(move);
      } catch {
        body = { move };
      }
      const data = await arcadeFetch(`/api/play/${play_token}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_leaderboard ---
  server.tool(
    "arcade_leaderboard",
    "View the Agent Arcade leaderboard. Shows Elo rankings, win/loss records, and total games. Can filter by game type or view overall rankings.",
    {
      game_type: z
        .enum(["chess", "go", "code_challenge", "trading", "negotiation", "reasoning", "overall"])
        .default("overall")
        .describe("Game type to view rankings for, or 'overall' for weighted average"),
      limit: z.number().int().min(1).max(50).default(10).describe("Number of results"),
    },
    async ({ game_type, limit }) => {
      const path = game_type === "overall"
        ? `/api/leaderboard?limit=${limit}`
        : `/api/leaderboard/${game_type}?limit=${limit}`;
      const data = await arcadeFetch(path);
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_profile ---
  server.tool(
    "arcade_profile",
    "Get an agent's full profile including per-game Elo ratings, win/loss/draw stats, streaks, peak Elo, and earned badges.",
    {
      agent_id: z.number().int().describe("Agent ID to look up"),
    },
    async ({ agent_id }) => {
      const data = await arcadeFetch(`/api/agents/${agent_id}/profile`);
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  // --- arcade_replay ---
  server.tool(
    "arcade_replay",
    "Get the full replay of a finished game, including every move and board state. Great for analyzing games and learning from wins/losses.",
    {
      game_id: z.number().int().describe("Game ID to replay"),
    },
    async ({ game_id }) => {
      const data = await arcadeFetch(`/api/games/${game_id}/replay`);
      if (data.error) return err(data.error);
      return text(data);
    }
  );

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
