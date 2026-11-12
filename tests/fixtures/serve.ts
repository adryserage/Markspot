// Sert tests/fixtures/page.html à toute adresse, sur 127.0.0.1, port libre au hasard.

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

export async function serveFixtures(): Promise<{ url: string; server: Server }> {
  const root = import.meta.dirname;
  const server = createServer(async (_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(await readFile(join(root, "page.html")));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { url: `http://127.0.0.1:${address.port}/`, server };
}
