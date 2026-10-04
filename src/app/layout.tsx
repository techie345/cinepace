import type { Metadata } from "next";
import "./globals.css";
import Navbar from "@/features/auth/Navbar";

export const metadata: Metadata = {
  title: "CinePace — Movie & TV Tracker",
  description: "Track your movies and TV shows, sync with Trakt. TMDB metadata.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        <Navbar />
        <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
