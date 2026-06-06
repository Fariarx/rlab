import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.BASE_URL ?? "http://localhost:5187";
const OUT = process.env.OUT_DIR ?? "/tmp/kit-shots";

const messages = [];

function attach(page, tag) {
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      messages.push(`[${tag}] console.${type}: ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    messages.push(`[${tag}] pageerror: ${err.message}`);
  });
  page.on("requestfailed", (req) => {
    messages.push(`[${tag}] requestfailed: ${req.url()} (${req.failure()?.errorText})`);
  });
}

async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`saved ${name}.png`);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });

try {
  await mkdir(OUT, { recursive: true });
  const page = await context.newPage();
  attach(page, "page");

  // Dashboard (default route)
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await shot(page, "01-dashboard");

  // UI kit showcase
  await page.goto(`${BASE}/#/kit`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await shot(page, "02-kit-full");

  // Interactions
  await page.getByRole("button", { name: "info toast" }).click();
  await page.getByRole("button", { name: "error toast" }).click();
  await page.waitForTimeout(300);
  await shot(page, "03-kit-toasts");

  await page.getByRole("button", { name: "open dialog" }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/04-kit-dialog.png` });
  console.log("saved 04-kit-dialog.png");
  await page.keyboard.press("Escape");
} finally {
  await context.close();
  await browser.close();
}

console.log("\n=== console / page issues (errors+warnings) ===");
if (messages.length === 0) {
  console.log("none");
} else {
  for (const m of messages) {
    console.log(m);
  }
}
