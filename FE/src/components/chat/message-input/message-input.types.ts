export interface MessageInputProps {
  onSendText: (text: string) => void;
  onStartMic: () => void;
  onStopMic: () => void;
  isRecording: boolean;
  disabled?: boolean;
  hideMic?: boolean;
}
