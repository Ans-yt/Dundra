const icons = {
  brand: "/icons/book-open.svg",
  library: "/icons/library.svg",
  transfer: "/icons/arrow-up-down.svg",
  chat: "/icons/message.svg",
  personas: "/icons/user-circle.svg",
  settings: "/icons/settings.svg",
} as const;

export function NavigationIcon({ name }: { name: keyof typeof icons }) {
  return <span className="navigation-icon" aria-hidden="true" style={{ maskImage: `url("${icons[name]}")` }} />;
}
