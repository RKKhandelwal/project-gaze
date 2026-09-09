import type { Metadata } from "next";
import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { TimezoneProvider } from "@/lib/TimezoneContext";
import { VideoFeedProvider } from "@/lib/VideoFeedContext";
import TopNav from "@/components/TopNav";
import Chat from "@/components/Chat";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Project Gaze · McKenzie Park Courts",
  description:
    "Pickleball court occupancy tracking for McKenzie Park, Los Altos.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plex.variable} ${mono.variable}`}>
      <body>
        <TimezoneProvider>
          <VideoFeedProvider>
            <TopNav />
            {children}
            <Chat />
          </VideoFeedProvider>
        </TimezoneProvider>
      </body>
    </html>
  );
}
