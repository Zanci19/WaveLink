export const MIN_ROOM_MEMBERS = 2;
export const MAX_ROOM_MEMBERS = 8;
export const ACTIVE_USER_TIMEOUT_MS = 30000;

export interface HostCandidate {
  userId: string;
  joinedAt: number | null;
  lastSeenAt: number | null;
}

export const normalizeDisplayName = (value: string) => {
  return value.trim().replace(/\s+/g, ' ').slice(0, 20);
};

export const clampMaxUsers = (requestedMaxUsers: number, activeUserCount: number) => {
  const requested = Number.isFinite(requestedMaxUsers)
    ? Math.round(requestedMaxUsers)
    : MIN_ROOM_MEMBERS;
  return Math.min(
    MAX_ROOM_MEMBERS,
    Math.max(MIN_ROOM_MEMBERS, activeUserCount, requested)
  );
};

export const isActivePresence = (lastSeenAt: number | null, now = Date.now()) => {
  return lastSeenAt === null || now - lastSeenAt <= ACTIVE_USER_TIMEOUT_MS;
};

export const chooseHostUserId = (
  members: HostCandidate[],
  currentHostUserId?: string | null,
  now = Date.now()
) => {
  const activeMembers = members
    .filter((member) => isActivePresence(member.lastSeenAt, now))
    .sort((a, b) => {
      const aJoinedAt = a.joinedAt ?? Number.MAX_SAFE_INTEGER;
      const bJoinedAt = b.joinedAt ?? Number.MAX_SAFE_INTEGER;
      return aJoinedAt - bJoinedAt || a.userId.localeCompare(b.userId);
    });

  if (currentHostUserId && activeMembers.some((member) => member.userId === currentHostUserId)) {
    return currentHostUserId;
  }

  return activeMembers[0]?.userId ?? null;
};

export const createPeerConnectionId = (firstUserId: string, secondUserId: string) => {
  return [firstUserId, secondUserId].sort().join('__');
};

export const isPeerOfferer = (localUserId: string, remoteUserId: string) => {
  return localUserId.localeCompare(remoteUserId) < 0;
};
