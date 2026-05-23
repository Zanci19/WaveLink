import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';
import { getFirestoreDb } from './firebase';
import {
  MIN_ROOM_MEMBERS,
  chooseHostUserId,
  clampMaxUsers,
  createPeerConnectionId,
  isActivePresence,
} from './roomSignalingHelpers';

export type RoomJoinStatus = 'available' | 'full' | 'not-found' | 'approval-required';
export type JoinRequestStatus = 'pending' | 'approved' | 'denied';
export type JoinResultStatus = 'joined' | 'waiting';

export interface RoomMember {
  userId: string;
  clientId: string;
  displayName: string;
  joinedAt: number | null;
  lastSeenAt: number | null;
  isHost: boolean;
}

export interface RoomSnapshot {
  currentlyTalking: string | null;
  maxUsers: number;
  hostUserId: string | null;
  requireApproval: boolean;
  walkieFxEnabled: boolean;
  activeUserCount: number;
  members: RoomMember[];
}

export interface JoinRequest {
  requestId: string;
  userId: string;
  clientId: string;
  displayName: string;
  status: JoinRequestStatus;
  requestedAt: number | null;
  lastSeenAt: number | null;
}

export interface SignalingRoomInfo {
  code: string;
  userId: string;
  status: JoinResultStatus;
}

export interface PeerConnectionSnapshot {
  connectionId: string;
  participants: [string, string];
  offer: (RTCSessionDescriptionInit & { from?: string }) | null;
  answer: (RTCSessionDescriptionInit & { from?: string }) | null;
}

export interface PeerIceCandidate {
  id: string;
  from: string;
  candidate: RTCIceCandidateInit;
}

const CLIENT_ID_STORAGE_KEY = 'wavelink-client-id';
const DEFAULT_DISPLAY_NAME = 'Guest';

const collections = {
  rooms: 'rooms',
  users: 'users',
  joinRequests: 'joinRequests',
  connections: 'connections',
  candidates: 'candidates',
  legacySignals: 'signals',
  legacyCallerCandidates: 'callerCandidates',
  legacyCalleeCandidates: 'calleeCandidates',
};

