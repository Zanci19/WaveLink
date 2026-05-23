const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const generateRoomCode = (length = 6) => {
  let result = '';
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  for (let index = 0; index < length; index += 1) {
    result += ALPHABET[values[index] % ALPHABET.length];
  }
  return result;
};
