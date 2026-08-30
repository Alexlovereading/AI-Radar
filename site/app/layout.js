import Link from "next/link";
import "./globals.css";

export const metadata = {
  title: "AI 新词雷达 — 提前发现值得关注的新模型",
  description:
    "持续扫描模型平台、官方渠道与社区信号，核验并评估新出现的 AI 模型名称。",
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <header className="site-topnav">
          <div className="site-topnav-inner">
            <Link href="/" className="site-topnav-brand">
              AI 新词雷达
            </Link>
            <nav className="site-topnav-links" aria-label="站点导航">
              <Link href="/">模型雷达</Link>
              <Link href="/community">社区热点</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
