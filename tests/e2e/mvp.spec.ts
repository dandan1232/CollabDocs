import { expect, test } from "@playwright/test";

test("访客可完成团队协作、离线恢复、分享、附件、搜索和回收站流程", async ({
  browser,
  page,
}) => {
  const bootstrapResponse = await page.request.post("/api/session");
  const session = (await bootstrapResponse.json()) as {
    workspaces: Array<{ id: string }>;
  };
  expect(bootstrapResponse.ok(), JSON.stringify(session)).toBeTruthy();
  const personalWorkspaceId = session.workspaces[0]?.id;
  expect(personalWorkspaceId).toBeTruthy();
  const treeResponse = await page.request.get(
    `/api/workspaces/${personalWorkspaceId}/tree`,
  );
  const initialTree = (await treeResponse.json()) as {
    documents: Array<{ title: string }>;
  };
  expect(treeResponse.ok(), JSON.stringify(initialTree)).toBeTruthy();
  expect(initialTree.documents.map((document) => document.title)).toContain(
    "欢迎来到 CollabDocs",
  );

  const browserErrors: string[] = [];
  page.on("pageerror", (error) =>
    browserErrors.push(`pageerror: ${error.stack}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") {
      browserErrors.push(`console: ${message.text()}`);
    }
  });
  const sessionResponsePromise = page
    .waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/session",
      { timeout: 15_000 },
    )
    .catch((error: unknown) => {
      browserErrors.push(
        `session-response: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    });
  await page.goto("/");
  const browserSessionResponse = await sessionResponsePromise;
  if (browserSessionResponse && !browserSessionResponse.ok()) {
    browserErrors.push(
      `session-http-${browserSessionResponse.status()}: ${await browserSessionResponse.text()}`,
    );
  }
  await page.waitForTimeout(1_000);
  const initialBodyText = await page.locator("body").innerText();
  expect(
    initialBodyText,
    `首页未显示欢迎文档。URL=${page.url()}，页面内容=${initialBodyText}，浏览器错误=${browserErrors.join(" | ")}`,
  ).toContain("欢迎来到 CollabDocs");

  await page.getByRole("button", { name: "新建团队空间" }).click();
  await page.getByPlaceholder("输入名称后按 Enter").fill("端到端协作空间");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    page.getByText("端到端协作空间", { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "新建文件夹" }).click();
  await page.getByPlaceholder("输入名称后按 Enter").fill("验收资料");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.getByText("验收资料", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "邀请伙伴" }).click();
  const inviteLink = await page
    .locator(".invite-dialog input[readonly]")
    .inputValue();

  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await memberPage.goto(inviteLink);
  await expect(
    memberPage.getByText("端到端协作空间", { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "关闭邀请窗口" }).click();
  await page.getByRole("button", { name: "新建文档" }).click();
  await page.getByPlaceholder("输入名称后按 Enter").fill("多人验收文档");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".document-editor .tiptap")).toBeVisible();
  const documentId = new URL(page.url()).searchParams.get("document");
  expect(documentId).toBeTruthy();

  const memberDocumentResponsePromise = memberPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `/api/documents/${documentId}`,
  );
  await memberPage.goto(`/?document=${documentId}`);
  expect((await memberDocumentResponsePromise).ok()).toBeTruthy();
  const ownerEditor = page.locator(".document-editor .tiptap");
  const memberEditor = memberPage.locator(".document-editor .tiptap");
  await expect(memberEditor).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("实时协作已连接", { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(
    memberPage.getByText("实时协作已连接", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await ownerEditor.click();
  await page.keyboard.insertText("实时协作正文-SEARCH-UNIQUE");
  await expect(ownerEditor).toContainText("实时协作正文-SEARCH-UNIQUE");
  await expect(memberEditor).toContainText("实时协作正文-SEARCH-UNIQUE");

  await page.context().setOffline(true);
  await ownerEditor.press("End");
  await page.keyboard.insertText(" 离线补充");
  await page.context().setOffline(false);
  await expect(memberEditor).toContainText("离线补充", { timeout: 30_000 });

  const mobileShareResponse = await page.request.post("/api/shares", {
    data: { documentId, permission: "edit" },
  });
  const mobileShare = (await mobileShareResponse.json()) as { token: string };
  expect(mobileShareResponse.ok(), JSON.stringify(mobileShare)).toBeTruthy();
  const mobileSyncContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) " +
      "AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 " +
      "MicroMessenger/8.0.75 NetType/WIFI Language/zh_CN",
  });
  const mobileSyncPage = await mobileSyncContext.newPage();
  await mobileSyncPage.goto(`/?share=${encodeURIComponent(mobileShare.token)}`);
  const mobileSyncEditor = mobileSyncPage.locator(".document-editor .tiptap");
  await expect(mobileSyncEditor).toBeVisible({ timeout: 30_000 });
  await expect(mobileSyncEditor).toHaveAttribute("contenteditable", "true");
  await mobileSyncEditor.click();
  await mobileSyncPage.keyboard.insertText("MOBILE-TO-DESKTOP-SYNC");
  await expect(ownerEditor).toContainText("MOBILE-TO-DESKTOP-SYNC", {
    timeout: 30_000,
  });

  const attachmentInput = page.locator(
    'input[type="file"][accept*="application/pdf"]',
  );
  await attachmentInput.setInputFiles({
    name: "协作说明.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("CollabDocs E2E attachment"),
  });
  await expect(
    ownerEditor.getByText("协作说明.txt", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "分享", exact: true }).click();
  await page.getByRole("button", { name: "生成只读链接" }).click();
  const shareLink = await page
    .locator(".share-dialog input[readonly]")
    .inputValue();
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await viewerPage.goto(shareLink);
  await expect(viewerPage.getByText("只读", { exact: true })).toBeVisible();
  await expect(viewerPage.locator(".document-editor .tiptap")).toHaveAttribute(
    "contenteditable",
    "false",
  );

  await page.getByRole("button", { name: "关闭分享窗口" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "移到回收站" }).click();
  await expect(page.getByRole("button", { name: "回收站" })).toBeVisible();
  const recoveryResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname.startsWith("/api/workspaces/") &&
      url.pathname.endsWith("/tree") &&
      url.searchParams.get("view") === "trash"
    );
  });
  await page.getByRole("button", { name: "回收站" }).click();
  expect((await recoveryResponsePromise).ok()).toBeTruthy();
  const trashedRow = page
    .locator(".content-row")
    .filter({ hasText: "多人验收文档" });
  await expect(trashedRow).toBeVisible();
  await trashedRow.locator("button.text-button").click();
  await expect(trashedRow).toBeHidden();
  await page.getByRole("button", { name: "工作台" }).click();

  const search = page.getByRole("textbox", { name: "搜索" });
  await search.fill("SEARCH-UNIQUE");
  await expect(page.getByText("多人验收文档", { exact: true })).toBeVisible();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+K" : "Control+K",
  );
  await expect(search).toBeFocused();

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto("/");
  await expect(
    mobilePage.getByRole("button", { name: "打开导航" }),
  ).toBeVisible();
  await mobilePage.getByRole("button", { name: "打开导航" }).click();
  await expect(
    mobilePage.getByRole("navigation", { name: "内容导航" }),
  ).toBeVisible();
  await mobilePage
    .getByRole("complementary")
    .getByRole("button", { name: "关闭导航" })
    .click();
  await mobilePage
    .getByText("欢迎来到 CollabDocs", { exact: true })
    .first()
    .click();
  const mobileEditor = mobilePage.locator(".document-editor .tiptap");
  await expect(mobileEditor).toBeVisible();
  await expect(mobileEditor).toHaveAttribute("contenteditable", "true");

  await Promise.all([
    memberContext.close(),
    viewerContext.close(),
    mobileSyncContext.close(),
    mobileContext.close(),
  ]);
});