const generateClientId = () => {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `client-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

const getClientId = () => {
  const existing = localStorage.getItem(CLIENT_ID_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const clientId = generateClientId();
  localStorage.setItem(CLIENT_ID_STORAGE_KEY, clientId);
  return clientId;
};

const getMillis = (value: unknown) => {
  if (value instanceof Timestamp) {
    return value.toMillis();
  }
  if (
    value &&
    typeof value === 'object' &&
    'toMillis' in value &&
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis();
  }
  return null;
};

const toDisplayName = (value: unknown) => {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 20) : DEFAULT_DISPLAY_NAME;
};

const toSessionDescription = (value: unknown) => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const data = value as Record<string, unknown>;
  if (typeof data.type !== 'string' || typeof data.sdp !== 'string') {
    return null;
  }
  return {
    type: data.type as RTCSdpType,
    sdp: data.sdp,
    from: typeof data.from === 'string' ? data.from : undefined,
  };
};

export class FirebaseSignalingService {
  private db = getFirestoreDb();
  private clientId = getClientId();

  isAvailable() {
    return !!this.db;
  }

  getClientId() {
    return this.clientId;
  }

  private getRoomRef(code: string) {
    if (!this.db) {
      throw new Error('FIREBASE_NOT_READY');
    }
    return doc(this.db, collections.rooms, code);
  }

  private getUsersRef(code: string) {
    return collection(this.getRoomRef(code), collections.users);
  }

  private getUserRef(code: string, userId: string) {
    return doc(this.getUsersRef(code), userId);
  }

  private getJoinRequestsRef(code: string) {
    return collection(this.getRoomRef(code), collections.joinRequests);
  }

  private getJoinRequestRef(code: string) {
    return doc(this.getJoinRequestsRef(code), this.clientId);
  }

  private getConnectionsRef(code: string) {
    return collection(this.getRoomRef(code), collections.connections);
  }

  private getConnectionRef(code: string, firstUserId: string, secondUserId: string) {
    return doc(this.getConnectionsRef(code), createPeerConnectionId(firstUserId, secondUserId));
  }

  private getConnectionCandidatesRef(code: string, connectionId: string) {
    return collection(this.getRoomRef(code), collections.connections, connectionId, collections.candidates);
  }

  private getLegacyCollectionRef(code: string, collectionName: string) {
    if (!this.db) {
      throw new Error('FIREBASE_NOT_READY');
    }
    return collection(this.db, collections.rooms, code, collectionName);
  }

  private toMember(id: string, data: Record<string, unknown>, hostUserId: string | null): RoomMember {
    return {
      userId: id,
      clientId: (data.clientId as string | undefined) ?? id,
      displayName: toDisplayName(data.displayName),
      joinedAt: getMillis(data.joinedAt),
      lastSeenAt: getMillis(data.lastSeenAt),
      isHost: id === hostUserId,
    };
  }

  private toJoinRequest(id: string, data: Record<string, unknown>): JoinRequest {
    const status = data.status === 'approved' || data.status === 'denied' ? data.status : 'pending';
    return {
      requestId: id,
      userId: (data.userId as string | undefined) ?? '',
      clientId: (data.clientId as string | undefined) ?? id,
      displayName: toDisplayName(data.displayName),
      status,
      requestedAt: getMillis(data.requestedAt),
      lastSeenAt: getMillis(data.lastSeenAt),
    };
  }

  private getActiveMembersFromDocs(
    userDocs: Array<{ id: string; data: () => Record<string, unknown> }>,
    hostUserId: string | null,
    now = Date.now()
  ) {
    const newestUserByClient = new Map<string, RoomMember>();
    userDocs.forEach((userSnapshot) => {
      const member = this.toMember(userSnapshot.id, userSnapshot.data(), hostUserId);
      if (!isActivePresence(member.lastSeenAt, now)) {
        return;
      }
      const existing = newestUserByClient.get(member.clientId);
      if (!existing || (member.lastSeenAt ?? 0) > (existing.lastSeenAt ?? 0)) {
        newestUserByClient.set(member.clientId, member);
      }
    });
    return [...newestUserByClient.values()].sort((a, b) => {
      const joinedA = a.joinedAt ?? Number.MAX_SAFE_INTEGER;
      const joinedB = b.joinedAt ?? Number.MAX_SAFE_INTEGER;
      return joinedA - joinedB || a.userId.localeCompare(b.userId);
    });
  }

  private async cleanupCollection(code: string, collectionName: string) {
    const snapshot = await getDocs(this.getLegacyCollectionRef(code, collectionName));
    await Promise.all(snapshot.docs.map((docSnapshot) => deleteDoc(docSnapshot.ref)));
  }

  private async clearAllConnectionData(code: string) {
    const connectionsSnapshot = await getDocs(this.getConnectionsRef(code));
    await Promise.all(
      connectionsSnapshot.docs.map(async (connectionSnapshot) => {
        const candidatesSnapshot = await getDocs(
          this.getConnectionCandidatesRef(code, connectionSnapshot.id)
        );
        await Promise.all(candidatesSnapshot.docs.map((candidate) => deleteDoc(candidate.ref)));
        await deleteDoc(connectionSnapshot.ref);
      })
    );
    await Promise.all([
      this.cleanupCollection(code, collections.legacySignals),
      this.cleanupCollection(code, collections.legacyCallerCandidates),
      this.cleanupCollection(code, collections.legacyCalleeCandidates),
    ]);
  }

  private async pruneStaleUsers(code: string) {
    const roomSnapshot = await getDoc(this.getRoomRef(code));
    if (!roomSnapshot.exists()) {
      return [];
    }
    const roomData = roomSnapshot.data();
    const usersSnapshot = await getDocs(this.getUsersRef(code));
    const now = Date.now();
    const newestUserByClient = new Map<string, (typeof usersSnapshot.docs)[number]>();
    const usersToDelete: Array<(typeof usersSnapshot.docs)[number]> = [];

    usersSnapshot.docs.forEach((userSnapshot) => {
      const data = userSnapshot.data();
      const member = this.toMember(userSnapshot.id, data, (roomData.hostUserId as string | null) ?? null);
      if (!isActivePresence(member.lastSeenAt, now)) {
        usersToDelete.push(userSnapshot);
        return;
      }

      const existing = newestUserByClient.get(member.clientId);
      if (!existing) {
        newestUserByClient.set(member.clientId, userSnapshot);
        return;
      }

      const existingLastSeen = getMillis(existing.data().lastSeenAt) ?? 0;
      const nextLastSeen = member.lastSeenAt ?? 0;
      if (nextLastSeen > existingLastSeen) {
        usersToDelete.push(existing);
        newestUserByClient.set(member.clientId, userSnapshot);
        return;
      }
      usersToDelete.push(userSnapshot);
    });

    if (usersToDelete.length === 0) {
      await this.electHostIfNeeded(code);
      return [];
    }

    await Promise.all(usersToDelete.map((userSnapshot) => deleteDoc(userSnapshot.ref)));
    const removedUserIds = usersToDelete.map((userSnapshot) => userSnapshot.id);
    const currentTalker = roomData.currentlyTalking;
    if (typeof currentTalker === 'string' && removedUserIds.includes(currentTalker)) {
      await updateDoc(this.getRoomRef(code), { currentlyTalking: null });
    }
    await this.cleanupConnectionsForMissingUsers(code);
    await this.electHostIfNeeded(code);
    return removedUserIds;
  }

  private async cleanupStaleJoinRequests(code: string) {
    const requestsSnapshot = await getDocs(this.getJoinRequestsRef(code));
    const now = Date.now();
    await Promise.all(
      requestsSnapshot.docs
        .filter((requestSnapshot) => {
          const data = requestSnapshot.data();
          const status = data.status;
          const lastSeenAt = getMillis(data.lastSeenAt);
          return status === 'pending' && !isActivePresence(lastSeenAt, now);
        })
        .map((requestSnapshot) => deleteDoc(requestSnapshot.ref))
    );
  }

  private async cleanupConnectionsForMissingUsers(code: string) {
    const usersSnapshot = await getDocs(this.getUsersRef(code));
    const activeUserIds = new Set(usersSnapshot.docs.map((userSnapshot) => userSnapshot.id));
    const connectionsSnapshot = await getDocs(this.getConnectionsRef(code));
    await Promise.all(
      connectionsSnapshot.docs.map(async (connectionSnapshot) => {
        const data = connectionSnapshot.data();
        const participants = Array.isArray(data.participants) ? data.participants : [];
        if (participants.every((participant) => activeUserIds.has(String(participant)))) {
          return;
        }
        const candidatesSnapshot = await getDocs(
          this.getConnectionCandidatesRef(code, connectionSnapshot.id)
        );
        await Promise.all(candidatesSnapshot.docs.map((candidate) => deleteDoc(candidate.ref)));
        await deleteDoc(connectionSnapshot.ref);
      })
    );
  }

  async electHostIfNeeded(code: string) {
    const roomSnapshot = await getDoc(this.getRoomRef(code));
    if (!roomSnapshot.exists()) {
      return null;
    }
    const roomData = roomSnapshot.data();
    const usersSnapshot = await getDocs(this.getUsersRef(code));
    const members = usersSnapshot.docs.map((userSnapshot) => {
      const data = userSnapshot.data();
      return {
        userId: userSnapshot.id,
        joinedAt: getMillis(data.joinedAt),
        lastSeenAt: getMillis(data.lastSeenAt),
      };
    });
    const hostUserId = chooseHostUserId(members, (roomData.hostUserId as string | null) ?? null);
    if (hostUserId !== roomData.hostUserId) {
      await updateDoc(this.getRoomRef(code), { hostUserId });
    }
    return hostUserId;
  }

  async getRoomJoinStatus(code: string): Promise<RoomJoinStatus> {
    const roomSnapshot = await getDoc(this.getRoomRef(code));
    if (!roomSnapshot.exists()) {
      return 'not-found';
    }
    await this.pruneStaleUsers(code);
    await this.cleanupStaleJoinRequests(code);
    const freshRoomSnapshot = await getDoc(this.getRoomRef(code));
    const data = freshRoomSnapshot.data() ?? {};
    const usersSnapshot = await getDocs(this.getUsersRef(code));
    const members = this.getActiveMembersFromDocs(
      usersSnapshot.docs,
      (data.hostUserId as string | null) ?? null
    );
    const maxUsers = clampMaxUsers((data.maxUsers as number | undefined) ?? MIN_ROOM_MEMBERS, members.length);
    if (members.length >= maxUsers) {
      return 'full';
    }
    return data.requireApproval ? 'approval-required' : 'available';
  }

  async createRoom(code: string, userId: string, displayName: string): Promise<SignalingRoomInfo> {
    const maxUsers = MIN_ROOM_MEMBERS;
    await setDoc(this.getRoomRef(code), {
      code,
      createdAt: serverTimestamp(),
      maxUsers,
      hostUserId: userId,
      requireApproval: false,
      walkieFxEnabled: false,
      currentlyTalking: null,
    });
    await this.clearAllConnectionData(code);
    await this.addOrUpdateUser(code, userId, displayName, true);
    return { code, userId, status: 'joined' };
  }

  async joinRoom(code: string, userId: string, displayName: string): Promise<SignalingRoomInfo> {
    const status = await this.getRoomJoinStatus(code);
    if (status === 'not-found') {
      throw new Error('ROOM_NOT_FOUND');
    }
    if (status === 'full') {
      throw new Error('ROOM_FULL');
    }
    if (status === 'approval-required') {
      await this.createJoinRequest(code, userId, displayName);
      return { code, userId, status: 'waiting' };
    }
    await this.addOrUpdateUser(code, userId, displayName, false);
    return { code, userId, status: 'joined' };
  }

  async activateApprovedJoin(code: string, userId: string, displayName: string) {
    const requestSnapshot = await getDoc(this.getJoinRequestRef(code));
    const requestData = requestSnapshot.data();
    if (!requestSnapshot.exists() || requestData?.status !== 'approved') {
      throw new Error(requestData?.status === 'denied' ? 'JOIN_DENIED' : 'JOIN_WAITING');
    }

    const status = await this.getRoomJoinStatus(code);
    if (status === 'full') {
      await updateDoc(this.getJoinRequestRef(code), { status: 'denied', decidedAt: serverTimestamp() });
      throw new Error('ROOM_FULL');
    }

    await this.addOrUpdateUser(code, userId, displayName, false);
    await deleteDoc(this.getJoinRequestRef(code));
    return { code, userId, status: 'joined' as const };
  }

  private async addOrUpdateUser(code: string, userId: string, displayName: string, isHost: boolean) {
    await setDoc(
      this.getUserRef(code, userId),
      {
        clientId: this.clientId,
        displayName: toDisplayName(displayName),
        joinedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
    if (isHost) {
      await updateDoc(this.getRoomRef(code), { hostUserId: userId });
    }
  }

  async createJoinRequest(code: string, userId: string, displayName: string) {
    await setDoc(
      this.getJoinRequestRef(code),
      {
        userId,
        clientId: this.clientId,
        displayName: toDisplayName(displayName),
        status: 'pending',
        requestedAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async updateJoinRequestPresence(code: string) {
    await setDoc(
      this.getJoinRequestRef(code),
      {
        clientId: this.clientId,
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async clearJoinRequest(code: string) {
    await deleteDoc(this.getJoinRequestRef(code));
  }

  async approveJoinRequest(code: string, requestId: string) {
    const status = await this.getRoomJoinStatus(code);
    if (status === 'full') {
      await updateDoc(doc(this.getJoinRequestsRef(code), requestId), {
        status: 'denied',
        decidedAt: serverTimestamp(),
      });
      throw new Error('ROOM_FULL');
    }
    await updateDoc(doc(this.getJoinRequestsRef(code), requestId), {
      status: 'approved',
      decidedAt: serverTimestamp(),
    });
  }

  async denyJoinRequest(code: string, requestId: string) {
    await updateDoc(doc(this.getJoinRequestsRef(code), requestId), {
      status: 'denied',
      decidedAt: serverTimestamp(),
    });
  }

  async updateUserPresence(code: string, userId: string) {
    await setDoc(
      this.getUserRef(code, userId),
      {
        clientId: this.clientId,
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
    await this.pruneStaleUsers(code);
  }

  async removeUser(code: string, userId: string) {
    await deleteDoc(this.getUserRef(code, userId));
    await this.clearCurrentlyTalkingIfOwner(code, userId);
    await this.cleanupConnectionsForMissingUsers(code);
    await this.electHostIfNeeded(code);
  }

  async cleanupRoomIfEmpty(code: string) {
    await this.pruneStaleUsers(code);
    const usersSnapshot = await getDocs(this.getUsersRef(code));
    if (usersSnapshot.size > 0) {
      await this.electHostIfNeeded(code);
      return;
    }
    await this.clearAllConnectionData(code);
    const requestsSnapshot = await getDocs(this.getJoinRequestsRef(code));
    await Promise.all(requestsSnapshot.docs.map((requestSnapshot) => deleteDoc(requestSnapshot.ref)));
    await deleteDoc(this.getRoomRef(code));
  }

  async setRoomMaxUsers(code: string, maxUsers: number) {
    const roomSnapshot = await getDoc(this.getRoomRef(code));
    const usersSnapshot = await getDocs(this.getUsersRef(code));
    const members = this.getActiveMembersFromDocs(
      usersSnapshot.docs,
      (roomSnapshot.data()?.hostUserId as string | null) ?? null
    );
    await updateDoc(this.getRoomRef(code), {
      maxUsers: clampMaxUsers(maxUsers, members.length),
    });
  }

  async setRoomRequireApproval(code: string, requireApproval: boolean) {
    await updateDoc(this.getRoomRef(code), { requireApproval });
  }

  async setRoomWalkieFxEnabled(code: string, walkieFxEnabled: boolean) {
    await updateDoc(this.getRoomRef(code), { walkieFxEnabled });
  }

  async setCurrentlyTalking(code: string, userId: string | null) {
    await updateDoc(this.getRoomRef(code), { currentlyTalking: userId ?? null });
  }

  async clearCurrentlyTalkingIfOwner(code: string, userId: string) {
    const roomRef = this.getRoomRef(code);
    const snapshot = await getDoc(roomRef);
    if (!snapshot.exists()) {
      return;
    }
    const data = snapshot.data();
    if (data?.currentlyTalking === userId) {
      await updateDoc(roomRef, { currentlyTalking: null });
    }
  }

  onRoomSnapshot(code: string, callback: (snapshot: RoomSnapshot) => void) {
    return onSnapshot(this.getRoomRef(code), async (snapshot) => {
      const data = snapshot.data();
      if (!data) {
        return;
      }
      const usersSnapshot = await getDocs(this.getUsersRef(code));
      const hostUserId = (data.hostUserId as string | null) ?? null;
      const members = this.getActiveMembersFromDocs(usersSnapshot.docs, hostUserId);
      callback({
        currentlyTalking: (data.currentlyTalking as string | null) ?? null,
        maxUsers: clampMaxUsers((data.maxUsers as number | undefined) ?? MIN_ROOM_MEMBERS, members.length),
        hostUserId,
        requireApproval: Boolean(data.requireApproval),
        walkieFxEnabled: Boolean(data.walkieFxEnabled),
        activeUserCount: members.length,
        members,
      });
    });
  }

  onJoinRequest(code: string, callback: (request: JoinRequest | null) => void) {
    return onSnapshot(this.getJoinRequestRef(code), (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      callback(this.toJoinRequest(snapshot.id, snapshot.data()));
    });
  }

  onJoinRequests(code: string, callback: (requests: JoinRequest[]) => void) {
    return onSnapshot(this.getJoinRequestsRef(code), (snapshot) => {
      const requests = snapshot.docs
        .map((requestSnapshot) => this.toJoinRequest(requestSnapshot.id, requestSnapshot.data()))
        .filter((request) => request.status === 'pending')
        .sort((a, b) => {
          const aRequestedAt = a.requestedAt ?? Number.MAX_SAFE_INTEGER;
          const bRequestedAt = b.requestedAt ?? Number.MAX_SAFE_INTEGER;
          return aRequestedAt - bRequestedAt || a.displayName.localeCompare(b.displayName);
        });
      callback(requests);
      this.cleanupStaleJoinRequests(code).catch(() => {
        // A later snapshot will correct the pending list.
      });
    });
  }

  onConnectionSnapshot(
    code: string,
    localUserId: string,
    remoteUserId: string,
    callback: (snapshot: PeerConnectionSnapshot | null) => void
  ) {
    const connectionId = createPeerConnectionId(localUserId, remoteUserId);
    return onSnapshot(this.getConnectionRef(code, localUserId, remoteUserId), (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      const data = snapshot.data();
      const participants = Array.isArray(data.participants)
        ? ([String(data.participants[0]), String(data.participants[1])].sort() as [string, string])
        : ([...connectionId.split('__')] as [string, string]);
      callback({
        connectionId,
        participants,
        offer: toSessionDescription(data.offer),
        answer: toSessionDescription(data.answer),
      });
    });
  }

  async writeConnectionOffer(
    code: string,
    localUserId: string,
    remoteUserId: string,
    offer: RTCSessionDescriptionInit
  ) {
    const participants = [localUserId, remoteUserId].sort();
    await setDoc(
      this.getConnectionRef(code, localUserId, remoteUserId),
      {
        participants,
        offer: {
          type: offer.type,
          sdp: offer.sdp,
          from: localUserId,
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async writeConnectionAnswer(
    code: string,
    localUserId: string,
    remoteUserId: string,
    answer: RTCSessionDescriptionInit
  ) {
    const participants = [localUserId, remoteUserId].sort();
    await setDoc(
      this.getConnectionRef(code, localUserId, remoteUserId),
      {
        participants,
        answer: {
          type: answer.type,
          sdp: answer.sdp,
          from: localUserId,
        },
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  }

  async addIceCandidate(
    code: string,
    localUserId: string,
    remoteUserId: string,
    candidate: RTCIceCandidate
  ) {
    const connectionId = createPeerConnectionId(localUserId, remoteUserId);
    await addDoc(this.getConnectionCandidatesRef(code, connectionId), {
      from: localUserId,
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      createdAt: serverTimestamp(),
    });
  }

  onIceCandidates(
    code: string,
    localUserId: string,
    remoteUserId: string,
    callback: (candidate: PeerIceCandidate) => void
  ) {
    const connectionId = createPeerConnectionId(localUserId, remoteUserId);
    return onSnapshot(this.getConnectionCandidatesRef(code, connectionId), (snapshot) => {
      snapshot.docChanges().forEach((change) => {
        if (change.type !== 'added') {
          return;
        }
        const data = change.doc.data();
        const from = data.from as string | undefined;
        if (!from || from === localUserId) {
          return;
        }
        callback({
          id: change.doc.id,
          from,
          candidate: {
            candidate: data.candidate,
            sdpMid: data.sdpMid,
            sdpMLineIndex: data.sdpMLineIndex,
          },
        });
      });
    });
  }
}
