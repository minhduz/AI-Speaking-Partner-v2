export interface SidebarProps {
  onNewChat: () => void;
  onLogout: () => void;
  onSessionClick?: (session: import('@/types/session.types').SessionSummary) => void;
  currentSessionId: string | null;
  refreshKey?: number;
  titleUpdate?: { sessionId: string; title: string } | null;
}

export interface HistoryItem {
  id: string;
  title: string;
  createdAt: string;
}

export interface GroupedHistory {
  label: string;
  items: HistoryItem[];
}
