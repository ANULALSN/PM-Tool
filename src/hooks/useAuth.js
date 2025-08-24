import { useState, useEffect } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';

export function useAuth() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authenticatedUser) => {
      if (authenticatedUser) {
        // If user is authenticated, get their custom role from Firestore
        const userDocRef = doc(db, 'users', authenticatedUser.uid);
        const unsubFromDoc = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            // Combine auth user data with Firestore role data
            setUser({ ...authenticatedUser, ...docSnap.data() });
            setRole(docSnap.data().role);
          } else {
            // Handle case where user exists in auth but not in Firestore
            setUser(authenticatedUser);
            setRole(null); // Or a default role
          }
          setLoading(false);
        });
        return () => unsubFromDoc();
      } else {
        // No user is signed in
        setUser(null);
        setRole(null);
        setLoading(false);
      }
    });

    // Cleanup subscription on unmount
    return () => unsubscribe();
  }, []);

  return { user, role, loading };
}
