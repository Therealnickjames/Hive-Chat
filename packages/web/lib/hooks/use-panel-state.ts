import { useState, useEffect, useCallback } from "react";

export interface PanelState {
  id: string; // unique ID, currently mapped to channelId
  channelId: string;
  channelName: string;
  serverId: string;
  serverName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isMinimized: boolean;
  isClosed: boolean;
  isMaximized: boolean;
  restoreX: number | null;
  restoreY: number | null;
  restoreWidth: number | null;
  restoreHeight: number | null;
  zIndex: number;
}

const LAYOUT_LEFT_PANEL_WIDTH = 200;
const LAYOUT_RIGHT_PANEL_WIDTH = 240;
const LAYOUT_TOP_BAR_HEIGHT = 38;
const LAYOUT_BOTTOM_BAR_HEIGHT = 44;
const MIN_PANEL_WIDTH = 300;
const MIN_PANEL_HEIGHT = 200;

function getWorkspaceDimensions() {
  if (typeof window === "undefined") {
    return { width: 1200, height: 800 };
  }
  return {
    width: Math.max(
      MIN_PANEL_WIDTH,
      window.innerWidth - LAYOUT_LEFT_PANEL_WIDTH - LAYOUT_RIGHT_PANEL_WIDTH,
    ),
    height: Math.max(
      MIN_PANEL_HEIGHT,
      window.innerHeight - LAYOUT_TOP_BAR_HEIGHT - LAYOUT_BOTTOM_BAR_HEIGHT,
    ),
  };
}

function normalizePanelGeometry(panel: PanelState): PanelState {
  const workspace = getWorkspaceDimensions();
  const width = Math.max(
    MIN_PANEL_WIDTH,
    Math.min(panel.width, workspace.width),
  );
  const height = Math.max(
    MIN_PANEL_HEIGHT,
    Math.min(panel.height, workspace.height),
  );
  const x = Math.max(0, Math.min(panel.x, workspace.width - width));
  const y = Math.max(0, Math.min(panel.y, workspace.height - height));

  return {
    ...panel,
    width,
    height,
    x,
    y,
  };
}

