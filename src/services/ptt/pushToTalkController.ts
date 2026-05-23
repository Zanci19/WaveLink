import { FirebaseSignalingService } from '../firebase/firebaseSignalingService';
import { WebRtcVoiceService } from '../webrtc/webrtcVoiceService';

type TalkingStateChange = (isTalking: boolean) => void;

export class PushToTalkController {
  private onStateChange: TalkingStateChange | null = null;

  constructor(
    private readonly signaling: FirebaseSignalingService,
    private readonly webrtc: WebRtcVoiceService,
    private readonly roomCode: string,
    private readonly userId: string,
    private readonly getCurrentTalker: () => string | null
  ) {}

  setStateListener(listener: TalkingStateChange) {
    this.onStateChange = listener;
  }

  async start(): Promise<boolean> {
    const track = this.webrtc.getLocalAudioTrack();
    if (!track) {
      return false;
    }

    const currentTalker = this.getCurrentTalker();
    if (currentTalker && currentTalker !== this.userId) {
      return false;
    }

    await this.signaling.setCurrentlyTalking(this.roomCode, this.userId);
    this.webrtc.setLocalAudioEnabled(true);
    this.onStateChange?.(true);
    return true;
  }

  async stop() {
    this.webrtc.setLocalAudioEnabled(false);
    try {
      await this.signaling.clearCurrentlyTalkingIfOwner(this.roomCode, this.userId);
    } finally {
      this.onStateChange?.(false);
    }
  }

  async forceStop() {
    this.webrtc.setLocalAudioEnabled(false);
    this.onStateChange?.(false);
  }
}
