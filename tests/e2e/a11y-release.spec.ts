import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type TestInfo } from "@playwright/test";

const publicReports = [
  {
    village_id: "village-1",
    report_period: "Tháng 7/2026",
    published_at: "2026-07-28T08:00:00+07:00",
    values: { CT01: 318, CT02: 1176, CT09: 286, CT12: 6, CT13: 124 },
  },
];

async function mockPublicApi(page: Page): Promise<void> {
  const json = (body: unknown) => ({
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route("**/health/ready", (route) =>
    route.fulfill({ status: 200, ...json({ status: "ready" }) }),
  );
  await page.route("**/reports/villages", (route) =>
    route.fulfill({
      status: 200,
      ...json([{ id: "village-1", name: "Thôn An Sơn" }]),
    }),
  );
  await page.route("**/reports/public", (route) =>
    route.fulfill({ status: 200, ...json(publicReports) }),
  );
  await page.route("**/reports/public/metadata", (route) =>
    route.fulfill({
      status: 200,
      ...json({
        schema_version: "public-report-v1",
        registry_version: "2026-07-28.1",
        source_label:
          "Báo cáo thôn có trạng thái đã công bố trên Ba Na SmartLink",
        indicators: [
          ["CT01", "Tổng số hộ dân", "Số hộ dân.", "hộ", "Không phải điểm."],
          ["CT02", "Tổng số nhân khẩu", "Số người.", "người", "Không phải điểm."],
          ["CT09", "Gia đình văn hóa", "Số hộ đạt.", "hộ", "Không xếp hạng."],
          ["CT12", "Tổ công nghệ số", "Số thành viên.", "người", "Số đếm."],
          ["CT13", "Người được hướng dẫn", "Số người.", "người/kỳ", "Số đếm."],
        ].map(([code, label, definition, unit, interpretation_limit]) => ({
          code,
          label,
          definition,
          unit,
          interpretation_limit,
        })),
      }),
    }),
  );
  await page.route("**/api/pilots/evacuation-points", (route) =>
    route.fulfill({
      status: 200,
      ...json([
        {
          id: "point-1",
          village_id: "village-1",
          name: "Nhà văn hóa thôn An Sơn",
          latitude: 16.02,
          longitude: 108.01,
          capacity_households: 120,
          is_verified: true,
        },
      ]),
    }),
  );
}

async function openPublicPortal(page: Page): Promise<void> {
  await mockPublicApi(page);
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(
    page.getByRole("navigation", { name: "Điều hướng cổng công khai" }),
  ).toBeVisible();
  await expect(
    page
      .locator(".metric-card")
      .filter({ hasText: "CT01 · Tổng số hộ dân" }),
  ).toBeVisible();
}

async function expectNoBlockingAxeViolations(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  const blocking = result.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(
    blocking,
    blocking
      .map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.length} node)`,
      )
      .join("\n"),
  ).toEqual([]);
}

async function expectNoHorizontalTaskLoss(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth + 1);

  const navigation = page.getByRole("navigation", {
    name: "Điều hướng cổng công khai",
  });
  for (const button of await navigation.getByRole("button").all()) {
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(layout.clientWidth + 1);
  }
}

async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

for (const viewport of [
  { width: 360, height: 800 },
  { width: 768, height: 900 },
  { width: 1280, height: 900 },
]) {
  test(`public tasks remain accessible at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await openPublicPortal(page);
    await expectNoHorizontalTaskLoss(page);
    await expectNoBlockingAxeViolations(page);
    await attachScreenshot(page, testInfo, `public-${viewport.width}px`);
  });
}

test("keyboard focus is visible and activates the correction task", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPublicPortal(page);

  const skipLink = page.getByRole("link", { name: "Bỏ qua điều hướng" });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();
  const skipFocusStyle = await skipLink.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(skipFocusStyle.style).not.toBe("none");
  expect(skipFocusStyle.width).toBeGreaterThanOrEqual(2);
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();

  const correctionButton = page.getByRole("button", {
    name: "Đề nghị đối chiếu số liệu",
  });
  await correctionButton.focus();
  const focusStyle = await correctionButton.evaluate((element) => {
    const style = getComputedStyle(element);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(focusStyle.style).not.toBe("none");
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);

  await correctionButton.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: "Đề nghị đối chiếu số liệu" }),
  ).toBeFocused();
  await expect(page.getByRole("button", { name: /Tiếp tục/ })).toBeVisible();
});

test("200 percent text zoom keeps every public task available", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPublicPortal(page);
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" });

  await expectNoHorizontalTaskLoss(page);
  await expect(
    page.getByRole("button", { name: "Đề nghị đối chiếu số liệu" }),
  ).toBeVisible();
  await expectNoBlockingAxeViolations(page);
  await attachScreenshot(page, testInfo, "public-200-percent-text-zoom");
});
