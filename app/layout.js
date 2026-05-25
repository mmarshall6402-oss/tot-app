import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const APP_URL = "https://thisorthatpicks.com";

export const metadata = {
  title: "T|T Picks — Sharp MLB Picks",
  description: "We outperform Vegas odds with data. Sharp MLB model with pitcher analysis, edge scoring, and a 6-layer filter. Free pick every morning.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "T|T Picks",
  },
  openGraph: {
    title: "T|T Picks — Sharp MLB Picks",
    description: "We outperform Vegas odds with data. Free pick daily. Full model breakdowns and edge analytics.",
    url: APP_URL,
    siteName: "T|T Picks",
    images: [{ url: `${APP_URL}/api/og`, width: 1200, height: 630, alt: "T|T — Sharp MLB Picks" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ThisorThatPicks",
    creator: "@ThisorThatPicks",
    title: "T|T Picks — Sharp MLB Picks",
    description: "We outperform Vegas odds with data. Free pick daily. Full model breakdowns and edge analytics.",
    images: [`${APP_URL}/api/og`],
  },
};

export const viewport = {
  themeColor: "#00FF87",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="apple-touch-icon" href="/icon.svg" />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
