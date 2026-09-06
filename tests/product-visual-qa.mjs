import { chromium } from "@playwright/test";
import fs from "node:fs";
import { overview, mail, calendar, applications } from "./fixtures/product-pages.mjs";

const views = { overview, mail, calendar, applications };
const sizes = [
  ["desktop", 1440, 960],
  ["tablet", 1024, 900],
  ["mobile", 390, 844],
];

const css = ["app/tokens.css", "app/globals.css", "app/workspace.css", "app/product.css"]
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");

const browser = await chromium.launch({ headless: true });
try {
  fs.mkdirSync("artifacts/product", { recursive: true });
  for (const [view, render] of Object.entries(views)) {
    for (const [size, width, height] of sizes) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setContent(`<!doctype html><html lang="de" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${render()}</body></html>`, { waitUntil: "load" });
      await page.screenshot({ path: `artifacts/product/${view}-${size}.png`, fullPage: true });
      const result = await page.evaluate(() => ({
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        viewportWidth: document.documentElement.clientWidth,
        contentWidth: document.documentElement.scrollWidth,
      }));
      if (result.documentOverflow || errors.length) {
        throw new Error(`${view}/${size}: overflow=${result.contentWidth - result.viewportWidth}px; ${errors.join("; ")}`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
}