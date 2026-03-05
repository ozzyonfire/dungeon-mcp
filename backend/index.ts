import { startServer } from "./src/server";

const app = startServer();
console.log(`dungeon-mcp running on :${app.port}`);
