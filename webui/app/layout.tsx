import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const inter = Inter({subsets:['latin'],variable:'--font-sans'});

// DEVELOPMENT ONLY. React's dev-only Server Components performance track
// sometimes calls performance.measure() with a negative end time for an
// aborted/errored component. Firefox throws on that ("Performance.measure:
// Given attribute end cannot be negative") and Next's dev overlay shows it as
// an app error on every navigation. Upstream: react/react#37561 (fix in
// react/react#37572, unmerged as of React 19.3.1). Remove this once the fix
// ships. Production builds don't include React's performance track or this.
// It must run before React does, hence an inline <head> script.
const DEV_PERF_MEASURE_GUARD = `(() => {
  const p = window.performance;
  if (!p || !p.measure || p.__xcommMeasureGuard) return;
  const measure = p.measure.bind(p);
  p.measure = function (...args) {
    try {
      return measure(...args);
    } catch (err) {
      if (err && /negative/i.test(String(err.message))) return undefined;
      throw err;
    }
  };
  p.__xcommMeasureGuard = true;
})();`;

export const metadata: Metadata = {
  title: "xCOMM HUD",
  description: "xCOMM HUD — aggregated communications status dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", "font-sans", inter.variable)}
      suppressHydrationWarning
    >
      {process.env.NODE_ENV === "development" && (
        <head>
          <script dangerouslySetInnerHTML={{ __html: DEV_PERF_MEASURE_GUARD }} />
        </head>
      )}
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem={false}
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
