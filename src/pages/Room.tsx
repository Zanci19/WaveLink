import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHistory, useLocation, useParams } from 'react-router-dom';
import {
  IonBadge,
  IonButton,
  IonContent,
  IonIcon,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonText,
  IonToggle,
} from '@ionic/react';
import {
  checkmarkCircleOutline,
  closeCircleOutline,
  exitOutline,
  peopleOutline,
  refreshOutline,
  removeOutline,
  addOutline,
  volumeHighOutline,
} from 'ionicons/icons';
import { ConnectionStatus } from '../models/ConnectionStatus';
import { JoinRequest, JoinRequestStatus, RoomSnapshot } from '../services/firebase/firebaseSignalingService';
import { normalizeDisplayName } from '../services/firebase/roomSignalingHelpers';
import { backgroundService } from '../services/backgroundService';
import { hardwareButtonService } from '../services/hardwareButtonService';
import { openAppSettings } from '../services/permissionsService';
import { preferencesService } from '../services/preferences/preferencesService';
import { RoomEntryStatus, RoomService, RoomServiceError } from '../services/roomService';
import { RemoteAudioStream } from '../services/webrtc/webrtcVoiceService';
import './Room.css';

type RoomParams = {
  code: string;
};

const statusLabels: Record<ConnectionStatus, string> = {
  waiting: 'Waiting',
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

const statusColors: Record<ConnectionStatus, string> = {
  waiting: 'medium',
  connecting: 'primary',
  connected: 'success',
  reconnecting: 'warning',
  disconnected: 'danger',
};

const RemoteAudio: React.FC<{ stream: MediaStream }> = ({ stream }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }
    audioRef.current.srcObject = stream;
    audioRef.current.play().catch(() => {
      // Autoplay can be blocked on web until user gesture.
    });
  }, [stream]);

  return <audio ref={audioRef} className="remote-audio" autoPlay playsInline />;
};

