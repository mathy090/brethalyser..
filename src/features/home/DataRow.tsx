// src/features/home/DataRow.tsx
import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";

interface DataRowProps {
  label: string;
  value: string;
  placeholder?: string;
  error?: string;
  editable?: boolean;
  onChange: (val: string) => void;
  maxLength?: number;
}

export default function DataRow({
  label,
  value,
  placeholder,
  error,
  editable = true,
  onChange,
  maxLength,
}: DataRowProps) {
  // FIX 13 (optional): Normalize display values for specific fields
  const displayValue = React.useMemo(() => {
    if (label.toLowerCase().includes("bac") || label.toLowerCase().includes("alcohol")) {
      const num = parseFloat(value);
      return !isNaN(num) ? num.toFixed(2) : value;
    }
    return value;
  }, [value, label]);

  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, error && styles.inputError]}
        value={displayValue}
        placeholder={placeholder}
        placeholderTextColor="#444"
        editable={editable}
        maxLength={maxLength}
        onChangeText={onChange}
        autoCapitalize="characters"
        autoCorrect={false}
        spellCheck={false}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { marginBottom: 12 },
  label: {
    color: "#888",
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#000",
    color: "#fff",
    fontSize: 15,
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  inputError: {
    borderColor: "#FF4C4C",
  },
  error: {
    color: "#FF4C4C",
    fontSize: 10,
    marginTop: 4,
    marginLeft: 2,
  },
});