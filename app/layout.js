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

const APP_URL = "https://tot-app.vercel.app";

export const metadata = {
  title: "T|T Picks — Sharp MLB Picks",
  description: "Sharp MLB model. Free pick every day. Full breakdowns, edge data, and filter for serious bettors.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "T|T Picks",
  },
  openGraph: {
    title: "T|T Picks — Sharp MLB Picks",
    description: "Free pick daily. Full model breakdowns. Edge analytics for serious bettors.",
    url: APP_URL,
    siteName: "T|T Picks",
    images: [{ url: `${APP_URL}/api/og`, width: 1200, height: 630, alt: "T|T Picks — Today's Free Pick" }],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@ThisorThatPicks",
    creator: "@ThisorThatPicks",
    title: "T|T Picks — Sharp MLB Picks",
    description: "Free pick daily. Full model breakdowns. Edge analytics for serious bettors.",
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
