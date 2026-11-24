import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dundra",
  description: "Your self-hosted character and story workspace.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