const Room: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const { code } = useParams<RoomParams>();
  const roomCode = useMemo(() => (code ?? '').toUpperCase(), [code]);
  const mode = new URLSearchParams(location.search).get('mode') === 'create' ? 'create' : 'join';

  const roomServiceRef = useRef<RoomService | null>(null);
  const startSessionIdRef = useRef(0);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('waiting');
  const [currentTalker, setCurrentTalker] = useState<string | null>(null);
  const [localUserId, setLocalUserId] = useState<string>('');
  const [entryStatus, setEntryStatus] = useState<RoomEntryStatus>('joined');
  const [waitingStatus, setWaitingStatus] = useState<JoinRequestStatus | null>(null);
  const [localTalking, setLocalTalking] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState<RemoteAudioStream[]>([]);
  const [roomSnapshot, setRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [joinRequests, setJoinRequests] = useState<JoinRequest[]>([]);
  const [error, setError] = useState<RoomServiceError | null>(null);
  const [isStarting, setIsStarting] = useState(true);

  const localMember = roomSnapshot?.members.find((member) => member.userId === localUserId) ?? null;
  const currentTalkerName =
    roomSnapshot?.members.find((member) => member.userId === currentTalker)?.displayName ?? null;
  const isHost = !!roomSnapshot?.hostUserId && roomSnapshot.hostUserId === localUserId;
  const otherUserTalking = !!currentTalker && currentTalker !== localUserId;
  const showRetry = error?.type === 'webrtc-failed';
  const showMicError = error?.type === 'mic-permission';
  const isWaitingForApproval = entryStatus === 'waiting' || waitingStatus === 'pending';

  const startSession = useCallback(async () => {
    const startSessionId = startSessionIdRef.current + 1;
    startSessionIdRef.current = startSessionId;
    setIsStarting(true);
    setError(null);
    setRoomSnapshot(null);
    setJoinRequests([]);
    setRemoteStreams([]);
    setWaitingStatus(null);
    setEntryStatus('joined');

    const existingService = roomServiceRef.current;
    roomServiceRef.current = null;
    if (existingService) {
      await existingService.leaveRoom();
    }
    if (startSessionIdRef.current !== startSessionId) {
      return;
    }

    const savedDisplayName = normalizeDisplayName((await preferencesService.getDisplayName()) ?? '');
    if (!savedDisplayName) {
      history.replace('/home?error=display-name');
      return;
    }

    let service: RoomService;
    const isCurrentService = () =>
      startSessionIdRef.current === startSessionId && roomServiceRef.current === service;
    service = new RoomService({
      onConnectionStatusChange: (status) => {
        if (isCurrentService()) {
          setConnectionStatus(status);
        }
      },
      onTalkingUserChange: (talker) => {
        if (isCurrentService()) {
          setCurrentTalker(talker);
        }
      },
      onLocalTalkingChange: (isTalking) => {
        if (isCurrentService()) {
          setLocalTalking(isTalking);
        }
      },
      onRemoteStreams: (streams) => {
        if (isCurrentService()) {
          setRemoteStreams(streams);
        }
      },
      onRoomSnapshot: (snapshot) => {
        if (isCurrentService()) {
          setRoomSnapshot(snapshot);
        }
      },
      onJoinRequestsChange: (requests) => {
        if (isCurrentService()) {
          setJoinRequests(requests);
        }
      },
      onWaitingStatusChange: (status) => {
        if (isCurrentService()) {
          setWaitingStatus(status);
          if (status === 'pending') {
            setEntryStatus('waiting');
          }
          if (status === null) {
            setEntryStatus('joined');
          }
        }
      },
      onError: (serviceError) => {
        if (!isCurrentService()) {
          return;
        }
        if (serviceError.type === 'join-denied' || serviceError.type === 'room-full') {
          history.replace(`/home?error=${serviceError.type}`);
          return;
        }
        setError(serviceError);
      },
    });
    roomServiceRef.current = service;

    try {
      const result =
        mode === 'create'
          ? await service.createRoom(roomCode, savedDisplayName)
          : await service.joinRoom(roomCode, savedDisplayName);
      if (!isCurrentService()) {
        await service.leaveRoom();
        return;
      }
      setLocalUserId(result.userId);
      setEntryStatus(result.status);
      await preferencesService.setLastRoomCode(roomCode);
      if (result.status === 'joined') {
        try {
          await backgroundService.startRoomForegroundMode(roomCode);
        } catch (e) {
          console.warn('Foreground service start failed:', e);
        }
      }
    } catch (roomError) {
      if (!isCurrentService()) {
        return;
      }
      const parsedError = roomError as RoomServiceError;
      if (
        parsedError.type === 'room-not-found' ||
        parsedError.type === 'room-full' ||
        parsedError.type === 'join-denied'
      ) {
        history.replace(`/home?error=${parsedError.type}`);
        return;
      }
      setError(parsedError);
    } finally {
      if (isCurrentService()) {
        setIsStarting(false);
      }
    }
  }, [history, mode, roomCode]);

  useEffect(() => {
    startSession();

    return () => {
      startSessionIdRef.current += 1;
      const service = roomServiceRef.current;
      roomServiceRef.current = null;
      service?.leaveRoom();
      backgroundService.stopRoomForegroundMode();
    };
  }, [startSession]);

  const handlePressStart = useCallback(async () => {
    if (isWaitingForApproval || otherUserTalking || error || isStarting) {
      return;
    }
    const didStart = await roomServiceRef.current?.startPushToTalk();
    if (!didStart) {
      setLocalTalking(false);
    }
  }, [error, isStarting, isWaitingForApproval, otherUserTalking]);

  const handlePressEnd = useCallback(async () => {
    await roomServiceRef.current?.stopPushToTalk();
  }, []);

  useEffect(() => {
    hardwareButtonService.setHandlers({
      onStart: () => handlePressStart(),
      onStop: () => handlePressEnd(),
    });
    hardwareButtonService.refreshPreferences();
    return () => {
      hardwareButtonService.setHandlers({});
    };
  }, [handlePressEnd, handlePressStart]);

  const handleLeave = async () => {
    await roomServiceRef.current?.leaveRoom();
    await backgroundService.stopRoomForegroundMode();
    history.replace('/home?error=room-left');
  };

  const handleMaxUsersChange = async (delta: number) => {
    if (!roomSnapshot) {
      return;
    }
    await roomServiceRef.current?.setMaxUsers(roomSnapshot.maxUsers + delta);
  };

  const connectionLabel = isWaitingForApproval ? 'Waiting for host approval' : statusLabels[connectionStatus];
  const pttDisabled =
    isWaitingForApproval ||
    otherUserTalking ||
    !!error ||
    isStarting ||
    connectionStatus === 'disconnected';

  return (
    <IonPage>
      <IonContent className="page-content">
        <div className="room-container">
          <div className="room-header">
            <IonText>
              <h2>Room Code</h2>
              <p className="room-code">{roomCode}</p>
            </IonText>
            <IonBadge color={isWaitingForApproval ? 'warning' : statusColors[connectionStatus]}>
              {connectionLabel}
            </IonBadge>
          </div>

          {localMember && (
            <IonText className="member-note">
              {localMember.displayName}
              {isHost ? ' - Host' : ''}
            </IonText>
          )}

          {isWaitingForApproval ? (
            <div className="waiting-panel">
              <IonText>
                <p>Your request is waiting for host review.</p>
              </IonText>
              <IonButton className="leave-button" expand="block" fill="outline" onClick={handleLeave}>
                <IonIcon slot="start" icon={exitOutline} />
                Cancel Request
              </IonButton>
            </div>
          ) : (
            <>
              <IonText className="room-status">
                {otherUserTalking && (
                  <p className="talking-other">{currentTalkerName ?? 'Someone'} is talking</p>
                )}
                {!otherUserTalking && localTalking && <p className="talking-self">You are talking</p>}
                {!otherUserTalking && !localTalking && <p>Listening</p>}
              </IonText>

              <div className="ptt-wrapper">
                <IonButton
                  className={`ptt-button ${localTalking ? 'ptt-active' : ''} ${
                    otherUserTalking ? 'ptt-blocked' : ''
                  }`}
                  expand="block"
                  disabled={pttDisabled}
                  onPointerDown={handlePressStart}
                  onPointerUp={handlePressEnd}
                  onPointerLeave={handlePressEnd}
                  onPointerCancel={handlePressEnd}
                >
                  {otherUserTalking ? 'Blocked' : localTalking ? 'Talking' : 'HOLD'}
                </IonButton>
              </div>
            </>
          )}

          {isHost && roomSnapshot && !isWaitingForApproval && (
            <div className="host-panel">
              <div className="section-title">
                <IonIcon icon={peopleOutline} />
                <span>Host Controls</span>
              </div>
              <div className="max-users-control">
                <IonButton
                  fill="outline"
                  disabled={roomSnapshot.maxUsers <= roomSnapshot.activeUserCount}
                  onClick={() => handleMaxUsersChange(-1)}
                >
                  <IonIcon icon={removeOutline} />
                </IonButton>
                <IonText>
                  {roomSnapshot.activeUserCount}/{roomSnapshot.maxUsers} members
                </IonText>
                <IonButton
                  fill="outline"
                  disabled={roomSnapshot.maxUsers >= 8}
                  onClick={() => handleMaxUsersChange(1)}
                >
                  <IonIcon icon={addOutline} />
                </IonButton>
              </div>
              <IonItem lines="none" className="host-toggle">
                <IonLabel>Approve join requests</IonLabel>
                <IonToggle
                  checked={roomSnapshot.requireApproval}
                  onIonChange={(event) =>
                    roomServiceRef.current?.setRequireApproval(event.detail.checked)
                  }
                />
              </IonItem>
              <IonItem lines="none" className="host-toggle">
                <IonLabel>
                  <IonIcon icon={volumeHighOutline} /> Walkie sound
                </IonLabel>
                <IonToggle
                  checked={roomSnapshot.walkieFxEnabled}
                  onIonChange={(event) => roomServiceRef.current?.setWalkieFxEnabled(event.detail.checked)}
                />
              </IonItem>
            </div>
          )}

          {isHost && joinRequests.length > 0 && !isWaitingForApproval && (
            <div className="request-list">
              <div className="section-title">
                <span>Join Requests</span>
              </div>
              {joinRequests.map((request) => (
                <div className="request-row" key={request.requestId}>
                  <IonText>{request.displayName}</IonText>
                  <div>
                    <IonButton
                      fill="clear"
                      onClick={() => roomServiceRef.current?.approveJoinRequest(request.requestId)}
                    >
                      <IonIcon icon={checkmarkCircleOutline} />
                    </IonButton>
                    <IonButton
                      fill="clear"
                      color="danger"
                      onClick={() => roomServiceRef.current?.denyJoinRequest(request.requestId)}
                    >
                      <IonIcon icon={closeCircleOutline} />
                    </IonButton>
                  </div>
                </div>
              ))}
            </div>
          )}

          {roomSnapshot && !isWaitingForApproval && (
            <div className="member-list">
              <div className="section-title">
                <span>Members</span>
              </div>
              {roomSnapshot.members.map((member) => (
                <div className="member-row" key={member.userId}>
                  <span>{member.displayName}</span>
                  <span>{member.isHost ? 'Host' : member.userId === currentTalker ? 'Talking' : ''}</span>
                </div>
              ))}
            </div>
          )}

          {isStarting && (
            <IonNote color="medium" className="status-note">
              WaveLink may ask for microphone access after the host lets you in.
            </IonNote>
          )}

          {error?.type === 'no-internet' && (
            <IonNote color="danger" className="status-note">
              No internet connection. Reconnect and try again.
            </IonNote>
          )}

          {error?.type === 'firebase-missing' && (
            <IonNote color="danger" className="status-note">
              Firebase config missing. Add VITE_FIREBASE_* values to continue.
            </IonNote>
          )}

          {showMicError && (
            <IonNote color="danger" className="status-note">
              Microphone permission is required for push-to-talk.
            </IonNote>
          )}

          {showMicError && (
            <IonButton className="retry-button" expand="block" fill="outline" onClick={openAppSettings}>
              Open App Settings
            </IonButton>
          )}

          {showRetry && (
            <IonNote color="danger" className="status-note">
              Connection failed. Try again or leave the room.
            </IonNote>
          )}

          {showRetry && (
            <IonButton className="retry-button" expand="block" fill="outline" onClick={startSession}>
              <IonIcon slot="start" icon={refreshOutline} />
              Try Again
            </IonButton>
          )}

          {!isWaitingForApproval && (
            <IonButton className="leave-button" expand="block" fill="clear" onClick={handleLeave}>
              <IonIcon slot="start" icon={exitOutline} />
              Leave Room
            </IonButton>
          )}
        </div>
        {remoteStreams.map((remoteStream) => (
          <RemoteAudio key={remoteStream.userId} stream={remoteStream.stream} />
        ))}
      </IonContent>
    </IonPage>
  );
};

export default Room;
