import "./globals.css";

export const metadata = {
  title: "AI Model Radar — tracking new model releases as they appear",
  description:
    "AI Model Radar tracks new and emerging AI models the moment they show signs of going viral — from anonymous stealth releases on OpenRouter to confirmed launches from OpenAI, Anthropic, and others — with verified status, sourcing, and no fabricated details.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
