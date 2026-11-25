import clsx from "clsx";

/**
 * Nyay Apex logo. `on="auto"` follows the site theme (navy wordmark on light, white wordmark on dark);
 * `on="dark"` is for always-dark panels such as the app sidebar.
 */
export function Logo({ on = "auto", className }: { on?: "auto" | "light" | "dark"; className?: string }) {
  const img = (src: string, extra?: string) => (
    // eslint-disable-next-line @next/next/no-img-element -- static file, sized by CSS
    <img src={src} alt="Nyay Apex - AI-Powered Legal Intelligence" width={832} height={226} className={clsx("h-full w-auto", extra)} />
  );
  return (
    <span className={clsx("inline-flex h-10 shrink-0", className)}>
      {on === "light" && img("/logo.png")}
      {on === "dark" && img("/logo-dark.png")}
      {on === "auto" && <>{img("/logo.png", "dark:hidden")}{img("/logo-dark.png", "hidden dark:block")}</>}
    </span>
  );
}
