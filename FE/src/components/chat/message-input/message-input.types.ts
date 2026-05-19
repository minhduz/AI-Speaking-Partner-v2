export interface MessageInputProps {
  onSendText: (text: string) => void;
  onStartMic: () => void;
  onStopMic: () => void;
  isRecording: boolean;
  disabled?: boolean;
  disabledReason?: string;
  hideMic?: boolean;
}
