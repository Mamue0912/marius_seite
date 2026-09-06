import { spawn } from "node:child_process";
import http from "node:http";

async function waitForServer(process, timeoutMs) {
  let output = "";
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Server start timeout: " + output)), timeoutMs);
    const capture = (data) => { output += String(data); if (output.includes("Ready")) { clearTimeout(timer); resolve(); } };
    process.stdout?.on("data", capture);
    process.stderr?.on("data", capture);
    process.on("exit", (code) => { clearTimeout(timer); reject(new Error("Server exited " + code + ": " + output)); });
  });
}

async function main() {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(req.url?.includes("/auth/") ? JSON.stringify({ user: null }) : JSON.stringify({}));
  });
  await new Promise((resolve) => stub.listen(3996, "127.0.0.1", resolve));
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3996", NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key", SUPABASE_SERVICE_ROLE_KEY: "test-service-key", TOKEN_ENC_KEY: Buffer.alloc(32).toString("base64"), OAUTH_STATE_SECRET: "test-state-secret", CRON_SECRET: "test-cron-secret", GRAPH_CLIENT_STATE: "test-graph-state", APP_BASE_URL: "http://127.0.0.1:3115" };
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3115"], { env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    await waitForServer(server, 30000);
    const protectedEndpoints = [
      ["/api/tasks", "GET"],
      ["/api/applications", "GET"],
      ["/api/applications/test-id", "GET"],
      ["/api/applications/test-id", "PATCH"],
      ["/api/applications/test-id", "DELETE"],
      ["/api/applications/test-id/assign", "POST"],
      ["/api/applications/analyze", "POST"],
      ["/api/applications/analyze-website", "POST"],
      ["/api/applications/chat", "POST"],
      ["/api/applications/refine-doc", "POST"],
      ["/api/applications/send", "POST"],
      ["/api/applications/doc/test-id", "PATCH"],
      ["/api/applications/doc/test-id", "DELETE"],
      ["/api/documents", "GET"],
      ["/api/documents/test-id/facts", "POST"],
      ["/api/mail/sync", "POST"],
      ["/api/mail/action", "POST"],
      ["/api/mail/categorize", "POST"],
      ["/api/mail/connect", "POST"],
      ["/api/mail/create-folder", "POST"],
      ["/api/mail/disconnect", "POST"],
      ["/api/mail/folder", "GET"],
      ["/api/mail/folder-action", "POST"],
      ["/api/mail/generate-reply", "POST"],
      ["/api/mail/img", "GET"],
      ["/api/mail/test", "POST"],
      ["/api/reply/generate", "POST"],
      ["/api/reply/refine", "POST"],
      ["/api/reply/send", "POST"],
      ["/api/calendar/events", "GET"],
      ["/api/rules", "GET"],
      ["/api/status", "GET"]
    ];
    for (const [endpoint, method] of protectedEndpoints) {
      const response = await fetch("http://127.0.0.1:3115" + endpoint, { method });
      if (response.status !== 401) throw new Error(endpoint + " returned " + response.status + " instead of 401");
    }
    const redirect = await fetch("http://127.0.0.1:3115/auth/callback?next=https://evil.example/path", { redirect: "manual" });
    const location = redirect.headers.get("location") || "";
    const target = new URL(location);
    if (target.port !== "3115" || !["127.0.0.1", "localhost"].includes(target.hostname) || target.pathname !== "/" || location.includes("evil.example")) throw new Error("Unsafe auth redirect: " + location);
    console.log("API smoke checks passed: " + protectedEndpoints.length + " protected routes and safe auth redirect.");
  } finally { server.kill(); stub.close(); }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
