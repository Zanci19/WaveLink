export interface RemoteAudioStream {
  userId: string;
  stream: MediaStream;
}

type RemoteStreamsListener = (streams: RemoteAudioStream[]) => void;
type ConnectionStateListener = (userId: string, state: RTCPeerConnectionState) => void;
type IceCandidateListener = (userId: string, candidate: RTCPeerConnectionIceEvent) => void;

interface RadioAudioGraph {
  context: AudioContext;
  sourceStream: MediaStream;
  outputStream: MediaStream;
  inputGain: GainNode;
  cleanGain: GainNode;
  fxGain: GainNode;
}

const createDistortionCurve = (amount: number) => {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2) / samples - 1;
    curve[index] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
};

export class WebRtcVoiceService {
  private peerConnections = new Map<string, RTCPeerConnection>();
  private remoteStreams = new Map<string, MediaStream>();
  private onRemoteStreamsChange: RemoteStreamsListener | null = null;
  private onConnectionStateChange: ConnectionStateListener | null = null;
  private onIceCandidate: IceCandidateListener | null = null;
  private audioGraph: RadioAudioGraph | null = null;
  private walkieFxEnabled = false;
  private localTalking = false;

  async prepareLocalStream() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('MIC_NOT_SUPPORTED');
    }

    const sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AUDIO_CONTEXT_NOT_SUPPORTED');
    }
    const context = new AudioContextClass();
    const source = context.createMediaStreamSource(sourceStream);
    const inputGain = context.createGain();
    const cleanGain = context.createGain();
    const fxGain = context.createGain();
    const highPass = context.createBiquadFilter();
    const lowPass = context.createBiquadFilter();
    const compressor = context.createDynamicsCompressor();
    const distortion = context.createWaveShaper();
    const destination = context.createMediaStreamDestination();

    inputGain.gain.value = 0;
    cleanGain.gain.value = 1;
    fxGain.gain.value = 0;
    highPass.type = 'highpass';
    highPass.frequency.value = 450;
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 3100;
    distortion.curve = createDistortionCurve(18);
    distortion.oversample = '2x';
    compressor.threshold.value = -32;
    compressor.knee.value = 18;
    compressor.ratio.value = 9;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.18;

    source.connect(inputGain);
    inputGain.connect(cleanGain);
    cleanGain.connect(destination);
    inputGain.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(distortion);
    distortion.connect(compressor);
    compressor.connect(fxGain);
    fxGain.connect(destination);

    this.audioGraph = {
      context,
      sourceStream,
      outputStream: destination.stream,
      inputGain,
      cleanGain,
      fxGain,
    };
    this.setWalkieFxEnabled(this.walkieFxEnabled);
    return destination.stream;
  }

  async resumeAudioContext() {
    if (this.audioGraph?.context.state === 'suspended') {
      await this.audioGraph.context.resume();
    }
  }

  createPeerConnection(userId: string) {
    const existingConnection = this.peerConnections.get(userId);
    if (existingConnection && existingConnection.signalingState !== 'closed') {
      return existingConnection;
    }
    if (!this.audioGraph) {
      throw new Error('NO_LOCAL_STREAM');
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });

    this.audioGraph.outputStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.audioGraph?.outputStream as MediaStream);
    });

    peerConnection.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) {
        this.remoteStreams.set(userId, stream);
        this.emitRemoteStreams();
      }
    };

    peerConnection.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(userId, peerConnection.connectionState);
      if (peerConnection.connectionState === 'closed' || peerConnection.connectionState === 'failed') {
        this.remoteStreams.delete(userId);
        this.emitRemoteStreams();
      }
    };

    peerConnection.onicecandidate = (event) => {
      this.onIceCandidate?.(userId, event);
    };

    this.peerConnections.set(userId, peerConnection);
    return peerConnection;
  }

  getPeerConnection(userId: string) {
    return this.peerConnections.get(userId) ?? null;
  }

  getRemoteUserIds() {
    return [...this.peerConnections.keys()];
  }

  closePeerConnection(userId: string) {
    const peerConnection = this.peerConnections.get(userId);
    if (peerConnection) {
      peerConnection.onconnectionstatechange = null;
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.close();
      this.peerConnections.delete(userId);
    }
    this.remoteStreams.delete(userId);
    this.emitRemoteStreams();
  }

  closePeerConnectionsExcept(activeUserIds: Set<string>) {
    this.getRemoteUserIds().forEach((userId) => {
      if (!activeUserIds.has(userId)) {
        this.closePeerConnection(userId);
      }
    });
  }

  setRemoteStreamsListener(listener: RemoteStreamsListener) {
    this.onRemoteStreamsChange = listener;
  }

  setConnectionStateListener(listener: ConnectionStateListener) {
    this.onConnectionStateChange = listener;
  }

  setIceCandidateListener(listener: IceCandidateListener) {
    this.onIceCandidate = listener;
  }

  getLocalAudioTrack() {
    return this.audioGraph?.outputStream.getAudioTracks()[0] ?? null;
  }

  setLocalAudioEnabled(enabled: boolean) {
    this.localTalking = enabled;
    if (this.audioGraph) {
      this.audioGraph.inputGain.gain.setTargetAtTime(
        enabled ? 1 : 0,
        this.audioGraph.context.currentTime,
        0.015
      );
    }
  }

  setWalkieFxEnabled(enabled: boolean) {
    this.walkieFxEnabled = enabled;
    if (!this.audioGraph) {
      return;
    }
    const now = this.audioGraph.context.currentTime;
    this.audioGraph.cleanGain.gain.setTargetAtTime(enabled ? 0 : 1, now, 0.02);
    this.audioGraph.fxGain.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.02);
  }

  async playStartChirp() {
    await this.playToneSequence([
      { frequency: 950, duration: 0.045 },
      { frequency: 1320, duration: 0.055 },
    ]);
  }

  async playStopChirp() {
    await this.playToneSequence([
      { frequency: 1180, duration: 0.04 },
      { frequency: 660, duration: 0.07 },
    ]);
  }

  private async playToneSequence(tones: Array<{ frequency: number; duration: number }>) {
    const AudioContextClass =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('AUDIO_CONTEXT_NOT_SUPPORTED');
    }
    const context = this.audioGraph?.context ?? new AudioContextClass();
    if (context.state === 'suspended') {
      await context.resume();
    }

    let offset = 0;
    tones.forEach((tone) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'square';
      oscillator.frequency.value = tone.frequency;
      gain.gain.setValueAtTime(0.0001, context.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, context.currentTime + offset + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + offset + tone.duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime + offset);
      oscillator.stop(context.currentTime + offset + tone.duration);
      offset += tone.duration + 0.018;
    });
  }

  private emitRemoteStreams() {
    this.onRemoteStreamsChange?.(
      [...this.remoteStreams.entries()].map(([userId, stream]) => ({ userId, stream }))
    );
  }

  close() {
    this.peerConnections.forEach((peerConnection) => {
      peerConnection.onconnectionstatechange = null;
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.close();
    });
    this.peerConnections.clear();
    this.remoteStreams.clear();
    this.emitRemoteStreams();

    if (this.audioGraph) {
      this.audioGraph.sourceStream.getTracks().forEach((track) => track.stop());
      this.audioGraph.outputStream.getTracks().forEach((track) => track.stop());
      this.audioGraph.context.close().catch(() => {
        // The browser can reject close() if the context is already closing.
      });
      this.audioGraph = null;
    }
  }
}
