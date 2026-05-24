import { ConnectionStatus } from '../models/ConnectionStatus';
import { isFirebaseConfigured } from './firebase/firebase';
import {
  FirebaseSignalingService,
  JoinRequest,
  JoinRequestStatus,
  RoomMember,
  RoomSnapshot,
} from './firebase/firebaseSignalingService';
import { RemoteAudioStream } from './webrtc/webrtcVoiceService';
import { isPeerOfferer } from './firebase/roomSignalingHelpers';
import { PushToTalkController } from './ptt/pushToTalkController';
import { WebRtcVoiceService } from './webrtc/webrtcVoiceService';

export type RoomServiceErrorType =
  | 'firebase-missing'
  | 'no-internet'
  | 'room-not-found'
  | 'room-full'
  | 'join-denied'
  | 'mic-permission'
  | 'webrtc-failed';

export interface RoomServiceError {
  type: RoomServiceErrorType;
  message?: string;
}

const roomServiceErrorTypes = new Set<RoomServiceErrorType>([
  'firebase-missing',
  'no-internet',
  'room-not-found',
  'room-full',
  'join-denied',
  'mic-permission',
  'webrtc-failed',
]);

const isRoomServiceError = (error: unknown): error is RoomServiceError => {
  if (!error || typeof error !== 'object' || !('type' in error)) {
    return false;
  }
  return roomServiceErrorTypes.has((error as RoomServiceError).type);
};

export type RoomEntryStatus = 'joined' | 'waiting';

export interface RoomServiceCallbacks {
  onConnectionStatusChange?: (status: ConnectionStatus) => void;
  onTalkingUserChange?: (userId: string | null) => void;
  onLocalTalkingChange?: (isTalking: boolean) => void;
  onRemoteStreams?: (streams: RemoteAudioStream[]) => void;
  onRoomSnapshot?: (snapshot: RoomSnapshot) => void;
  onJoinRequestsChange?: (requests: JoinRequest[]) => void;
  onWaitingStatusChange?: (status: JoinRequestStatus | null) => void;
  onError?: (error: RoomServiceError) => void;
}

interface PeerSetupState {
  offerWritten: boolean;
  offerApplied: boolean;
  answerApplied: boolean;
}