export function usePanelState() {
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeStreams, setActiveStreams] = useState<Set<string>>(new Set());

  // Keep stream status aligned to currently active panel channels.
  useEffect(() => {
    const activeChannelIds = new Set(
      panels.filter((p) => !p.isClosed).map((p) => p.channelId),
    );
    setActiveStreams((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((channelId) => {
        if (activeChannelIds.has(channelId)) {
          next.add(channelId);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [panels]);

  const setStreamState = useCallback((channelId: string, isActive: boolean) => {
    setActiveStreams((prev) => {
      const next = new Set(prev);
      if (isActive) next.add(channelId);
      else next.delete(channelId);
      return next;
    });
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tavok-panels");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const deduped = new Map<string, PanelState>();
          for (const raw of parsed) {
            if (!raw || typeof raw !== "object") continue;
            if (!raw.channelId || !raw.serverId) continue;
            const normalized: PanelState = {
              id: String(raw.id || raw.channelId),
              channelId: String(raw.channelId),
              channelName: String(raw.channelName || "unknown"),
              serverId: String(raw.serverId),
              serverName: String(raw.serverName || "unknown"),
              x: Number(raw.x ?? 120),
              y: Number(raw.y ?? 120),
              width: Number(raw.width ?? 420),
              height: Number(raw.height ?? 520),
              isMinimized: Boolean(raw.isMinimized),
              isClosed: Boolean(raw.isClosed),
              isMaximized: Boolean(raw.isMaximized),
              restoreX: raw.restoreX ?? null,
              restoreY: raw.restoreY ?? null,
              restoreWidth: raw.restoreWidth ?? null,
              restoreHeight: raw.restoreHeight ?? null,
              zIndex: Number(raw.zIndex ?? 1),
            };
            // Keep latest value by channel id (one panel per channel).
            deduped.set(
              normalized.channelId,
              normalizePanelGeometry(normalized),
            );
          }
          setPanels(Array.from(deduped.values()));
        }
      }
    } catch (e) {
      console.error("Failed to parse saved panels", e);
    }
    setIsLoaded(true);
  }, []);

  // Save to localStorage when panels change
  useEffect(() => {
    if (isLoaded) {
      localStorage.setItem("tavok-panels", JSON.stringify(panels));
    }
  }, [panels, isLoaded]);

  useEffect(() => {
    const handleResize = () => {
      setPanels((prev) => prev.map((panel) => normalizePanelGeometry(panel)));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const openPanel = useCallback(
    (
      panelData: Omit<
        PanelState,
        | "id"
        | "x"
        | "y"
        | "width"
        | "height"
        | "isMinimized"
        | "isClosed"
        | "isMaximized"
        | "restoreX"
        | "restoreY"
        | "restoreWidth"
        | "restoreHeight"
        | "zIndex"
      >,
    ) => {
      setPanels((prev) => {
        // If already open, focus it
        const existing = prev.find((p) => p.channelId === panelData.channelId);
        if (existing) {
          const maxZ = Math.max(...prev.map((p) => p.zIndex), 0);
          return prev.map((p) =>
            p.channelId === panelData.channelId
              ? normalizePanelGeometry({
                  ...p,
                  channelName: panelData.channelName,
                  serverId: panelData.serverId,
                  serverName: panelData.serverName,
                  isClosed: false,
                  isMinimized: false,
                  zIndex: maxZ + 1,
                })
              : p,
          );
        }

        // Smart default position (cascade)
        const openCount = prev.filter((p) => !p.isClosed).length;
        const column = openCount % 4;
        const row = Math.floor(openCount / 4) % 4;
        const newPanel: PanelState = {
          id: panelData.channelId,
          ...panelData,
          x: 48 + column * 32,
          y: 48 + row * 28,
          width: 400,
          height: 500,
          isMinimized: false,
          isClosed: false,
          isMaximized: false,
          restoreX: null,
          restoreY: null,
          restoreWidth: null,
          restoreHeight: null,
          zIndex: Math.max(...prev.map((p) => p.zIndex), 0) + 1,
        };
        return [...prev, normalizePanelGeometry(newPanel)];
      });
    },
    [],
  );

  const closePanel = useCallback((id: string) => {
    setPanels((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              isClosed: true,
              isMinimized: false,
              isMaximized: false,
            }
          : p,
      ),
    );
  }, []);

  const minimizePanel = useCallback((id: string) => {
    setPanels((prev) =>
      prev.map((p) => (p.id === id ? { ...p, isMinimized: true } : p)),
    );
  }, []);

  const restorePanel = useCallback((id: string) => {
    setPanels((prev) => {
      const maxZ = Math.max(...prev.map((p) => p.zIndex), 0);
      return prev.map((p) =>
        p.id === id
          ? { ...p, isClosed: false, isMinimized: false, zIndex: maxZ + 1 }
          : p,
      );
    });
  }, []);

  const focusPanel = useCallback((id: string) => {
    setPanels((prev) => {
      const maxZ = Math.max(...prev.map((p) => p.zIndex), 0);
      const target = prev.find((p) => p.id === id);
      if (target && target.zIndex === maxZ) return prev; // Already focused
      return prev.map((p) => (p.id === id ? { ...p, zIndex: maxZ + 1 } : p));
    });
  }, []);

  const updatePanelPosition = useCallback(
    (id: string, x: number, y: number) => {
      setPanels((prev) =>
        prev.map((p) =>
          p.id === id ? normalizePanelGeometry({ ...p, x, y }) : p,
        ),
      );
    },
    [],
  );

  const updatePanelSize = useCallback(
    (id: string, width: number, height: number) => {
      setPanels((prev) =>
        prev.map((p) =>
          p.id === id ? normalizePanelGeometry({ ...p, width, height }) : p,
        ),
      );
    },
    [],
  );

  const toggleMaximizePanel = useCallback(
    (id: string, workspaceWidth: number, workspaceHeight: number) => {
      setPanels((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          if (p.isMaximized) {
            return normalizePanelGeometry({
              ...p,
              isMaximized: false,
              x: p.restoreX ?? p.x,
              y: p.restoreY ?? p.y,
              width: p.restoreWidth ?? p.width,
              height: p.restoreHeight ?? p.height,
              restoreX: null,
              restoreY: null,
              restoreWidth: null,
              restoreHeight: null,
            });
          }
          return {
            ...p,
            isMaximized: true,
            restoreX: p.x,
            restoreY: p.y,
            restoreWidth: p.width,
            restoreHeight: p.height,
            x: 0,
            y: 0,
            width: Math.max(300, workspaceWidth),
            height: Math.max(200, workspaceHeight),
          };
        }),
      );
    },
    [],
  );

  const removePanelsForServer = useCallback((serverId: string) => {
    setPanels((prev) => prev.filter((p) => p.serverId !== serverId));
  }, []);

  return {
    panels,
    openPanel,
    closePanel,
    minimizePanel,
    restorePanel,
    focusPanel,
    updatePanelPosition,
    updatePanelSize,
    toggleMaximizePanel,
    removePanelsForServer,
    isLoaded,
    activeStreams,
    setStreamState,
  };
}
