import { useCallback } from "react";
import {
  check, request, PERMISSIONS, RESULTS, type Permission,
} from "react-native-permissions";
import { Alert, Linking, Platform } from "react-native";

export const CAMERA_PERMISSION = PERMISSIONS.ANDROID.CAMERA;

export const BLUETOOTH_PERMISSIONS: Permission[] =
  Platform.Version >= 31
    ? [
        PERMISSIONS.ANDROID.BLUETOOTH_CONNECT,
        PERMISSIONS.ANDROID.BLUETOOTH_SCAN,
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      ]
    : [
        PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
      ];

function openSettings(feature: string) {
  Alert.alert(
    `${feature} Permission Required`,
    `BlowSafe needs ${feature.toLowerCase()} access. Open Settings to grant it.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Open Settings", onPress: () => Linking.openSettings() },
    ]
  );
}

async function ensurePermission(
  permission: Permission,
  featureName: string
): Promise<boolean> {
  const status = await check(permission);

  if (status === RESULTS.GRANTED)     return true;
  if (status === RESULTS.UNAVAILABLE) {
    Alert.alert(
      `${featureName} Unavailable`,
      `${featureName} is not available on this device.`
    );
    return false;
  }
  if (status === RESULTS.BLOCKED) {
    openSettings(featureName);
    return false;
  }
  if (status === RESULTS.DENIED) {
    const result = await request(permission);
    if (result === RESULTS.GRANTED) return true;
    if (result === RESULTS.BLOCKED)  { openSettings(featureName); return false; }
    return false;
  }
  return false;
}

async function ensurePermissions(
  permissions: Permission[],
  featureName: string
): Promise<boolean> {
  if (permissions.length === 0) return true;
  const results = await Promise.all(
    permissions.map(p => ensurePermission(p, featureName))
  );
  return results.every(Boolean);
}

export function usePermissions() {
  const requestCamera = useCallback(
    () => ensurePermission(CAMERA_PERMISSION, "Camera"),
    []
  );

  const requestBluetooth = useCallback(
    () => ensurePermissions(BLUETOOTH_PERMISSIONS, "Bluetooth"),
    []
  );

  return { requestCamera, requestBluetooth };
}