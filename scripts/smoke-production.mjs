const baseUrlValue = process.argv[2] ?? process.env.COLLABDOCS_BASE_URL;

if (!baseUrlValue) {
  console.error(
    "Usage: pnpm smoke:production -- https://docs.example.com\n" +
      "Or set COLLABDOCS_BASE_URL.",
  );
  process.exit(2);
}

const baseUrl = new URL(baseUrlValue);
const requestTimeoutMs = 8_000;

async function checkHealth(path, expectedService) {
  const response = await fetch(new URL(path, baseUrl), {
    headers: { Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok || !contentType.includes("application/json")) {
    throw new Error(
      `${path} returned HTTP ${response.status} with ${contentType || "no content type"}`,
    );
  }

  const payload = await response.json();
  if (payload.service !== expectedService || payload.status !== "ok") {
    throw new Error(`${path} returned an unexpected health payload`);
  }
  console.log(`ok ${path}`);
}

async function checkWebSocketUpgrade() {
  const realtimeUrl = new URL("/realtime", baseUrl);
  realtimeUrl.protocol = baseUrl.protocol === "https:" ? "wss:" : "ws:";

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(realtimeUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("WebSocket upgrade timed out"));
    }, requestTimeoutMs);

    socket.addEventListener(
      "open",
      () => {
        clearTimeout(timeout);
        socket.close(1000, "smoke check complete");
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      "error",
      () => {
        clearTimeout(timeout);
        reject(new Error("WebSocket upgrade failed"));
      },
      { once: true },
    );
  });
  console.log("ok /realtime WebSocket upgrade");
}

try {
  await checkHealth("/api/health/live", "collabdocs-web");
  await checkHealth("/api/health/ready", "collabdocs-web");
  await checkWebSocketUpgrade();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
