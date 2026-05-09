import { createContext, useContext, useState, ReactNode } from 'react';

interface Officer {
  uid: string;
  officerId: string;
  role: 'admin' | 'officer';
  status: 'active' | 'rejected' | 'pending';
}

interface OfficerContextType {
  officer: Officer | null;
  setOfficer: (officer: Officer) => Promise<void>;
  clearOfficer: () => void;
}

const OfficerContext = createContext<OfficerContextType | undefined>(undefined);

export const OfficerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [officer, setOfficerState] = useState<Officer | null>(null);

  const setOfficer = async (officerData: Officer) => {
    // Same persistence logic as RN
    localStorage.setItem('officer', JSON.stringify(officerData));
    setOfficerState(officerData);
  };

  const clearOfficer = () => {
    localStorage.removeItem('officer');
    setOfficerState(null);
  };

  return (
    <OfficerContext.Provider value={{ officer, setOfficer, clearOfficer }}>
      {children}
    </OfficerContext.Provider>
  );
};

export const useOfficer = () => {
  const context = useContext(OfficerContext);
  if (!context) throw new Error('useOfficer must be used within OfficerProvider');
  return context;
};