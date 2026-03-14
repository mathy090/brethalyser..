import * as Keychain from "react-native-keychain";

const SERVICES = {
  JWT: "com.blowsafe.jwt",
  OFFICER: "com.blowsafe.officer",
} as const;

export const storeToken = async (token: string): Promise<void> => {
  await Keychain.setGenericPassword("token", token, { service: SERVICES.JWT });
};

export const getToken = async (): Promise<string | null> => {
  const result = await Keychain.getGenericPassword({ service: SERVICES.JWT });
  return result ? result.password : null;
};

export const storeOfficerId = async (officerId: string): Promise<void> => {
  await Keychain.setGenericPassword("officerId", officerId, { service: SERVICES.OFFICER });
};

export const getOfficerId = async (): Promise<string | null> => {
  const result = await Keychain.getGenericPassword({ service: SERVICES.OFFICER });
  return result ? result.password : null;
};

export const clearSecureStorage = async (): Promise<void> => {
  await Promise.all([
    Keychain.resetGenericPassword({ service: SERVICES.JWT }),
    Keychain.resetGenericPassword({ service: SERVICES.OFFICER }),
  ]);
};