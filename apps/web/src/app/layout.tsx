import "@fontsource-variable/noto-sans-sc";
import "@fontsource/lxgw-wenkai/300.css";

import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "CollabDocs · 一起写，就在此刻",
  description: "免登录、多人实时协作的在线文档工作室。",
  applicationName: "CollabDocs",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F6F3EC",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
