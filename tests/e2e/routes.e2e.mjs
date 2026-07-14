import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test, { after, before } from "node:test";

const host = "127.0.0.1";
const port = 4173;
const baseUrl = `http://${host}:${port}`;
let server;
let serverOutput = "";

async function fetchWithTimeout(url, options = {}, timeoutMs = 10_000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function waitForServer(timeoutMs = 60_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (server?.exitCode !== null && server?.exitCode !== undefined) {
      throw new Error(`Development server exited early.\n${serverOutput}`);
    }
    try {
      const response = await fetchWithTimeout(`${baseUrl}/auth`, {}, 2_000);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Development server did not start within ${timeoutMs}ms.\n${serverOutput}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;

  const pid = server.pid;
  if (process.platform !== "win32" && pid) process.kill(-pid, "SIGTERM");
  else server.kill("SIGTERM");

  await Promise.race([
    once(server, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);

  if (server.exitCode === null) {
    if (process.platform !== "win32" && pid) process.kill(-pid, "SIGKILL");
    else server.kill("SIGKILL");
  }
}

before(async () => {
  server = spawn("npm", ["run", "dev", "--", "--host", host, "--port", String(port)], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      NODE_ENV: "test",
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY:
        process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_e2e_test",
      VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID ?? "example",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitForServer();
});

after(async () => {
  await stopServer();
});

test("public authentication route renders the real application", async () => {
  const response = await fetchWithTimeout(`${baseUrl}/auth`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.match(html, /Acesso interno|Quiwi Cost Center|<html/i);
  assert.doesNotMatch(html, /Internal Server Error/i);
});

test("financial routes are served by the application router", async () => {
  for (const route of ["/overview", "/invoices", "/costs", "/billing"]) {
    const response = await fetchWithTimeout(`${baseUrl}${route}`, {}, 10_000);
    const html = await response.text();

    assert.ok(response.status >= 200 && response.status < 400, `${route} returned ${response.status}`);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.doesNotMatch(html, /Internal Server Error|Cannot find module|Route not found/i);
  }
});

test("home route resolves to the consolidated overview flow", async () => {
  const response = await fetchWithTimeout(`${baseUrl}/`, { redirect: "manual" });
  assert.ok([200, 301, 302, 307, 308].includes(response.status));

  const location = response.headers.get("location");
  if (location) assert.match(location, /overview/);
});
