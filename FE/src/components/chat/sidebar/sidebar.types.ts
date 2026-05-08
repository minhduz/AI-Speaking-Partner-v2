export interface SidebarProps {
  onNewChat: () => void;
  onLogout: () => void;
  currentSessionId: string | null;
  refreshKey?: number;
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
