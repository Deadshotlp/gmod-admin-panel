import type { PanelUser } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
import { getActiveServer, getServers } from "@/lib/servers";
import AppFrame from "./AppFrame";

/**
 * Rahmen mit Seitenleiste. Liest serverseitig, was der Rahmen braucht, und
 * übergibt es an AppFrame - dort sitzt alles, was im Browser schaltet.
 */
export default async function Shell({
  user,
  current,
  children,
  wide = false,
}: {
  user: PanelUser;
  current: string;
  children: React.ReactNode;
  /** volle Breite (z. B. Karten) */
  wide?: boolean;
}) {
  const servers = getServers().map((server) => ({
    id: server.id,
    label: server.label,
  }));

  let activeId = servers[0]?.id ?? "";

  try {
    activeId = (await getActiveServer()).id;
  } catch {
    // Ohne Konfiguration bleibt es beim ersten Eintrag
  }

  const brand = getBrand();

  return (
    <AppFrame
      brand={{ name: brand.name, community: brand.community, mark: brand.mark, logo: brand.logo }}
      user={{ displayName: user.displayName, role: user.role }}
      servers={servers}
      activeId={activeId}
      current={current}
      wide={wide}
    >
      {children}
    </AppFrame>
  );
}
