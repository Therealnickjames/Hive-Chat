"use client";

import { Workspace } from "@/components/workspace/workspace";

export default function ServerPage() {
  // Keep workspace stable when switching servers; do not auto-open channels.
  return <Workspace />;
}
