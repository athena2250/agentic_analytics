import { useState } from "react";
import { Upload, Plus, Database, FileText } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar.jsx";
import { cn } from "@/lib/utils.js";
import DatasetSummaryCard from "../DatasetSummaryCard.jsx";
import SchemaExplorer from "../SchemaExplorer.jsx";
import RelationshipList from "../RelationshipList.jsx";
import UploadProgress from "../UploadProgress.jsx";
import UploadDropzone, { useFilePicker, useDropTarget } from "../UploadDropzone.jsx";
import SessionList from "../SessionList.jsx";

function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * AppSidebar (plan §7/§8): shadcn Sidebar chrome (collapsible icon rail,
 * consistent section rhythm) around the same dataset-files / schema /
 * relationships / sessions content the previous Sidebar.jsx rendered.
 *
 * The section internals (DatasetSummaryCard, SchemaExplorer, RelationshipList,
 * SessionList) are restyled in a later pass — this phase rebuilds the shell.
 */
export default function AppSidebar({
  sessions, activeId, activeSession,
  onSelect, onNew, onRename, onUpload, uploading,
  uploadStage, uploadError, formats,
}) {
  const uploadedFiles = activeSession?.uploadedFiles ?? [];
  const canUpload = Boolean(activeSession);
  const { open: openPicker, input: fileInput } = useFilePicker(onUpload, formats, canUpload);
  const { dragging, handlers: dropHandlers } = useDropTarget(onUpload, canUpload);

  return (
    <Sidebar collapsible="icon" className={cn(dragging && "bg-accent/40")} {...dropHandlers}>
      <SidebarHeader className="border-b px-3 py-3">
        <div className="flex items-center gap-2 px-1">
          <Database size={16} className="shrink-0 text-primary" />
          <span className="truncate text-sm font-semibold group-data-[collapsible=icon]:hidden">
            Agentic Analytics
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent className="group-data-[collapsible=icon]:hidden">
        {/* ── Dataset files ── */}
        <SidebarGroup>
          <SidebarGroupLabel>Dataset files</SidebarGroupLabel>
          <SidebarGroupAction title="Add files to this dataset" onClick={openPicker}>
            <Upload size={12} />
          </SidebarGroupAction>
          <SidebarGroupContent className="flex flex-col gap-1 px-2">
            {uploadedFiles.length === 0 && !uploadStage && (
              <UploadDropzone
                variant="compact"
                onUpload={onUpload}
                formats={formats}
                disabled={!canUpload}
              />
            )}

            <UploadProgress stage={uploadStage} error={uploadError} compact />

            {uploadedFiles.map((f) => (
              <div key={f.name} className="flex items-center gap-1.5 rounded-md px-1.5 py-1">
                <FileText size={13} className="shrink-0 text-muted-foreground" />
                <span className="flex-1 truncate text-xs">{f.name}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{formatSize(f.size)}</span>
              </div>
            ))}

            {uploadedFiles.length > 0 && (
              <>
                <button
                  className="mt-0.5 flex w-full items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-50"
                  onClick={openPicker}
                  disabled={uploading}
                >
                  <Upload size={11} />
                  Add to this dataset
                </button>
                <button
                  className="pt-0.5 text-center text-[10.5px] text-muted-foreground underline underline-offset-2"
                  onClick={onNew}
                >
                  Different data? Start a new session
                </button>
              </>
            )}
          </SidebarGroupContent>
        </SidebarGroup>

        {activeSession?.profile && (
          <SidebarGroup>
            <DatasetSummaryCard profile={activeSession.profile} name={activeSession.name} />
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SchemaExplorer profile={activeSession?.profile} />
        </SidebarGroup>

        <SidebarGroup>
          <RelationshipList
            relationships={activeSession?.relationships}
            tableCount={Object.keys(activeSession?.tables ?? {}).length}
          />
        </SidebarGroup>

        {activeSession && !activeSession.profile && Object.keys(activeSession.tables).length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel>Tables</SidebarGroupLabel>
            <SidebarGroupContent className="flex flex-col gap-1 px-2">
              {Object.entries(activeSession.tables).map(([tname, cols]) => (
                <div key={tname} className="flex items-center gap-1.5 px-1.5 py-1">
                  <Database size={12} className="shrink-0 text-primary" />
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate font-mono text-xs">{tname}</span>
                    <span className="text-[10px] text-muted-foreground">{cols.length} cols</span>
                  </div>
                </div>
              ))}
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Sessions ── */}
        <SidebarGroup className="flex-1 overflow-hidden">
          <SidebarGroupLabel>Sessions</SidebarGroupLabel>
          <SidebarGroupAction title="New session — a clean slate for a different dataset" onClick={onNew}>
            <Plus size={12} />
          </SidebarGroupAction>
          <SidebarGroupContent className="overflow-y-auto">
            <SessionList
              sessions={sessions}
              activeId={activeId}
              onSelect={onSelect}
              onRename={onRename}
            />
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {fileInput}

      <SidebarFooter className="border-t py-2 text-center text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        Powered by Ollama · DuckDB
      </SidebarFooter>
    </Sidebar>
  );
}
