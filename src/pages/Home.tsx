import { useEffect, useState } from 'react';
import {
  IonButton,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonNote,
  IonPage,
  IonText,
} from '@ionic/react';
import { addCircleOutline, arrowRedoOutline, logInOutline, settingsOutline } from 'ionicons/icons';
import { useHistory, useLocation } from 'react-router-dom';
import { FirebaseSignalingService } from '../services/firebase/firebaseSignalingService';
import { normalizeDisplayName } from '../services/firebase/roomSignalingHelpers';
import { isFirebaseConfigured } from '../services/firebase/firebase';
import { useNetworkStatus } from '../services/networkService';
import { preferencesService } from '../services/preferences/preferencesService';
import { generateRoomCode } from '../services/roomCodeService';
import './Home.css';

const Home: React.FC = () => {
  const history = useHistory();
  const location = useLocation();
  const isOnline = useNetworkStatus();
  const [roomCode, setRoomCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [lastRoomCode, setLastRoomCode] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const firebaseReady = isFirebaseConfigured();

  useEffect(() => {
    preferencesService.getLastRoomCode().then(setLastRoomCode);
    preferencesService.getDisplayName().then((name) => {
      if (name) {
        setDisplayName(name);
      }
    });
  }, []);

  useEffect(() => {
    if (isOnline) {
      setErrorMessage(null);
    }
  }, [isOnline]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const roomError = params.get('error');
    if (!roomError) {
      return;
    }
    const errorMessages: Record<string, string> = {
      'room-not-found': 'Room not found. Check the code and try again.',
      'room-full': 'Room is full. Ask the host to raise the limit or try another room.',
      'join-denied': 'The host denied your join request.',
      'room-left': 'You left the room.',
      'display-name': 'Enter a display name before joining a room.',
    };
    setErrorMessage(errorMessages[roomError] ?? 'Unable to join the room. Try again.');
    history.replace('/home');
  }, [history, location.search]);

  const prepareDisplayName = async () => {
    const normalizedName = normalizeDisplayName(displayName);
    if (!normalizedName) {
      setErrorMessage('Enter a display name before joining a room.');
      return null;
    }
    await preferencesService.setDisplayName(normalizedName);
    setDisplayName(normalizedName);
    return normalizedName;
  };

  const validateRoomAction = async () => {
    if (!isOnline) {
      setErrorMessage('No internet connection. Connect to the internet to continue.');
      return false;
    }
    if (!firebaseReady) {
      setErrorMessage('Firebase config is missing. Add VITE_FIREBASE_* values to continue.');
      return false;
    }
    return !!(await prepareDisplayName());
  };

  const handleCreateRoom = async () => {
    if (!(await validateRoomAction())) {
      return;
    }
    const code = generateRoomCode();
    await preferencesService.setLastRoomCode(code);
    history.push(`/room/${code}?mode=create`);
  };

  const handleJoinRoom = async (overrideCode?: string) => {
    const normalized = (overrideCode ?? roomCode).trim().toUpperCase();
    if (!normalized) {
      setErrorMessage('Enter a room code to join.');
      return;
    }
    if (!(await validateRoomAction())) {
      return;
    }

    const signalingService = new FirebaseSignalingService();
    if (!signalingService.isAvailable()) {
      setErrorMessage('Firebase config is missing. Add VITE_FIREBASE_* values to continue.');
      return;
    }

    try {
      const joinStatus = await signalingService.getRoomJoinStatus(normalized);
      if (joinStatus === 'not-found') {
        setErrorMessage('Room not found. Check the code and try again.');
        return;
      }
      if (joinStatus === 'full') {
        setErrorMessage('Room is full. Ask the host to raise the limit or try another room.');
        return;
      }
    } catch {
      setErrorMessage('Unable to check room status. Try again in a moment.');
      return;
    }

    await preferencesService.setLastRoomCode(normalized);
    history.push(`/room/${normalized}?mode=join`);
  };

  return (
    <IonPage>
      <IonContent className="page-content">
        <div className="home-container">
          <IonText className="home-title">
            <h1>WaveLink</h1>
            <p>Hosted push-to-talk rooms for small teams.</p>
          </IonText>

          <div className="home-actions">
            <IonItem className="room-input" lines="none">
              <IonLabel position="stacked">Display Name</IonLabel>
              <IonInput
                value={displayName}
                placeholder="Your name"
                maxlength={20}
                onIonInput={(event) =>
                  setDisplayName((event.detail.value ?? '').replace(/\s+/g, ' ').slice(0, 20))
                }
                onIonBlur={() => setDisplayName((value) => normalizeDisplayName(value))}
              />
            </IonItem>

            <IonButton
              expand="block"
              className="primary-action"
              onClick={handleCreateRoom}
              disabled={!isOnline || !firebaseReady}
            >
              <IonIcon slot="start" icon={addCircleOutline} />
              Create Room
            </IonButton>

            <IonItem className="room-input" lines="none">
              <IonLabel position="stacked">Room Code</IonLabel>
              <IonInput
                value={roomCode}
                placeholder="Enter 6-character code"
                maxlength={6}
                onIonInput={(event) => {
                  const value = (event.detail.value ?? '').toUpperCase();
                  setRoomCode(value.replace(/[^A-Z0-9]/g, ''));
                }}
                onIonBlur={() => setRoomCode((value) => value.trim().toUpperCase())}
              />
            </IonItem>

            <IonButton
              expand="block"
              fill="outline"
              className="secondary-action"
              onClick={() => handleJoinRoom()}
              disabled={!isOnline || !firebaseReady}
            >
              <IonIcon slot="start" icon={logInOutline} />
              Join Room
            </IonButton>

            {lastRoomCode && (
              <IonButton
                expand="block"
                fill="clear"
                className="tertiary-action"
                onClick={() => handleJoinRoom(lastRoomCode)}
              >
                <IonIcon slot="start" icon={arrowRedoOutline} />
                Return to {lastRoomCode}
              </IonButton>
            )}

            <IonButton
              expand="block"
              fill="clear"
              className="settings-action"
              onClick={() => history.push('/settings')}
            >
              <IonIcon slot="start" icon={settingsOutline} />
              Settings
            </IonButton>

            {!isOnline && (
              <IonNote color="warning" className="status-note">
                You are offline. Reconnect to create or join a room.
              </IonNote>
            )}

            {!firebaseReady && (
              <IonNote color="danger" className="status-note">
                Firebase config missing. Add VITE_FIREBASE_* variables to continue.
              </IonNote>
            )}

            {errorMessage && (
              <IonNote color="danger" className="status-note">
                {errorMessage}
              </IonNote>
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
};

export default Home;