const generateUserId = () => {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `user-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export class RoomService {
  private signaling = new FirebaseSignalingService();
  private webrtc = new WebRtcVoiceService();
  private pttController: PushToTalkController | null = null;
  private roomCode = '';
  private userId = '';
  private displayName = '';
  private currentTalker: string | null = null;
  private roomSnapshot: RoomSnapshot | null = null;
  private connectionStates = new Map<string, RTCPeerConnectionState>();
  private peerSetupStates = new Map<string, PeerSetupState>();
  private presenceInterval: number | null = null;
  private joinRequestInterval: number | null = null;
  private unsubscribers: Array<() => void> = [];
  private isClosed = false;
  private hasConnected = false;
  private leavePromise: Promise<void> | null = null;
  private waitingForApproval = false;

  constructor(private callbacks: RoomServiceCallbacks = {}) {}

  getUserId() {
    return this.userId;
  }

  getCurrentTalker() {
    return this.currentTalker;
  }

  async createRoom(code: string, displayName: string) {
    return this.startSession(code, 'create', displayName);
  }

  async joinRoom(code: string, displayName: string) {
    return this.startSession(code, 'join', displayName);
  }

  async startPushToTalk() {
    if (this.isClosed || this.waitingForApproval || !this.pttController) {
      return false;
    }
    try {
      await this.webrtc.resumeAudioContext();
      return await this.pttController.start();
    } catch (error) {
      this.callbacks.onError?.({
        type: 'webrtc-failed',
        message: error instanceof Error ? error.message : 'Push-to-talk failed',
      });
      return false;
    }
  }

  async resumeVoiceSession() {
    if (this.isClosed) {
      return;
    }
    await this.webrtc.resumeAudioContext();
  }

  async stopPushToTalk() {
    if (this.isClosed || !this.pttController) {
      return;
    }
    try {
      await this.pttController.stop();
    } catch (error) {
      this.callbacks.onError?.({
        type: 'webrtc-failed',
        message: error instanceof Error ? error.message : 'Push-to-talk stop failed',
      });
    }
  }

  async setMaxUsers(maxUsers: number) {
    if (this.roomCode) {
      await this.signaling.setRoomMaxUsers(this.roomCode, maxUsers);
    }
  }

  async setRequireApproval(requireApproval: boolean) {
    if (this.roomCode) {
      await this.signaling.setRoomRequireApproval(this.roomCode, requireApproval);
    }
  }

  async setWalkieFxEnabled(enabled: boolean) {
    if (this.roomCode) {
      await this.signaling.setRoomWalkieFxEnabled(this.roomCode, enabled);
    }
  }

  async approveJoinRequest(requestId: string) {
    if (this.roomCode) {
      await this.signaling.approveJoinRequest(this.roomCode, requestId);
    }
  }

  async denyJoinRequest(requestId: string) {
    if (this.roomCode) {
      await this.signaling.denyJoinRequest(this.roomCode, requestId);
    }
  }

  async leaveRoom() {
    if (this.leavePromise) {
      return this.leavePromise;
    }
    this.leavePromise = this.leaveRoomInternal().finally(() => {
      this.leavePromise = null;
    });
    return this.leavePromise;
  }

  private async leaveRoomInternal() {
    this.isClosed = true;
    const roomCode = this.roomCode;
    const userId = this.userId;
    const wasWaiting = this.waitingForApproval;

    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.unsubscribers = [];
    this.stopPresenceHeartbeat();
    this.stopJoinRequestHeartbeat();

    if (this.pttController) {
      await this.pttController.forceStop();
    }
    this.webrtc.close();

    if (roomCode && userId) {
      try {
        if (wasWaiting) {
          await this.signaling.clearJoinRequest(roomCode);
        } else {
          await this.signaling.removeUser(roomCode, userId);
          await this.signaling.cleanupRoomIfEmpty(roomCode);
        }
      } catch {
        // Leaving should not trap the user in the room UI.
      }
    }

    this.pttController = null;
    this.roomSnapshot = null;
    this.connectionStates.clear();
    this.peerSetupStates.clear();
    this.callbacks.onRemoteStreams?.([]);
    this.callbacks.onJoinRequestsChange?.([]);
    this.callbacks.onConnectionStatusChange?.('disconnected');
  }

  private async startSession(code: string, mode: 'create' | 'join', displayName: string) {
    if (!isFirebaseConfigured() || !this.signaling.isAvailable()) {
      throw { type: 'firebase-missing' } as RoomServiceError;
    }
    if (!navigator.onLine) {
      throw { type: 'no-internet' } as RoomServiceError;
    }

    this.roomCode = code;
    this.userId = generateUserId();
    this.displayName = displayName;
    this.currentTalker = null;
    this.waitingForApproval = false;
    this.isClosed = false;
    this.hasConnected = false;
    this.connectionStates.clear();
    this.peerSetupStates.clear();

    try {
      const result =
        mode === 'create'
          ? await this.signaling.createRoom(code, this.userId, displayName)
          : await this.signaling.joinRoom(code, this.userId, displayName);

      if (result.status === 'waiting') {
        this.waitingForApproval = true;
        this.callbacks.onWaitingStatusChange?.('pending');
        this.startJoinRequestHeartbeat();
        this.subscribeWaitingRequest();
        this.subscribeRoomState();
        return { userId: this.userId, status: 'waiting' as const };
      }

      await this.startActiveRoom();
      return { userId: this.userId, status: 'joined' as const };
    } catch (error) {
      if (isRoomServiceError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : '';
      if (message === 'ROOM_NOT_FOUND') {
        throw { type: 'room-not-found' } as RoomServiceError;
      }
      if (message === 'ROOM_FULL') {
        throw { type: 'room-full' } as RoomServiceError;
      }
      if (message === 'JOIN_DENIED') {
        throw { type: 'join-denied' } as RoomServiceError;
      }
      throw { type: 'webrtc-failed', message: message || 'Room join failed' } as RoomServiceError;
    }
  }

  private subscribeWaitingRequest() {
    this.unsubscribers.push(
      this.signaling.onJoinRequest(this.roomCode, async (request) => {
        if (this.isClosed || !this.waitingForApproval) {
          return;
        }
        this.callbacks.onWaitingStatusChange?.(request?.status ?? null);
        if (!request) {
          return;
        }
        if (request.status === 'denied') {
          this.callbacks.onError?.({ type: 'join-denied' });
          return;
        }
        if (request.status === 'approved') {
          try {
            await this.signaling.activateApprovedJoin(this.roomCode, this.userId, this.displayName);
            if (this.isClosed) {
              return;
            }
            this.waitingForApproval = false;
            this.stopJoinRequestHeartbeat();
            this.callbacks.onWaitingStatusChange?.('approved');
            await this.startActiveRoom();
          } catch (error) {
            if (isRoomServiceError(error)) {
              this.callbacks.onError?.(error);
              return;
            }
            const message = error instanceof Error ? error.message : '';
            this.callbacks.onError?.({
              type: message === 'ROOM_FULL' ? 'room-full' : 'webrtc-failed',
              message: message || 'Unable to enter room',
            });
          }
        }
      })
    );
  }

  private async startActiveRoom() {
    this.waitingForApproval = false;
    this.callbacks.onWaitingStatusChange?.(null);

    try {
      await this.webrtc.prepareLocalStream();
    } catch (error) {
      throw {
        type: 'mic-permission',
        message: error instanceof Error ? error.name : 'Microphone permission denied',
      } as RoomServiceError;
    }

    if (this.isClosed) {
      this.webrtc.close();
      return;
    }

    this.webrtc.setRemoteStreamsListener((streams) => {
      if (!this.isClosed) {
        this.callbacks.onRemoteStreams?.(streams);
      }
    });
    this.webrtc.setConnectionStateListener((userId, state) => {
      if (this.isClosed) {
        return;
      }
      this.connectionStates.set(userId, state);
      if (state === 'connected') {
        this.hasConnected = true;
      }
      this.updateConnectionStatus();
    });
    this.webrtc.setIceCandidateListener((remoteUserId, event) => {
      if (this.isClosed || !event.candidate) {
        return;
      }
      this.signaling
        .addIceCandidate(this.roomCode, this.userId, remoteUserId, event.candidate)
        .catch((error) => this.reportError(error, 'ICE candidate failed'));
    });

    this.pttController = new PushToTalkController(
      this.signaling,
      this.webrtc,
      this.roomCode,
      this.userId,
      () => this.currentTalker
    );
    this.pttController.setStateListener((isTalking) => {
      if (!this.isClosed) {
        this.callbacks.onLocalTalkingChange?.(isTalking);
      }
    });

    this.subscribeRoomState();
    this.subscribeHostJoinRequests();
    this.startPresenceHeartbeat();
    this.updateConnectionStatus();
  }

  private subscribeRoomState() {
    if (this.unsubscribers.some((unsubscribe) => unsubscribe.name === 'roomStateUnsubscribe')) {
      return;
    }
    const unsubscribe = this.signaling.onRoomSnapshot(this.roomCode, (snapshot) => {
      if (this.isClosed) {
        return;
      }
      this.handleRoomSnapshot(snapshot);
    });
    Object.defineProperty(unsubscribe, 'name', { value: 'roomStateUnsubscribe' });
    this.unsubscribers.push(unsubscribe);
  }

  private subscribeHostJoinRequests() {
    const unsubscribe = this.signaling.onJoinRequests(this.roomCode, (requests) => {
      if (this.isClosed || !this.isLocalHost()) {
        this.callbacks.onJoinRequestsChange?.([]);
        return;
      }
      this.callbacks.onJoinRequestsChange?.(requests);
    });
    this.unsubscribers.push(unsubscribe);
  }

  private handleRoomSnapshot(snapshot: RoomSnapshot) {
    const previousTalker = this.currentTalker;
    this.roomSnapshot = snapshot;
    this.currentTalker = snapshot.currentlyTalking;
    this.webrtc.setWalkieFxEnabled(snapshot.walkieFxEnabled);
    this.callbacks.onRoomSnapshot?.(snapshot);
    this.callbacks.onTalkingUserChange?.(this.currentTalker);

    if (previousTalker !== this.currentTalker) {
      if (this.currentTalker) {
        this.webrtc.playStartChirp().catch(() => undefined);
      } else if (previousTalker) {
        this.webrtc.playStopChirp().catch(() => undefined);
      }
    }

    if (this.currentTalker && this.currentTalker !== this.userId) {
      this.pttController?.forceStop();
    }

    if (!this.waitingForApproval && this.pttController) {
      this.syncPeerConnections(snapshot.members);
    }
    this.updateConnectionStatus();
  }

  private syncPeerConnections(members: RoomMember[]) {
    const remoteMembers = members.filter((member) => member.userId !== this.userId);
    const remoteUserIds = new Set(remoteMembers.map((member) => member.userId));
    this.webrtc.closePeerConnectionsExcept(remoteUserIds);
    [...this.connectionStates.keys()].forEach((userId) => {
      if (!remoteUserIds.has(userId)) {
        this.connectionStates.delete(userId);
        this.peerSetupStates.delete(userId);
      }
    });
    remoteMembers.forEach((member) => this.ensurePeerConnection(member.userId));
  }

  private ensurePeerConnection(remoteUserId: string) {
    let setupState = this.peerSetupStates.get(remoteUserId);
    if (setupState) {
      return;
    }
    setupState = { offerWritten: false, offerApplied: false, answerApplied: false };
    this.peerSetupStates.set(remoteUserId, setupState);
    const peerConnection = this.webrtc.createPeerConnection(remoteUserId);

    this.unsubscribers.push(
      this.signaling.onConnectionSnapshot(
        this.roomCode,
        this.userId,
        remoteUserId,
        async (connectionSnapshot) => {
          if (this.isClosed || !connectionSnapshot) {
            return;
          }
          try {
            if (
              connectionSnapshot.offer &&
              connectionSnapshot.offer.from !== this.userId &&
              !setupState.offerApplied &&
              !peerConnection.currentRemoteDescription
            ) {
              setupState.offerApplied = true;
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(connectionSnapshot.offer)
              );
              const answer = await peerConnection.createAnswer();
              await peerConnection.setLocalDescription(answer);
              await this.signaling.writeConnectionAnswer(
                this.roomCode,
                this.userId,
                remoteUserId,
                answer
              );
            }

            if (
              connectionSnapshot.answer &&
              connectionSnapshot.answer.from !== this.userId &&
              !setupState.answerApplied &&
              peerConnection.localDescription &&
              !peerConnection.currentRemoteDescription
            ) {
              setupState.answerApplied = true;
              await peerConnection.setRemoteDescription(
                new RTCSessionDescription(connectionSnapshot.answer)
              );
            }
          } catch (error) {
            this.reportError(error, 'Peer signaling failed');
          }
        }
      )
    );

    this.unsubscribers.push(
      this.signaling.onIceCandidates(this.roomCode, this.userId, remoteUserId, (candidate) => {
        if (this.isClosed || this.isPeerConnectionClosed(peerConnection)) {
          return;
        }
        peerConnection
          .addIceCandidate(new RTCIceCandidate(candidate.candidate))
          .catch((error) => this.reportError(error, 'Remote ICE failed'));
      })
    );

    if (isPeerOfferer(this.userId, remoteUserId)) {
      this.createOffer(remoteUserId, peerConnection, setupState).catch((error) =>
        this.reportError(error, 'Offer creation failed')
      );
    }
  }

  private async createOffer(
    remoteUserId: string,
    peerConnection: RTCPeerConnection,
    setupState: PeerSetupState
  ) {
    if (setupState.offerWritten || this.isClosed || this.isPeerConnectionClosed(peerConnection)) {
      return;
    }
    setupState.offerWritten = true;
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await this.signaling.writeConnectionOffer(this.roomCode, this.userId, remoteUserId, offer);
  }

  private isLocalHost() {
    return !!this.roomSnapshot?.hostUserId && this.roomSnapshot.hostUserId === this.userId;
  }

  private startPresenceHeartbeat() {
    this.stopPresenceHeartbeat();
    const pushPresence = () => {
      if (this.isClosed || this.waitingForApproval) {
        return;
      }
      this.signaling
        .updateUserPresence(this.roomCode, this.userId)
        .catch((error) => this.reportError(error, 'Presence update failed'));
    };
    pushPresence();
    this.presenceInterval = window.setInterval(pushPresence, 20000);
  }

  private stopPresenceHeartbeat() {
    if (this.presenceInterval) {
      window.clearInterval(this.presenceInterval);
      this.presenceInterval = null;
    }
  }

  private startJoinRequestHeartbeat() {
    this.stopJoinRequestHeartbeat();
    const pushPresence = () => {
      if (this.isClosed || !this.waitingForApproval) {
        return;
      }
      this.signaling
        .updateJoinRequestPresence(this.roomCode)
        .catch((error) => this.reportError(error, 'Join request presence failed'));
    };
    pushPresence();
    this.joinRequestInterval = window.setInterval(pushPresence, 20000);
  }

  private stopJoinRequestHeartbeat() {
    if (this.joinRequestInterval) {
      window.clearInterval(this.joinRequestInterval);
      this.joinRequestInterval = null;
    }
  }

  private updateConnectionStatus() {
    if (this.isClosed) {
      return;
    }
    const activeCount = this.roomSnapshot?.activeUserCount ?? 0;
    const peerStates = [...this.connectionStates.values()];
    let status: ConnectionStatus = 'waiting';
    if (this.waitingForApproval || activeCount < 2) {
      status = 'waiting';
    } else if (peerStates.length > 0 && peerStates.every((state) => state === 'connected')) {
      status = 'connected';
    } else if (peerStates.some((state) => state === 'failed' || state === 'closed')) {
      status = this.hasConnected ? 'reconnecting' : 'connecting';
    } else {
      status = this.hasConnected ? 'reconnecting' : 'connecting';
    }
    this.callbacks.onConnectionStatusChange?.(status);
  }

  private isPeerConnectionClosed(peerConnection: RTCPeerConnection) {
    return peerConnection.signalingState === 'closed' || peerConnection.connectionState === 'closed';
  }

  private reportError(error: unknown, fallbackMessage: string) {
    if (this.isClosed) {
      return;
    }
    this.callbacks.onError?.({
      type: 'webrtc-failed',
      message: error instanceof Error ? error.message : fallbackMessage,
    });
  }
}
