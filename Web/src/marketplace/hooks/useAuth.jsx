import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/api.js';
import { auth, createAccountWithEmail, signInWithEmail, signInWithGoogle, signOutUser, subscribeToAuth } from '../firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [profileError, setProfileError] = useState('');
  const [loading, setLoading] = useState(Boolean(auth));
  useEffect(() => subscribeToAuth(async (nextUser) => {
    setUser(nextUser);
    setLoading(false);
    if (!nextUser) {
      setProfile(null);
      setProfileError('');
      return;
    }
    try {
      const result = await apiRequest('/me/profile');
      setProfile(result.profile);
      setProfileError('');
    } catch (error) {
      setProfile(null);
      setProfileError(error.message);
    }
  }), []);

  const value = useMemo(() => ({
    user,
    profile,
    profileError,
    loading,
    signIn: signInWithEmail,
    signInGoogle: signInWithGoogle,
    createAccount: createAccountWithEmail,
    signOut: signOutUser,
    refreshProfile: async () => {
      if (!auth?.currentUser) return null;
      const result = await apiRequest('/me/profile');
      setProfile(result.profile);
      return result.profile;
    }
  }), [user, profile, profileError, loading]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
