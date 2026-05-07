export interface MessageInputProps {
  onSendText: (text: string) => void;
  onToggleMic: () => void;
  isRecording: boolean;
  disabled?: boolean;
}
