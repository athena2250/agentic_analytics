import { SlidersHorizontal } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar.jsx";
import { Separator } from "@/components/ui/separator.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Button } from "@/components/ui/button.jsx";

/**
 * Top bar for the workspace view: sidebar toggle, session name, table count,
 * and the trigger for the technical-details Sheet (plan §7/§8).
 */
export default function AppHeader({ session, onOpenTechnical, technicalAvailable }) {
  const tableCount = Object.keys(session?.tables ?? {}).length;

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background px-3">
      <SidebarTrigger />
      <Separator orientation="vertical" className="h-5" />
      <span className="truncate text-sm font-medium">{session?.name}</span>
      {tableCount > 0 && (
        <Badge variant="secondary" className="font-mono text-[10px]">
          {tableCount} table{tableCount === 1 ? "" : "s"}
        </Badge>
      )}
      <div className="flex-1" />
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground"
        onClick={onOpenTechnical}
        disabled={!technicalAvailable}
      >
        <SlidersHorizontal size={14} />
        Technical details
      </Button>
    </header>
  );
}
