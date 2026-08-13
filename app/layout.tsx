import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const title = "拼豆稿｜图片转拼豆像素画";
const description = "上传图片，自定义底板、画面比例与颜色数量，生成色块干净的拼豆像素稿和配色用量表。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000")
    .split(",")[0]
    .trim();
  const protocol = (requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https"))
    .split(",")[0]
    .trim();
  const imageUrl = new URL("/og.png", `${protocol}://${host}`).toString();

  return {
    title,
    description,
    applicationName: "拼豆稿",
    openGraph: {
      type: "website",
      locale: "zh_CN",
      title,
      description,
      images: [{ url: imageUrl, width: 1728, height: 900, alt: "拼豆稿像素画工具" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
