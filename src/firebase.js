// Import the functions you need from the SDKs
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore"; // Import Firestore

// Your web app's Firebase configuration
// IMPORTANT: In a real app, use environment variables for this!
const firebaseConfig = {
  apiKey: "AIzaSyCCzghu5GmA1Eip6PTYGF2NCXuQQz5U8q0",
  authDomain: "projectmanagement-2f4e0.firebaseapp.com",
  projectId: "projectmanagement-2f4e0",
  storageBucket: "projectmanagement-2f4e0.appspot.com",
  messagingSenderId: "526031118977",
  appId: "1:526031118977:web:33021fe5d394450c806380",
  measurementId: "G-DKYKQME618"
};


// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Authentication and Firestore
const auth = getAuth(app);
const db = getFirestore(app); // Initialize Firestore

// Export the instances for use in other parts of the app
export { app, auth, db };
