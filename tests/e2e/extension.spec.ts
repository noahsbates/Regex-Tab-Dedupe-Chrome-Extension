import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { type BrowserContext, chromium, expect, test } from "@playwright/test";

test("a rule can keep either the old or new duplicate tab", async () => {
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
        name: "Apply Same URL without query or fragment preset",
      })
      .click();
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
      .poll(() => context?.pages().some((page) => page === second) ?? true, {
        timeout: 1_500,
      })
      .toBe(false);
    await secondNavigation;
    await expect(first).toHaveURL(`${server.origin}/same-page?source=first`);

    const activeUrl = await serviceWorker.evaluate(async () => {
      const activeTabs = await chrome.tabs.query({ active: true });
      return activeTabs.find((tab) => tab.url?.startsWith("http"))?.url;
    });
    expect(activeUrl).toBe(`${server.origin}/same-page?source=first`);

    await popup.getByRole("tab", { name: "RULES" }).click();
    await popup
      .getByRole("button", {
        name: "Edit Same URL without query or fragment",
      })
      .click();
    await popup.getByRole("button", { name: "+ Advanced rules" }).click();
    await popup
      .getByRole("checkbox", {
        name: "Close old tab instead",
      })
      .check();
    await popup.locator('[name="newTabPattern"]').fill("source=third$");
    await popup.getByRole("button", { name: "Save rule" }).click();

    const third = await context.newPage();
    await third.goto(`${server.origin}/same-page?source=third`);
    await expect
      .poll(() => context?.pages().some((page) => page === first) ?? true, {
        timeout: 1_500,
      })
      .toBe(false);
    await expect(third).toHaveURL(`${server.origin}/same-page?source=third`);

    const newestActiveUrl = await serviceWorker.evaluate(async () => {
      const activeTabs = await chrome.tabs.query({ active: true });
      return activeTabs.find((tab) => tab.url?.startsWith("http"))?.url;
    });
    expect(newestActiveUrl).toBe(`${server.origin}/same-page?source=third`);
  } finally {
    await context?.close();
    await server.close();
    await rm(userDataDirectory, { recursive: true, force: true });
  }
});

test("the GitHub comment preset replaces a plain PR tab only for comment links", async () => {
  const extensionPath = resolve(import.meta.dirname, "../../dist");
  const userDataDirectory = await mkdtemp(join(tmpdir(), "regex-tab-github-"));
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
    await context.route("https://github.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>GitHub fixture</title><h1>Pull request</h1>",
      }),
    );
    const serviceWorker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(serviceWorker.url()).host;
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await popup.getByRole("tab", { name: "PRESETS" }).click();
    await popup
      .getByRole("button", {
        name: "Apply Switch to new GitHub comment preset",
      })
      .click();

    const oldPr = await context.newPage();
    await oldPr.goto("https://github.com/acme/widgets/pull/42/files");
    const comment = await context.newPage();
    await comment.goto(
      "https://github.com/acme/widgets/pull/42#discussion_r3717711453",
    );

    await expect
      .poll(() => context?.pages().some((page) => page === oldPr) ?? true, {
        timeout: 1_500,
      })
      .toBe(false);
    await expect(comment).toHaveURL(
      "https://github.com/acme/widgets/pull/42#discussion_r3717711453",
    );

    const ordinaryDuplicate = await context.newPage();
    const ordinaryNavigation = ordinaryDuplicate
      .goto("https://github.com/acme/widgets/pull/42/commits")
      .catch(() => null);
    await expect
      .poll(
        () =>
          context?.pages().some((page) => page === ordinaryDuplicate) ?? true,
        { timeout: 1_500 },
      )
      .toBe(false);
    await ordinaryNavigation;
    await expect(comment).toHaveURL(
      "https://github.com/acme/widgets/pull/42#discussion_r3717711453",
    );
  } finally {
    await context?.close();
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
    close: () =>
      new Promise((resolveClose) => server.close(() => resolveClose())),
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
