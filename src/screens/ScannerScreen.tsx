// src/screens/ScannerScreen.tsx
import React, { useRef, useState, useEffect, useCallback } from "react";
import { 
  View, Text, StyleSheet, Alert, Vibration, 
  ActivityIndicator, TouchableOpacity 
} from "react-native";
import { Camera, useCameraDevices } from "react-native-vision-camera";
import TextRecognition from "@react-native-ml-kit/text-recognition";

import { parseOCRText, type OCRResult } from "../helpers/ocrParser";
import { postProcess, mergeFrames } from "../helpers/ocrPostProcessor";
import { validateDriverForm } from "../helpers/validation";
import { type DriverData } from "../helpers/constants";

interface ScannerScreenProps {
  onCapture: (data: DriverData) => void;
  onCancel: () => void;
}

export default function ScannerScreen({ onCapture, onCancel }: ScannerScreenProps) {
  const cameraRef = useRef<Camera>(null);
  const devices = useCameraDevices();
  const device = devices.back;

  const [hasPermission, setHasPermission] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confidence, setConfidence] = useState(0);
  const [previewText, setPreviewText] = useState("");

  // Auto-capture state
  const frameBuffer = useRef<string[]>([]);
  const stableCount = useRef(0);
  const CAPTURE_THRESHOLD = 6;
  const STABILITY_FRAMES = 3;
  const FRAME_BUFFER_SIZE = 5;

  // Request permissions
  useEffect(() => {
    (async () => {
      const cameraPermission = await Camera.requestCameraPermission();
      const microPermission = await Camera.requestMicrophonePermission();
      setHasPermission(
        cameraPermission === "authorized" && microPermission === "authorized"
      );
    })();
  }, []);

  // Evaluate OCR result for auto-capture
  const evaluateResult = useCallback((result: OCRResult): boolean => {
    const score =
      result.extracted.length +
      (result.confident ? 2 : 0) +
      (result.data.idNumber?.length > 5 ? 1 : 0) +
      (result.data.surname?.length > 2 ? 1 : 0) +
      (result.data.licenceNumber?.length > 4 ? 1 : 0);

    setConfidence(score);
    return score >= CAPTURE_THRESHOLD;
  }, []);

  // Handle auto-capture
  const handleAutoCapture = useCallback((result: OCRResult) => {
    const cleaned = postProcess(result.data);
    const errors = validateDriverForm(cleaned);
    
    if (Object.keys(errors).length > 0) {
      // Low-confidence capture — show for manual review
      setPreviewText(JSON.stringify(cleaned, null, 2));
      setIsProcessing(false);
      return;
    }
    
    // High-confidence — auto-submit
    Vibration?.vibrate(100);
    onCapture(cleaned);
  }, [onCapture]);

  // Process OCR frame
  const processFrame = useCallback(async (text: string) => {
    if (isProcessing) return;
    
    // Add to frame buffer for watermark suppression
    frameBuffer.current.push(text);
    
    if (frameBuffer.current.length < FRAME_BUFFER_SIZE) {
      return;
    }
    
    // Merge frames to suppress watermarks/noise
    const merged = mergeFrames(frameBuffer.current);
    frameBuffer.current = []; // Reset buffer
    
    setIsProcessing(true);
    
    try {
      const result = parseOCRText(merged);
      
      if (evaluateResult(result)) {
        stableCount.current++;
        
        if (stableCount.current >= STABILITY_FRAMES) {
          handleAutoCapture(result);
          stableCount.current = 0;
          return;
        }
      } else {
        stableCount.current = 0;
      }
      
      // Update preview for debugging
      setPreviewText(`Extracted: ${result.extracted.join(", ")}\nConfidence: ${confidence}/10`);
      
    } catch (error) {
      console.error("OCR processing error:", error);
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, evaluateResult, handleAutoCapture, confidence]);

  // OCR callback
  useEffect(() => {
    if (!hasPermission) return;
    
    const subscription = TextRecognition.onResult((result) => {
      if (result.text.trim().length > 10) { // Minimum text threshold
        processFrame(result.text);
      }
    });
    
    return () => {
      subscription.remove();
    };
  }, [hasPermission, processFrame]);

  // Manual capture fallback
  const handleManualCapture = async () => {
    if (!cameraRef.current) return;
    
    setIsProcessing(true);
    try {
      const photo = await cameraRef.current.takePhoto({ flash: "off" });
      const result = await TextRecognition.recognize(photo.path);
      const parsed = parseOCRText(result.text);
      const cleaned = postProcess(parsed.data);
      
      onCapture(cleaned);
    } catch (error) {
      Alert.alert("Error", "Failed to capture. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!hasPermission || !device) {
    return (
      <View style={styles.center}>
        <Text>Camera permission required</Text>
        <TouchableOpacity onPress={onCancel} style={styles.button}>
          <Text style={styles.buttonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        photo={true}
        enableZoomGesture={true}
      />
      
      {/* Overlay UI */}
      <View style={styles.overlay}>
        <View style={styles.scanBox} />
        
        {/* Confidence indicator */}
        <View style={styles.confidenceBar}>
          <View 
            style={[
              styles.confidenceFill, 
              { width: `${Math.min(confidence * 10, 100)}%` }
            ]} 
          />
        </View>
        <Text style={styles.confidenceText}>
          Confidence: {confidence}/10
        </Text>
        
        {/* Preview/debug text */}
        {previewText ? (
          <View style={styles.previewBox}>
            <Text style={styles.previewText} numberOfLines={3}>
              {previewText}
            </Text>
          </View>
        ) : null}
        
        {/* Controls */}
        <View style={styles.controls}>
          <TouchableOpacity 
            onPress={onCancel} 
            style={[styles.button, styles.cancelButton]}
            disabled={isProcessing}
          >
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            onPress={handleManualCapture} 
            style={[styles.button, styles.captureButton]}
            disabled={isProcessing}
          >
            {isProcessing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Capture</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
  },
  scanBox: {
    position: "absolute",
    top: "30%",
    left: "15%",
    right: "15%",
    height: "25%",
    borderWidth: 2,
    borderColor: "#00ff88",
    borderRadius: 12,
  },
  confidenceBar: {
    position: "absolute",
    top: 60,
    left: 20,
    right: 20,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2,
  },
  confidenceFill: {
    height: "100%",
    backgroundColor: "#00ff88",
    borderRadius: 2,
  },
  confidenceText: {
    position: "absolute",
    top: 70,
    left: 20,
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  previewBox: {
    position: "absolute",
    bottom: 120,
    left: 20,
    right: 20,
    backgroundColor: "rgba(0,0,0,0.7)",
    padding: 10,
    borderRadius: 8,
  },
  previewText: {
    color: "#00ff88",
    fontSize: 11,
    fontFamily: "monospace",
  },
  controls: {
    position: "absolute",
    bottom: 40,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 24,
    minWidth: 100,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  captureButton: {
    backgroundColor: "#00ff88",
  },
  buttonText: {
    color: "#000",
    fontWeight: "700",
    fontSize: 16,
  },
});