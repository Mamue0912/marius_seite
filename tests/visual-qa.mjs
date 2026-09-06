import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";

async function main() {
  const stub = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(req.url?.includes("/auth/") ? JSON.stringify({ user: null }) : JSON.stringify({}));
  });
  await new Promise((resolve) => stub.listen(3997, "127.0.0.1", resolve));

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3997",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-key",
    TOKEN_ENC_KEY: Buffer.alloc(32).toString("base64"),
    OAUTH_STATE_SECRET: "test",
    CRON_SECRET: "test",
    GRAPH_CLIENT_STATE: "test",
    APP_BASE_URL: "http://127.0.0.1:3114",
  };
  const next = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3114"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  try {
    let serverLog = "";
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Server start timeout: ${serverLog}`)), 30_000);
      const capture = (data) => {
        serverLog += String(data);
        if (serverLog.includes("Ready")) {
          clearTimeout(timer);
          resolve();
        }
      };
      next.stdout?.on("data", capture);
      next.stderr?.on("data", capture);
      next.on("exit", (code) => reject(new Error(`Server exited ${code}: ${serverLog}`)));
    });

    const browser = await chromium.launch({ headless: true });
    try {
      fs.mkdirSync("artifacts", { recursive: true });
      for (const [name, width, height] of [["desktop", 1440, 960], ["laptop", 1280, 800], ["tablet", 1024, 900], ["mobile", 390, 844]]) {
        const page = await browser.newPage({ viewport: { width, height } });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const response = await page.goto("http://127.0.0.1:3114", { waitUntil: "networkidle" });
        if (!response?.ok()) throw new Error(`HTTP ${response?.status()}`);
        await page.screenshot({ path: `artifacts/login-${name}.png`, fullPage: true });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        if (overflow || errors.length) {
          throw new Error(`${name}: ${overflow ? "horizontal overflow " : ""}${errors.join(";")}`);
        }
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    next.kill();
    stub.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
