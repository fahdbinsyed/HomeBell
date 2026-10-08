import type { Metadata } from "next";
import "./style.css";
export const metadata: Metadata = {
  title: "HomeBell · Owner console",
  description: "School access and platform operations",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
