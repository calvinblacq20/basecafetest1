import { expect, test } from "@playwright/test";

const noHorizontalOverflow = async (page: import("@playwright/test").Page) =>
  page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth,
  );

test("POS exposes device-bound sign-in without invented live data", async ({
  page,
}) => {
  await page.goto("http://localhost:3000/");
  await expect(
    page.getByRole("heading", { name: "Sign in to start selling" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("textbox", { name: /device id/i })).toBeVisible();
  await expect(page.getByRole("textbox", { name: /email/i })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /authenticator or recovery code/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/real Base Cafe|production payment|fiscal receipt/i),
  ).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("Admin fictional catalog is reachable only through explicit demo mode", async ({
  page,
}) => {
  await page.goto("http://localhost:3001/?demo=1");
  await expect(page.getByText(/fictional demo data/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Demo Smash Burger", exact: true }),
  ).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("Admin live entry is protected and exposes optional MFA without forcing it", async ({
  page,
}) => {
  await page.goto("http://localhost:3001/");
  await expect(
    page.getByRole("heading", { name: "Sign in to manage this branch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: /authenticator or recovery code/i }),
  ).toBeVisible();
  await expect(page.getByText(/fictional demo data/i)).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("Security and privacy posture demo is explicitly labeled and PII-safe", async ({
  page,
}) => {
  await page.goto("http://localhost:3001/security?demo=1");
  await expect(
    page.getByRole("heading", { name: "Security & audit" }),
  ).toBeVisible();
  await expect(page.getByText(/demonstration data/i)).toBeVisible();
  await expect(
    page.getByText("demo-v2", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(/raw phone|delivery directions/i)).toHaveCount(0);
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("Pilot readiness demo keeps recovery and integration blockers visible", async ({
  page,
}) => {
  await page.goto("http://localhost:3001/readiness?demo=1");
  await expect(
    page.getByRole("heading", { name: "Pilot readiness" }),
  ).toBeVisible();
  await expect(page.getByText(/development preview/i)).toBeVisible();
  await expect(
    page.getByText(/backup and isolated restore/i).first(),
  ).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test("KDS fictional queue is non-live and exposes cancelled history", async ({
  page,
}) => {
  await page.goto("http://localhost:3002/?demo=1");
  await expect(page.getByText(/fictional demo queue/i)).toBeVisible();
  const cancelled = page.getByRole("complementary", {
    name: "Cancelled ticket entries",
  });
  await expect(cancelled.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(cancelled.getByText(/DEMO-04/)).toBeVisible();
  await page.goto("http://localhost:3002/");
  await expect(
    page.getByRole("textbox", { name: /authenticator or recovery code/i }),
  ).toBeVisible();
  expect(await noHorizontalOverflow(page)).toBe(true);
});
