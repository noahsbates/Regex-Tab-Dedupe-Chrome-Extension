import { expect, test, chromium, type BrowserContext } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("saves a rule, closes the new duplicate, and focuses the old tab", async () => {
  const extensionPath = resolve(import.meta.dirname, "../../dist");
  const userDataDirectory = await mkdtemp(join(tmpdir(), "regex-tab-dedupe-"));
  const server = await startServer();
  let context: BrowserContext | undefined;

  try {
    context = await chromium.launchPersistentContext(userDataDirectory, {
      channel: "chromium",
      headless: true,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(serviceWorker.url()).host;

    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole("tab", { name: "PRESETS" }).click();
    await popup
      .getByRole("button", {
        name: "Use Same URL without query or fragment preset",
      })
      .click();
    await popup.getByRole("button", { name: "Save rule" }).click();
    await expect(
      popup.getByRole("heading", {
        name: "Same URL without query or fragment",
      }),
    ).toBeVisible();

    const first = await context.newPage();
    await first.goto(`${server.origin}/same-page?source=first`);
    await expect(first.locator("h1")).toHaveText("Test page");

    const second = await context.newPage();
    const secondNavigation = second
      .goto(`${server.origin}/same-page?source=second`)
      .catch(() => null);

    await expect
      .poll(
        () => context?.pages().some((page) => page === second) ?? true,
        { timeout: 1_500 },
      )
      .toBe(false);
    await secondNavigation;
    await expect(first).toHaveURL(`${server.origin}/same-page?source=first`);

    const activeUrl = await serviceWorker.evaluate(async () => {
      const activeTabs = await chrome.tabs.query({ active: true });
      return activeTabs.find((tab) => tab.url?.startsWith("http"))?.url;
    });
    expect(activeUrl).toBe(`${server.origin}/same-page?source=first`);
  } finally {
    await context?.close();
    await server.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

async function startServer(): Promise<{
  readonly origin: string;
  close(): Promise<void>;
}> {
  const server = createServer((request, response) => {
    if (request.url?.includes("source=second") === true) {
      const timer = setTimeout(() => sendTestPage(response), 5_000);
      timer.unref();
      request.once("close", () => clearTimeout(timer));
      return;
    }
    sendTestPage(response);
  });
  await listen(server);
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Test server did not provide a TCP address.");
  }
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}

function sendTestPage(response: import("node:http").ServerResponse): void {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><title>Test</title><h1>Test page</h1>");
}

function listen(server: Server): Promise<void> {
  return new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolveListen();
    });
  });
}
