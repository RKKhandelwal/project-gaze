export const metadata = {
  title: "Gaze Server",
  description: "Project Gaze backend API",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
